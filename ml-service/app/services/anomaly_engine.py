# %% [markdown]
# # Layer 2: Anomaly detection (owner: P4)
#
# Flags unusual rows and files. It never rejects: rejection belongs to Layer 1 (validation).
# Source of truth for every rule: "Data and Business Validations.xlsx" (all 9 sheets).
#
# How the engine will call this module (integration contract):
#
#     det = AnomalyDetector("BANK_TXNS", model_dir="models", lookups=lookups, history=history)
#     for start_row, chunk in chunks:                 # rows that passed Layer 1
#         flags += det.score_chunk(chunk, start_row)  # row-level checks
#     flags += det.finish()                           # file-wide checks (velocity, rates series)
#     flags += detect_file_anomalies(file_features, file_history)
#     db_rows = to_db_rows(flags, file_id)            # matches the anomalies table
#
# Every flag: {row_number, level, anomaly_type, rule_ref, score (0..1), method, explanation}

# %%
# Cell 1: imports
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

try:
    import shap  # optional: explanations fall back to robust z if missing
except Exception:  # pragma: no cover
    shap = None

MODULE_VERSION = "2.0"

# %%
# Cell 2: configuration. Every threshold lives here (spec: "Define Threshold").
CONFIG = {
    # Statistical outliers (workbook AI table: "Amount > 3 sigma from mean for account type")
    "outlier_method": "robust",       # "robust" = median/MAD modified z (outlier-resistant); "sigma" = mean/std
    "outlier_threshold": 3.5,         # 3.5 for robust (Iglewicz-Hoaglin); use 3.0 with "sigma" for the literal rule
    "min_group_size": 30,             # smaller groups give unstable statistics; skipped
    # Isolation Forest
    "iforest_trees": 200,
    "iforest_contamination": 0.005,   # share of reference rows above the cut-off (analyst capacity)
    "iforest_min_rows": 200,
    "max_shap_rows": 2000,            # SHAP only on flagged rows, capped for speed
    # T-N11 overdraft, T-N12 unusual time, T-N13 rapid successive, T-N14 threshold
    "night_start_hour": 0,            # T-N12 window [start, end) for non-business accounts
    "night_end_hour": 5,
    "rare_hour_share": 0.01,          # T-N12 without account types: hour seen in < 1% of reference rows
    "velocity_count": 3,              # T-N13: this many txns per account ...
    "velocity_window": "10min",       # ... within this window
    "reporting_threshold_inr": 500000.0,  # T-N14 example: 4,99,999
    "threshold_band_inr": 1000.0,     # flag [threshold - band, threshold)
    "round_amount_min": 10000.0,      # T-N14 round-number signal applies at or above this
    # Payments
    "stale_pending_days": 30,         # P-10 / P-N11
    "payment_burst_per_day": 3,       # P-N13 (payments have dates only, no time)
    "account_history_min_n": 5,       # P-N12 / A-N12 need this many past values per account
    "payment_above_avg_z": 3.0,       # P-N12 "significantly higher than historical average"
    # Accounts
    "balance_spike_multiple": 10.0,   # A-N12
    # Rates
    "rate_jump_pct": 0.05,            # R-N10 literal: > 5% vs previous day
    "rate_jump_rule_enabled": True,   # workbook rule; on the provided random data it fires often
    "rate_stale_days": 7,             # R-8 / R-N9
    "rate_spread_threshold": 2.0,     # R-N12: spread beyond 2 standard deviations
    "common_pairs": ["USD/EUR"],      # R-N11 (workbook example); add more if the team agrees
    # File level
    "file_min_history": 10,
    "file_rejection_floor": 0.20,
    "prediction_miss_floor": 0.30,
}

FILE_TYPES = ("ACCOUNTS", "BANK_TXNS", "PAYMENTS", "RATES")

# Column names exactly as in the provided files (workbook column order).
COLUMNS = {
    "ACCOUNTS": ["account_number", "account_holder_name", "account_type", "balance", "currency",
                 "account_status", "ifsc_code"],
    "BANK_TXNS": ["transaction_id", "account_number", "transaction_date", "transaction_type", "amount",
                  "currency", "description", "ifsc_code"],
    "PAYMENTS": ["payment_id", "account_number", "payment_date", "payment_method", "amount", "currency",
                 "payment_status", "ifsc_code"],
    "RATES": ["rate_id", "currency_pair", "rate_date", "exchange_rate", "rate_type"],
}

# Allowed values from the workbook Lookup sheet and column notes. Fixed lists keep the
# Isolation Forest feature columns identical between fitting and scoring.
CATS = {
    "currency": ["INR", "USD", "EUR"],
    "transaction_type": ["debit", "credit"],
    "payment_method": ["credit card", "bank transfer", "direct debit", "wire"],
    "payment_status": ["pending", "completed", "failed", "cancelled"],
    "account_type": ["checking", "savings", "current", "business"],
    "account_status": ["active", "inactive", "closed", "suspended"],
}

# "Unusually high" checks: value column, grouping, flag name, scale.
# Scale follows the measured shape of the provided data: amounts are bounded and roughly
# uniform (raw scale; log would hide high outliers), balances are log-normal (log scale).
VALUE_SPEC = {
    "BANK_TXNS": ("amount", ["currency", "transaction_type"], "HIGH_VALUE_TXN", "raw"),
    "PAYMENTS": ("amount", ["currency", "payment_method"], "HIGH_VALUE_PAYMENT", "raw"),
    "ACCOUNTS": ("balance", ["currency", "account_type"], "HIGH_BALANCE", "log"),
}

# %%
# Cell 3: coverage map. Every anomaly ID in the workbook, and which layer owns it.
# Layer 1 = validation (REJECT or FLAG at load). Layer 2 = this module. N/A = the data cannot support it.
COVERAGE = [
    # Accounts
    ("A-N1..A-N8", "Duplicates, blank name, bad enums, negative balance, bad currency, bad or unknown IFSC", "Layer 1", "A-1..A-8 validation rules"),
    ("A-N9", "Account number with leading zeros or special characters", "Layer 1", "FLAG rule at validation"),
    ("A-N10", "Balance with more than 4 decimals", "Layer 1", "Record check; ACCT-3 rounds to 4"),
    ("A-N11", "Holder name over 100 characters", "Layer 1", "Record size check"),
    ("A-N12", "Balance spike over 10x the account's history", "Layer 2", "BALANCE_SPIKE (needs balance history)"),
    ("AI: statistical outlier", "Balance far above normal for account type", "Layer 2", "HIGH_BALANCE + Isolation Forest"),
    # Bank-Txns
    ("T-N1..T-N8, T-N10", "Duplicates, orphan account, future date, bad enums, amount <= 0, bad currency, IFSC", "Layer 1", "T-1..T-7, T-9 validation rules"),
    ("T-N9", "Net credit-debit vs account balance", "Layer 1 (stretch)", "Needs balance as of each date; not in the data"),
    ("T-N11", "Debit amount exceeds account balance", "Layer 2", "OVERDRAFT (needs accounts lookup)"),
    ("T-N12", "Unusual time for non-business account", "Layer 2", "UNUSUAL_TIME (night window if account type known, else rare-hour profile)"),
    ("T-N13", "Rapid successive transactions", "Layer 2", "TXN_VELOCITY (file-wide)"),
    ("T-N14", "Round amounts just below reporting threshold", "Layer 2", "NEAR_REPORTING_THRESHOLD + ROUND_AMOUNT"),
    ("AI: statistical outlier", "Amount far above normal for its group", "Layer 2", "HIGH_VALUE_TXN + Isolation Forest"),
    ("AI: temporal anomaly", "Transaction at unusual hour", "Layer 2", "UNUSUAL_TIME + hour features in Isolation Forest"),
    # Payments
    ("P-N1..P-N9", "Duplicates, orphan account, future date, bad enums, amount <= 0, currency, IFSC for bank transfer", "Layer 1", "P-1..P-8 validation rules"),
    ("P-N10", "Completed payment with no matching Bank-Txn", "Layer 1 (cross-file)", "P-9 cross-file rule"),
    ("P-N11", "Pending payment older than 30 days", "Layer 2", "STALE_PENDING_PAYMENT (Layer 1 skips P-10 to avoid double flags)"),
    ("P-N12", "Amount far above historical average", "Layer 2", "PAYMENT_ABOVE_ACCOUNT_AVG (with history) or HIGH_VALUE_PAYMENT"),
    ("P-N13", "Multiple payments to same recipient, short time", "Layer 2", "PAYMENT_BURST by account (no recipient column exists)"),
    ("P-N14", "First-time payee", "N/A", "No beneficiary column in the data"),
    # Rates
    ("R-N1..R-N7", "Duplicate ID, bad pair, future date, rate <= 0, bad type, multiple buy/sell per day", "Layer 1", "R-1..R-6 validation rules"),
    ("R-N8", "Sell rate above buy rate", "Layer 2", "INVERTED_SPREAD (Layer 1 skips R-7 to avoid double flags)"),
    ("R-N9", "Stale rate, no update for 7+ days", "Layer 2", "STALE_RATE (gap) + PAIR_STALE (latest rate vs today; R-8)"),
    ("R-N10", "Rate moved more than 5% vs previous day", "Layer 2", "RATE_JUMP_5PCT (literal) + RATE_JUMP (statistical)"),
    ("R-N11", "Commonly traded pair missing", "Layer 2", "MISSING_COMMON_PAIR (file level)"),
    ("R-N12", "Spread beyond 2 standard deviations", "Layer 2", "WIDE_SPREAD"),
    # AI table rows
    ("AI: pattern deviation", "Autoencoder on account transaction sequences", "N/A", "About 2 rows per account; no sequences to learn"),
    ("AI: network anomaly", "Circular transfers A to B to C to A", "N/A", "No counterparty column"),
    ("AI: behavioral drift", "Sudden change in account behaviour", "Layer 2", "Covered by BALANCE_SPIKE and PAYMENT_ABOVE_ACCOUNT_AVG"),
    # File level (spec sections V.3, V.4, VII.6)
    ("File: volume", "Record count or size far from normal", "Layer 2", "FILE_SIZE_UNUSUAL, RECORD_COUNT_UNUSUAL"),
    ("File: rejection spike", "Many rejected rows in one file", "Layer 2", "REJECTION_RATE_HIGH"),
    ("File: processing time", "Actual time far from predicted", "Layer 2", "PROCESSING_TIME_MISS"),
    ("Extra", "Near-duplicate records (not in workbook)", "Layer 2", "NEAR_DUPLICATE"),
]


def coverage_report() -> pd.DataFrame:
    """Every workbook anomaly ID with its owner. Show this to anyone asking 'did you cover X?'."""
    return pd.DataFrame(COVERAGE, columns=["workbook_id", "anomaly", "owner", "how"])

# %%
# Cell 4: helpers


def _cfg(overrides: dict | None) -> dict:
    return {**CONFIG, **(overrides or {})}


def _norm_type(file_type: str) -> str:
    t = file_type.strip().upper().replace("-", "_")
    if t not in FILE_TYPES:
        raise ValueError(f"Unknown file type {file_type!r}; expected one of {FILE_TYPES}")
    return t


def guess_file_type(path: str) -> str:
    name = os.path.basename(path).lower()
    for prefix, t in (("bank_txns", "BANK_TXNS"), ("payments", "PAYMENTS"),
                      ("accounts", "ACCOUNTS"), ("rates", "RATES")):
        if name.startswith(prefix):
            return t
    raise ValueError(f"Cannot tell the file type from {name!r}; pass it explicitly")


def _flag(row_number, anomaly_type, rule_ref, score, method, explanation, level="RECORD"):
    return {
        "row_number": None if row_number is None or pd.isna(row_number) else int(row_number),
        "level": level,
        "anomaly_type": anomaly_type,
        "rule_ref": rule_ref,
        "score": round(float(np.clip(score, 0.0, 1.0)), 4),
        "method": method,
        "explanation": explanation,
    }


def _center_spread(s, method: str) -> tuple[float, float]:
    s = pd.Series(s, dtype=float).dropna()
    if method == "sigma":
        return float(s.mean()), float(s.std(ddof=1))
    med = float(s.median())
    return med, float((s - med).abs().median())


def _deviation(x, center: float, spread: float, method: str):
    """Distance from normal in 'standard deviation' units. Robust uses 0.6745 * (x - median) / MAD,
    which matches sigma units for normal data but is not dragged by the outliers themselves."""
    if not spread or np.isnan(spread):
        return np.full(np.shape(x), np.nan)
    x = np.asarray(x, dtype=float)
    return (0.6745 * (x - center) / spread) if method == "robust" else ((x - center) / spread)


def _dev_to_score(z, threshold: float):
    """Threshold maps to 0.5, twice the threshold to 1.0."""
    return np.clip(np.abs(z) / (2 * threshold), 0, 1)


def _method_name(method: str) -> str:
    return "ROBUST_Z" if method == "robust" else "SIGMA_Z"


def _scaled(values: pd.Series, scale: str) -> pd.Series:
    return np.log1p(values.clip(lower=0)) if scale == "log" else values


def _unscaled(value: float, scale: str) -> float:
    return float(np.expm1(value)) if scale == "log" else float(value)


def prepare(df: pd.DataFrame, file_type: str, start_row: int = 1) -> pd.DataFrame:
    """Typed copy plus row_number. Bad values become NaN (Layer 1 rejects those rows anyway).
    Applies the workbook normalisations (ACCT-1/2/6, TXN-1, PAY-1, RATE-1: strip, case)."""
    file_type = _norm_type(file_type)
    missing = [c for c in COLUMNS[file_type] if c not in df.columns]
    if missing:
        raise ValueError(f"{file_type} file is missing columns: {missing}")
    d = df.copy()
    d.index = pd.RangeIndex(len(d))
    d["row_number"] = np.arange(start_row, start_row + len(d))
    for col in ("amount", "balance", "exchange_rate"):
        if col in d:
            d[col] = pd.to_numeric(d[col], errors="coerce")
    for col in ("transaction_date", "payment_date", "rate_date"):
        if col in d:
            d[col] = pd.to_datetime(d[col], errors="coerce")
    for col in ("account_number", "transaction_id", "payment_id", "rate_id", "currency_pair", "ifsc_code", "currency"):
        if col in d:
            d[col] = d[col].astype("string").str.strip().str.upper()
    for col in [c for c in CATS if c != "currency"] + ["rate_type"]:
        if col in d:
            d[col] = d[col].astype("string").str.strip().str.lower()
    return d

# %%
# Cell 5: lookups and history (optional context the engine passes in)


def build_account_lookup(accounts_df: pd.DataFrame) -> dict:
    """{account_number: {"account_type", "balance", "currency"}} from an Accounts file or table.
    Enables T-N11 (overdraft) and the account-type part of T-N12. With the provided data,
    transaction accounts are almost never in Accounts, so expect few matches until organisers confirm."""
    d = prepare(accounts_df, "ACCOUNTS")
    d = d.dropna(subset=["account_number"]).drop_duplicates("account_number", keep="last")
    return d.set_index("account_number")[["account_type", "balance", "currency"]].to_dict("index")


def build_history(previous_df: pd.DataFrame, file_type: str) -> dict:
    """Per-account statistics from earlier files, for P-N12 and A-N12.
    Returns {"file_type", "accounts": {account_number: {"mean", "std", "n"}}}."""
    file_type = _norm_type(file_type)
    col = {"PAYMENTS": "amount", "ACCOUNTS": "balance", "BANK_TXNS": "amount"}.get(file_type)
    if col is None:
        return {}
    d = prepare(previous_df, file_type).dropna(subset=["account_number", col])
    g = d.groupby("account_number")[col].agg(["mean", "std", "count"]).rename(columns={"count": "n"})
    return {"file_type": file_type, "accounts": g.to_dict("index")}

# %%
# Cell 6: Isolation Forest features and reference fitting


def _one_hot(d: pd.DataFrame, col: str) -> pd.DataFrame:
    vals = d[col].astype("string") if col in d else pd.Series(pd.NA, index=d.index, dtype="string")
    out = {f"{col}={c}": vals.eq(c).fillna(False).astype("float32") for c in CATS[col]}
    out[f"{col}=other"] = (~vals.isin(CATS[col])).fillna(True).astype("float32")
    return pd.DataFrame(out, index=d.index)


def make_features(d: pd.DataFrame, file_type: str) -> pd.DataFrame:
    """Row-local features only, so a row scores the same whatever chunk it arrives in.
    Hour is encoded on a circle (sin, cos) so 23:00 and 01:00 count as close."""
    if file_type == "BANK_TXNS":
        ts = d["transaction_date"]
        hour = ts.dt.hour + ts.dt.minute / 60.0
        base = pd.DataFrame({
            "log_amount": np.log1p(d["amount"].clip(lower=0)),
            "hour_sin": np.sin(2 * np.pi * hour / 24), "hour_cos": np.cos(2 * np.pi * hour / 24),
            "weekday": ts.dt.weekday,
        }, index=d.index)
        parts = [base, _one_hot(d, "transaction_type"), _one_hot(d, "currency")]
    elif file_type == "PAYMENTS":
        base = pd.DataFrame({"log_amount": np.log1p(d["amount"].clip(lower=0)),
                             "weekday": d["payment_date"].dt.weekday}, index=d.index)
        parts = [base, _one_hot(d, "payment_method"), _one_hot(d, "payment_status"), _one_hot(d, "currency")]
    elif file_type == "ACCOUNTS":
        base = pd.DataFrame({"log_balance": np.log1p(d["balance"].clip(lower=0))}, index=d.index)
        parts = [base, _one_hot(d, "account_type"), _one_hot(d, "account_status"), _one_hot(d, "currency")]
    else:
        raise ValueError("RATES uses series checks, not Isolation Forest")
    return pd.concat(parts, axis=1).astype("float32")


def _ref_path(file_type: str, model_dir: str) -> str:
    return os.path.join(model_dir, f"anomaly_{file_type.lower()}.joblib")


def fit_reference(train_df: pd.DataFrame, file_type: str, model_dir: str = "models",
                  config: dict | None = None) -> dict:
    """Fit baselines and Isolation Forest on TRAINING rows only, then save.

    Why a saved reference: the score cut-off is fixed from training data, so a clean file
    gets few or no flags. Refitting on every file would always flag its top 0.5%."""
    cfg, file_type = _cfg(config), _norm_type(file_type)
    d = prepare(train_df, file_type)
    import sklearn
    ref = {"version": MODULE_VERSION, "sklearn_version": sklearn.__version__, "file_type": file_type, "rows": int(len(d)),
           "fitted_at": datetime.now().isoformat(timespec="seconds"),
           "outlier_method": cfg["outlier_method"], "group_stats": {}}

    if file_type != "RATES":  # rates checks are per-file series statistics: nothing to fit
        col, groups, _, scale = VALUE_SPEC[file_type]
        vals = _scaled(d[col], scale)
        for key, s in vals.groupby([d[g] for g in groups]):
            s = s.dropna()
            if len(s) >= cfg["min_group_size"]:
                c, sp = _center_spread(s, cfg["outlier_method"])
                ref["group_stats"]["|".join(map(str, key))] = {"center": c, "spread": sp, "n": int(len(s))}

        if file_type == "BANK_TXNS":  # hourly profile for T-N12 when account types are unknown
            hours = d["transaction_date"].dt.hour.dropna().astype(int)
            ref["hour_share"] = hours.value_counts(normalize=True).reindex(range(24), fill_value=0.0).to_dict()

        X = make_features(d, file_type).dropna()
        model = IsolationForest(n_estimators=cfg["iforest_trees"], contamination=cfg["iforest_contamination"],
                                random_state=42, n_jobs=-1).fit(X)
        raw = -model.score_samples(X)  # higher = more anomalous
        ref.update({
            "model": model,
            "feature_cols": list(X.columns),
            "cutoff": float(np.quantile(raw, 1 - cfg["iforest_contamination"])),
            "score_quantiles": np.quantile(raw, np.linspace(0, 1, 1001)),  # score -> percentile
            "feature_median": X.median().to_dict(),
            "feature_mad": {c: float((X[c] - X[c].median()).abs().median()) for c in X.columns},
        })
    if "model" in ref and hasattr(ref["model"], "_shap_explainer"):
        del ref["model"]._shap_explainer
    os.makedirs(model_dir, exist_ok=True)
    joblib.dump(ref, _ref_path(file_type, model_dir))
    return ref


def load_reference(file_type: str, model_dir: str = "models") -> dict | None:
    """Load a saved reference. Records which scikit-learn version trained it, so a mismatch
    with the installed version is visible (models from another version usually work, but
    predictions are only guaranteed with the same version)."""
    import warnings
    import sklearn
    path = _ref_path(_norm_type(file_type), model_dir)
    if not os.path.exists(path):
        return None
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ref = joblib.load(path)
    trained = ref.get("sklearn_version")
    for w in caught:
        trained = trained or getattr(w.message, "original_sklearn_version", None)
    ref["sklearn_trained"] = trained or (sklearn.__version__ if "model" in ref else None)
    ref["sklearn_runtime"] = sklearn.__version__
    ref["sklearn_mismatch"] = ref["sklearn_trained"] != sklearn.__version__ and "model" in ref
    return ref

# %%
# Cell 7: row-level checks (safe per chunk: each row is judged on its own plus saved baselines)


def _check_high_value(d, file_type, ref, cfg):
    col, groups, a_type, scale = VALUE_SPEC[file_type]
    method, thr = cfg["outlier_method"], cfg["outlier_threshold"]
    vals = _scaled(d[col], scale)
    keys = d[groups].astype(str).agg("|".join, axis=1)
    stats = (ref or {}).get("group_stats") or {}
    flags = []
    for key, idx in keys.groupby(keys).groups.items():
        s = vals.loc[idx]
        if key in stats:
            c, sp = stats[key]["center"], stats[key]["spread"]
        elif s.notna().sum() >= cfg["min_group_size"]:
            c, sp = _center_spread(s, method)
        else:
            continue
        z = _deviation(s.values, c, sp, method)
        hit = np.nan_to_num(z) > thr  # high side only
        for i, zi in zip(np.asarray(idx)[hit], z[hit]):
            flags.append(_flag(d.at[i, "row_number"], a_type, "AI: statistical outlier", _dev_to_score(zi, thr),
                               _method_name(method),
                               f"{col} {d.at[i, col]:,.2f} is {zi:.1f} SDs above normal "
                               f"({_unscaled(c, scale):,.0f}) for {key.replace('|', ', ')}"))
    return flags


def _check_threshold(d, cfg, fx_to_inr: dict | None):
    """T-N14. INR rows directly; other currencies only if an FX table is supplied."""
    thr, band = cfg["reporting_threshold_inr"], cfg["threshold_band_inr"]
    rate = d["currency"].map({"INR": 1.0, **(fx_to_inr or {})}).astype(float)
    inr = d["amount"] * rate
    flags = []
    near = (inr >= thr - band) & (inr < thr)
    for i in d.index[near.fillna(False)]:
        flags.append(_flag(d.at[i, "row_number"], "NEAR_REPORTING_THRESHOLD", "T-N14", 0.7, "RULE",
                           f"INR {inr[i]:,.2f} is within {band:,.0f} below the {thr:,.0f} reporting threshold"))
    amt = d["amount"]
    rnd = (amt >= cfg["round_amount_min"]) & np.isclose(amt.fillna(0.5) % 1000, 0)
    for i in d.index[rnd.fillna(False)]:
        flags.append(_flag(d.at[i, "row_number"], "ROUND_AMOUNT", "T-N14", 0.5, "RULE",
                           f"Amount {amt[i]:,.0f} is an exact multiple of 1,000"))
    return flags


def _check_overdraft(d, accounts: dict | None):
    """T-N11: debit larger than the account's balance (same currency only)."""
    if not accounts:
        return []
    acc = d["account_number"].map(accounts)
    flags = []
    for i in d.index[acc.notna() & d["transaction_type"].eq("debit").fillna(False)]:
        a = acc[i]
        if a.get("currency") == d.at[i, "currency"] and pd.notna(a.get("balance")) and d.at[i, "amount"] > a["balance"]:
            flags.append(_flag(d.at[i, "row_number"], "OVERDRAFT", "T-N11", 0.8, "RULE",
                               f"Debit {d.at[i, 'amount']:,.2f} exceeds account balance {a['balance']:,.2f}"))
    return flags


def _check_unusual_time(d, ref, accounts, cfg):
    """T-N12. With account types: night window for non-business accounts (the workbook example).
    Without them: hours that are rare in the reference profile."""
    hour = d["transaction_date"].dt.hour
    flags = []
    if accounts:
        acc_type = d["account_number"].map({k: v.get("account_type") for k, v in accounts.items()})
        night = (hour >= cfg["night_start_hour"]) & (hour < cfg["night_end_hour"])
        hit = night & acc_type.notna() & (acc_type != "business")
        for i in d.index[hit.fillna(False)]:
            flags.append(_flag(d.at[i, "row_number"], "UNUSUAL_TIME", "T-N12", 0.6, "RULE",
                               f"{d.at[i, 'transaction_type']} at {d.at[i, 'transaction_date']:%H:%M} on a "
                               f"{acc_type[i]} account (night window {cfg['night_start_hour']:02d}:00 to "
                               f"{cfg['night_end_hour']:02d}:00)"))
        return flags
    share = (ref or {}).get("hour_share")
    if not share:
        return []
    s = hour.map(share)
    for i in d.index[(s < cfg["rare_hour_share"]).fillna(False)]:
        flags.append(_flag(d.at[i, "row_number"], "UNUSUAL_TIME", "T-N12", 0.6, "RULE",
                           f"Hour {int(hour[i]):02d}:00 appears in only {s[i]:.1%} of reference transactions"))
    return flags


def _check_stale_pending(d, today, cfg):
    age = (today - d["payment_date"]).dt.days
    hit = d["payment_status"].eq("pending") & (age > cfg["stale_pending_days"])
    return [_flag(d.at[i, "row_number"], "STALE_PENDING_PAYMENT", "P-N11", 0.6, "RULE",
                  f"Pending for {int(age[i])} days (limit {cfg['stale_pending_days']})")
            for i in d.index[hit.fillna(False)]]


def _check_account_history(d, file_type, history, cfg):
    """P-N12 (payment vs account average) and A-N12 (balance spike), when history exists."""
    accs = (history or {}).get("accounts") or {}
    if not accs:
        return []
    col = "amount" if file_type == "PAYMENTS" else "balance"
    stats = d["account_number"].map(accs)
    flags = []
    for i in d.index[stats.notna()]:
        st, v = stats[i], d.at[i, col]
        if st.get("n", 0) < cfg["account_history_min_n"] or pd.isna(v) or not st.get("mean"):
            continue
        if file_type == "ACCOUNTS" and v > cfg["balance_spike_multiple"] * st["mean"]:
            flags.append(_flag(d.at[i, "row_number"], "BALANCE_SPIKE", "A-N12", 0.8, "RULE",
                               f"Balance {v:,.2f} is {v / st['mean']:.1f}x the account's average {st['mean']:,.2f}"))
        elif file_type == "PAYMENTS" and st.get("std"):
            z = (v - st["mean"]) / st["std"]
            if z > cfg["payment_above_avg_z"]:
                flags.append(_flag(d.at[i, "row_number"], "PAYMENT_ABOVE_ACCOUNT_AVG", "P-N12",
                                   _dev_to_score(z, cfg["payment_above_avg_z"]), "SIGMA_Z",
                                   f"Payment {v:,.2f} is {z:.1f} SDs above this account's average "
                                   f"{st['mean']:,.2f} ({int(st['n'])} past payments)"))
    return flags


def _driver_text(feat: str, x_row: pd.Series, d_row: pd.Series) -> str:
    """Turn a model feature into words using the original row values."""
    if feat in ("hour_sin", "hour_cos"):
        return f"time of day {d_row['transaction_date']:%H:%M}"
    if feat == "weekday":
        ts = d_row["transaction_date"] if "transaction_date" in d_row else d_row.get("payment_date")
        return f"weekday {ts:%A}" if pd.notna(ts) else "weekday"
    if feat in ("log_amount", "log_balance"):
        col = "amount" if feat == "log_amount" else "balance"
        return f"{col} {d_row[col]:,.2f}"
    if "=" in feat:
        col, val = feat.split("=", 1)
        return f"{col} = {d_row.get(col)}" if val == "other" else f"{col} = {val}"
    return f"{feat} = {x_row[feat]:.2f}"


def _top_drivers(model, Xh, med, mad, cfg) -> list[str]:
    """SHAP when available (largest absolute contribution), else largest robust deviation."""
    if shap is not None and len(Xh) <= cfg["max_shap_rows"]:
        try:
            explainer = getattr(model, "_shap_explainer", None)
            if explainer is None:  # build once per model; rebuilding per chunk is slow
                explainer = shap.TreeExplainer(model)
                model._shap_explainer = explainer
            sv = np.abs(np.asarray(explainer.shap_values(Xh)))
            return [Xh.columns[k] for k in sv.argmax(axis=1)]
        except Exception:
            pass
    dev = ((Xh - med) * 0.6745 / mad.replace(0, np.nan)).abs().fillna(0)
    return [Xh.columns[k] for k in dev.values.argmax(axis=1)]


def _check_iforest(d, file_type, ref, cfg):
    X = make_features(d, file_type)
    ok = X.notna().all(axis=1).values
    if ref and "model" in ref:
        X = X.reindex(columns=ref["feature_cols"], fill_value=0.0)
        model, cutoff, q = ref["model"], ref["cutoff"], ref["score_quantiles"]
        med, mad = pd.Series(ref["feature_median"]), pd.Series(ref["feature_mad"])
    elif ok.sum() >= cfg["iforest_min_rows"]:
        # Fallback with no saved reference: fit on this data and flag its own top share.
        model = IsolationForest(n_estimators=cfg["iforest_trees"], contamination=cfg["iforest_contamination"],
                                random_state=42, n_jobs=-1).fit(X[ok])
        r = -model.score_samples(X[ok])
        cutoff, q = float(np.quantile(r, 1 - cfg["iforest_contamination"])), np.quantile(r, np.linspace(0, 1, 1001))
        med, mad = X[ok].median(), (X[ok] - X[ok].median()).abs().median()
    else:
        return []
    if not ok.any():
        return []
    raw = np.full(len(X), -np.inf)
    raw[ok] = -model.score_samples(X[ok])
    hit = np.where(raw > cutoff)[0]
    if len(hit) == 0:
        return []
    pct = np.interp(raw[hit], q, np.linspace(0, 1, len(q)))
    Xh = X.iloc[hit]
    drivers = _top_drivers(model, Xh, med, mad, cfg)
    flags = []
    for k, j in enumerate(hit):
        i = d.index[j]
        flags.append(_flag(d.at[i, "row_number"], "MULTIVARIATE_OUTLIER", "AI: statistical outlier", pct[k],
                           "IFOREST", f"Unusual combination, more anomalous than {pct[k]:.2%} of training rows. "
                                      f"Main driver: {_driver_text(drivers[k], Xh.iloc[k], d.loc[i])}"))
    return flags

# %%
# Cell 8: file-wide checks (need all rows of the file: run once in finish())


def _check_txn_velocity(acc: pd.DataFrame, cfg):
    s = acc.dropna(subset=["account_number", "transaction_date"]).sort_values(["account_number", "transaction_date"])
    if s.empty:
        return []
    s = s.assign(one=1.0)
    counts = (s.set_index("transaction_date").groupby("account_number")["one"]
              .rolling(cfg["velocity_window"]).sum().reset_index(level=0, drop=True))
    s["burst"] = counts.values
    hit = s[s["burst"] >= cfg["velocity_count"]]
    return [_flag(r.row_number, "TXN_VELOCITY", "T-N13", min(1.0, 0.5 + 0.1 * r.burst), "RULE",
                  f"{int(r.burst)} transactions on account {r.account_number} within {cfg['velocity_window']}")
            for r in hit.itertuples()]


def _check_payment_burst(acc: pd.DataFrame, cfg):
    s = acc.dropna(subset=["account_number", "payment_date"])
    n = s.groupby([s["account_number"], s["payment_date"].dt.date])["account_number"].transform("size")
    hit = s[n >= cfg["payment_burst_per_day"]]
    return [_flag(r.row_number, "PAYMENT_BURST", "P-N13", min(1.0, 0.5 + 0.1 * n[r.Index]), "RULE",
                  f"{int(n[r.Index])} payments from account {r.account_number} on {r.payment_date:%Y-%m-%d} "
                  f"(no recipient column, so grouped by paying account)")
            for r in hit.itertuples()]


def _check_near_duplicates(acc: pd.DataFrame, id_col: str, date_col: str, type_col: str):
    """Same account, same day, same type, amounts within 1, different IDs (exact duplicates are T-9)."""
    a = acc.dropna(subset=["account_number", date_col, "amount"])
    day = a[date_col].dt.date
    size = a.groupby([a["account_number"], day, a[type_col]])["account_number"].transform("size")
    cand = a[size >= 2]
    flags = []
    for _, grp in cand.groupby([cand["account_number"], cand[date_col].dt.date, cand[type_col]]):
        grp = grp.sort_values("amount")
        close = grp["amount"].diff().abs().lt(1.0).values
        for pos in np.where(close)[0]:
            prev, cur = grp.iloc[pos - 1], grp.iloc[pos]
            if prev[id_col] != cur[id_col]:
                flags.append(_flag(cur.row_number, "NEAR_DUPLICATE", "Extra", 0.6, "RULE",
                                   f"Matches row {int(prev.row_number)} ({prev[id_col]}): same account, day and "
                                   f"type, amount differs by {abs(cur.amount - prev.amount):.2f}"))
    return flags


def _check_rates(d: pd.DataFrame, today: pd.Timestamp, cfg):
    flags = []
    d = d.dropna(subset=["currency_pair", "rate_date", "exchange_rate", "rate_type"])
    d = d[d["rate_type"].isin(["buy", "sell"])]
    if d.empty:
        return [_flag(None, "MISSING_COMMON_PAIR", "R-N11", 0.7, "RULE", f"No usable rates for {p}", "FILE")
                for p in cfg["common_pairs"]]
    rows_of = d.groupby(["currency_pair", "rate_type", "rate_date"])["row_number"].apply(list)
    # One value per pair, type and day; extra quotes per day are Layer 1 (R-6). Mean keeps the series usable.
    daily = (d.groupby(["currency_pair", "rate_type", "rate_date"])["exchange_rate"].mean()
             .reset_index().sort_values(["currency_pair", "rate_type", "rate_date"]))
    g = daily.groupby(["currency_pair", "rate_type"])
    daily["pct"] = g["exchange_rate"].pct_change()
    daily["gap_days"] = g["rate_date"].diff().dt.days
    method, thr = cfg["outlier_method"], cfg["outlier_threshold"]

    # R-N10: jumps. Statistical (relative to the pair's own volatility) first, then the literal 5% rule.
    for (pair, rtype), s in daily.groupby(["currency_pair", "rate_type"]):
        p = s["pct"].dropna()
        if p.empty:
            continue
        c, sp = _center_spread(p, method) if len(p) >= cfg["min_group_size"] else (np.nan, np.nan)
        z = _deviation(p.values, c, sp, method)
        for k, zi in zip(p.index, z):
            pct, rows = s.at[k, "pct"], rows_of[(pair, rtype, s.at[k, "rate_date"])]
            if np.nan_to_num(abs(zi)) > thr:
                flags += [_flag(rn, "RATE_JUMP", "R-N10", _dev_to_score(zi, thr), _method_name(method),
                                f"{pair} {rtype} moved {pct:+.1%} vs previous day, {abs(zi):.1f} SDs from this "
                                f"pair's usual daily move") for rn in rows]
            elif cfg["rate_jump_rule_enabled"] and abs(pct) > cfg["rate_jump_pct"]:
                flags += [_flag(rn, "RATE_JUMP_5PCT", "R-N10", 0.5, "RULE",
                                f"{pair} {rtype} moved {pct:+.1%} vs previous day (limit {cfg['rate_jump_pct']:.0%})")
                          for rn in rows]

    # R-N9: no update for more than N days within the series.
    for r in daily[daily["gap_days"] > cfg["rate_stale_days"]].itertuples():
        flags += [_flag(rn, "STALE_RATE", "R-N9", 0.5, "RULE",
                        f"{r.currency_pair} {r.rate_type}: {int(r.gap_days)} days since the previous rate")
                  for rn in rows_of[(r.currency_pair, r.rate_type, r.rate_date)]]

    # R-8: latest usable (non-future) rate for a pair is older than the freshness window.
    past = daily[daily["rate_date"] <= today]
    for (pair, rtype), last in past.groupby(["currency_pair", "rate_type"])["rate_date"].max().items():
        age = (today - last).days
        if age > cfg["rate_stale_days"]:
            flags.append(_flag(None, "PAIR_STALE", "R-N9", 0.6, "RULE",
                               f"Latest {pair} {rtype} rate is {age} days old ({last:%Y-%m-%d})", "FILE"))

    # R-N8 and R-N12: spread checks need buy and sell on the same day.
    wide = daily.pivot_table(index=["currency_pair", "rate_date"], columns="rate_type", values="exchange_rate")
    if {"buy", "sell"} <= set(wide.columns):
        wide = wide.dropna(subset=["buy", "sell"])
        wide["spread"] = wide["buy"] - wide["sell"]
        for (pair, day), r in wide[wide["spread"] < 0].iterrows():
            flags += [_flag(rn, "INVERTED_SPREAD", "R-N8", 0.6, "RULE",
                            f"{pair} on {day:%Y-%m-%d}: sell {r['sell']:.4f} above buy {r['buy']:.4f}")
                      for rn in rows_of[(pair, "sell", day)]]
        sthr = cfg["rate_spread_threshold"]
        for pair, s in wide[wide["spread"] >= 0].groupby(level=0):
            if len(s) < cfg["min_group_size"]:
                continue
            c, sp = _center_spread(s["spread"], method)
            z = _deviation(s["spread"].values, c, sp, method)
            for (p, day), zi in zip(s.index, z):
                if np.nan_to_num(zi) > sthr:
                    flags += [_flag(rn, "WIDE_SPREAD", "R-N12", _dev_to_score(zi, sthr), _method_name(method),
                                    f"{p} spread on {day:%Y-%m-%d} is {zi:.1f} SDs wider than usual")
                              for rn in rows_of[(p, "buy", day)]]

    # R-N11: commonly traded pairs missing from the file.
    present = set(d["currency_pair"])
    flags += [_flag(None, "MISSING_COMMON_PAIR", "R-N11", 0.7, "RULE", f"No {p} rates in this file", "FILE")
              for p in cfg["common_pairs"] if p not in present]
    return flags

# %%
# Cell 9: public API used by the engine


class AnomalyDetector:
    """One instance per file. Load the reference once per worker process and pass it in.

    lookups: {"accounts": build_account_lookup(...), "fx_to_inr": {"USD": 83.2, ...}}  (optional)
    history: build_history(previous_files_df, file_type)                                (optional)
    """

    # Columns kept across chunks for the file-wide checks (a few columns per row).
    _KEEP = {"BANK_TXNS": ["row_number", "transaction_id", "account_number", "transaction_date", "transaction_type", "amount"],
             "PAYMENTS": ["row_number", "payment_id", "account_number", "payment_date", "payment_method", "amount"],
             "RATES": ["row_number", "currency_pair", "rate_date", "exchange_rate", "rate_type"]}

    def __init__(self, file_type: str, model_dir: str = "models", lookups: dict | None = None,
                 history: dict | None = None, config: dict | None = None, today=None, reference: dict | None = None):
        self.file_type = _norm_type(file_type)
        self.cfg = _cfg(config)
        self.ref = reference if reference is not None else load_reference(self.file_type, model_dir)
        self.lookups = lookups or {}
        self.history = history or {}
        self.today = pd.Timestamp(today).normalize() if today is not None else pd.Timestamp.now().normalize()
        self._kept: list[pd.DataFrame] = []
        self.rows_seen = 0

    def score_chunk(self, df: pd.DataFrame, start_row: int | None = None) -> list[dict]:
        """Row-level checks for one chunk of Layer-1-valid rows. start_row = file row number of the first row."""
        if df is None or df.empty:
            return []
        start_row = self.rows_seen + 1 if start_row is None else start_row
        d = prepare(df, self.file_type, start_row)
        self.rows_seen = max(self.rows_seen, start_row + len(d) - 1)
        if self.file_type in self._KEEP:
            self._kept.append(d[self._KEEP[self.file_type]].copy())
        ft, cfg, ref = self.file_type, self.cfg, self.ref
        if ft == "RATES":
            return []  # every rates check is a series check, done in finish()
        flags = _check_high_value(d, ft, ref, cfg)
        if ft == "BANK_TXNS":
            accounts = self.lookups.get("accounts")
            flags += _check_threshold(d, cfg, self.lookups.get("fx_to_inr"))
            flags += _check_overdraft(d, accounts)
            flags += _check_unusual_time(d, ref, accounts, cfg)
        elif ft == "PAYMENTS":
            flags += _check_stale_pending(d, self.today, cfg)
            flags += _check_account_history(d, ft, self.history, cfg)
        elif ft == "ACCOUNTS":
            flags += _check_account_history(d, ft, self.history, cfg)
        flags += _check_iforest(d, ft, ref, cfg)
        return flags

    def finish(self) -> list[dict]:
        """File-wide checks once every chunk has been scored. Resets the detector for the next file."""
        if not self._kept:
            return []
        acc = pd.concat(self._kept, ignore_index=True)
        self._kept, self.rows_seen = [], 0
        ft, cfg = self.file_type, self.cfg
        if ft == "BANK_TXNS":
            return _check_txn_velocity(acc, cfg) + _check_near_duplicates(acc, "transaction_id", "transaction_date", "transaction_type")
        if ft == "PAYMENTS":
            return _check_payment_burst(acc, cfg) + _check_near_duplicates(acc, "payment_id", "payment_date", "payment_method")
        if ft == "RATES":
            return _check_rates(acc, self.today, cfg)
        return []

    def score_file(self, df: pd.DataFrame, chunk_size: int = 50000) -> list[dict]:
        """Score a whole DataFrame in chunks, exactly as the engine would."""
        flags = []
        for start in range(0, len(df), chunk_size):
            flags += self.score_chunk(df.iloc[start:start + chunk_size], start_row=start + 1)
        return flags + self.finish()


def score_record_anomalies(df, file_type, start_row=1, history=None, model_dir="models", lookups=None, today=None):
    """Function form from CONTRACTS.md: one call for a whole (small) file."""
    det = AnomalyDetector(file_type, model_dir=model_dir, lookups=lookups, history=history, today=today)
    return det.score_chunk(df, start_row) + det.finish()


def to_db_rows(flags: list[dict], file_id: int) -> list[dict]:
    """Rows for the anomalies table. rule_ref needs one extra TEXT column (tell P3)."""
    return [{"file_id": file_id, **f} for f in flags]

# %%
# Cell 10: file-level anomalies (after a file finishes)


def detect_file_anomalies(features: dict, history: list[dict] | None = None, config: dict | None = None) -> list[dict]:
    """features: {"file_type", "size_bytes", "total_records", "rejected_records", "actual_seconds", "predicted_seconds"}
    history: past files with the same keys. Short history falls back to fixed floors."""
    cfg = _cfg(config)
    ft = features.get("file_type")
    history = [h for h in (history or []) if h.get("file_type") == ft]
    thr, n_min = cfg["outlier_threshold"], cfg["file_min_history"]
    flags = []

    def dev_vs_history(values, value):
        past = pd.Series(values, dtype=float).dropna()
        if len(past) < n_min:
            return None
        c, sp = _center_spread(past, "robust")
        return None if not sp else float(_deviation(np.array([value]), c, sp, "robust")[0])

    for key, a_type, label in (("size_bytes", "FILE_SIZE_UNUSUAL", "size (bytes)"),
                               ("total_records", "RECORD_COUNT_UNUSUAL", "record count")):
        v = features.get(key)
        if v:
            z = dev_vs_history([np.log1p(h[key]) for h in history if h.get(key)], np.log1p(v))
            if z is not None and abs(z) > thr:
                flags.append(_flag(None, a_type, "File: volume", _dev_to_score(z, thr), "ROBUST_Z",
                                   f"File {label} {v:,.0f} is {abs(z):.1f} SDs from past {ft} files", "FILE"))

    total, rej = features.get("total_records") or 0, features.get("rejected_records") or 0
    if total:
        rate = rej / total
        past = [h["rejected_records"] / h["total_records"] for h in history if h.get("total_records")]
        z = dev_vs_history(past, rate)
        if z is not None:
            if z > thr:
                flags.append(_flag(None, "REJECTION_RATE_HIGH", "File: rejection spike", _dev_to_score(z, thr),
                                   "ROBUST_Z", f"{rate:.1%} of rows rejected vs usual {np.median(past):.1%}", "FILE"))
        elif rate > cfg["file_rejection_floor"]:
            flags.append(_flag(None, "REJECTION_RATE_HIGH", "File: rejection spike", 0.6, "RULE",
                               f"{rate:.1%} of rows rejected (floor {cfg['file_rejection_floor']:.0%}; "
                               f"not enough history for a baseline)", "FILE"))

    act, pred = features.get("actual_seconds"), features.get("predicted_seconds")
    if act is not None and pred:
        res = act - pred
        past_res = pd.Series([h["actual_seconds"] - h["predicted_seconds"] for h in history
                              if h.get("actual_seconds") is not None and h.get("predicted_seconds")], dtype=float)
        limit = cfg["prediction_miss_floor"] * pred
        if len(past_res) >= n_min:
            limit = max(limit, 3 * float((past_res - past_res.median()).abs().median()))
        if abs(res) > limit:
            flags.append(_flag(None, "PROCESSING_TIME_MISS", "File: processing time", min(1.0, abs(res) / (2 * limit)),
                               "RULE", f"Took {act:.1f}s vs {pred:.1f}s predicted ({res:+.1f}s)", "FILE"))
    return flags

# %%
# Cell 11: evaluation (70/15/15 split from the workbook ML Training sheet)


def split_70_15_15(df: pd.DataFrame, seed: int = 42):
    """Random split into train / validation / test. Not for RATES: series must stay in date order."""
    idx = np.random.default_rng(seed).permutation(len(df))
    a, b = int(0.70 * len(df)), int(0.85 * len(df))
    return (df.iloc[idx[:a]].reset_index(drop=True), df.iloc[idx[a:b]].reset_index(drop=True),
            df.iloc[idx[b:]].reset_index(drop=True))


def inject_for_test(df: pd.DataFrame, file_type: str, n: int = 20, seed: int = 7, today=None):
    """MODULE SELF-TEST ONLY: plant n anomalies of each supported type, with a truth table.
    The team's dataset generator replaces this for the official evaluation numbers."""
    ft, rng = _norm_type(file_type), np.random.default_rng(seed)
    today = pd.Timestamp(today).normalize() if today is not None else pd.Timestamp.now().normalize()
    out, truth = df.copy().reset_index(drop=True), []

    def setv(i, col, val):
        out.iat[int(i), out.columns.get_loc(col)] = val

    rows = rng.choice(len(df), size=min(3 * n, len(df)), replace=False)
    if ft in ("BANK_TXNS", "PAYMENTS"):
        amt = pd.to_numeric(df["amount"], errors="coerce")
        for i in rows[:n]:
            setv(i, "amount", f"{amt.max() * 3:.2f}"); truth.append((i + 1, VALUE_SPEC[ft][2]))
        if ft == "BANK_TXNS":
            for i in rows[n:2 * n]:
                setv(i, "amount", f"{rng.uniform(499000, 499999):.2f}"); setv(i, "currency", "INR")
                truth.append((i + 1, "NEAR_REPORTING_THRESHOLD"))
            for i in rows[2 * n:]:
                setv(i, "amount", f"{rng.integers(20, 400) * 1000:.2f}"); truth.append((i + 1, "ROUND_AMOUNT"))
            extra = []
            for b in range(max(1, n // 2)):  # bursts: 3 transactions in 6 minutes on a fresh account
                base = df.iloc[int(rng.integers(len(df)))].copy()
                acct, t0 = f"77{rng.integers(10**8, 10**9)}", pd.Timestamp("2025-06-01 10:00") + pd.Timedelta(days=b)
                for m in range(3):
                    r = base.copy()
                    r["transaction_id"], r["account_number"] = f"TRXBURST{b}_{m}", acct
                    r["transaction_date"] = f"{t0 + pd.Timedelta(minutes=3 * m):%Y-%m-%d %H:%M:%S}"
                    r["amount"] = f"{1000 + 777 * m:.2f}"
                    extra.append(r)
            start = len(out) + 1
            out = pd.concat([out, pd.DataFrame(extra)], ignore_index=True)
            truth += [(start + k, "TXN_VELOCITY") for k in range(len(extra)) if k % 3 == 2]
        else:
            for i in rows[n:2 * n]:
                setv(i, "payment_status", "pending")
                setv(i, "payment_date", f"{today - pd.Timedelta(days=60):%Y-%m-%d}")
                truth.append((i + 1, "STALE_PENDING_PAYMENT"))
    elif ft == "ACCOUNTS":
        bal = pd.to_numeric(df["balance"], errors="coerce")
        for i in rows[:n]:
            setv(i, "balance", f"{bal.max() * 3:.2f}"); truth.append((i + 1, "HIGH_BALANCE"))
    elif ft == "RATES":
        rate = pd.to_numeric(df["exchange_rate"], errors="coerce")
        for i in rows[:n]:
            setv(i, "exchange_rate", f"{rate.iloc[int(i)] * 3:.8f}"); truth.append((i + 1, "RATE_JUMP"))
    return out, pd.DataFrame(truth, columns=["row_number", "anomaly_type"])


def evaluate(flags: list[dict], truth: pd.DataFrame) -> pd.DataFrame:
    """Recall per injected type, plus how many other rows each type flagged.
    'Other flags' can be natural anomalies or false positives: on real data we cannot tell them apart."""
    f = pd.DataFrame(flags)
    any_flag = set(f["row_number"].dropna().astype(int)) if len(f) else set()
    rows = []
    for a_type, t in truth.groupby("anomaly_type"):
        flagged = set(f.loc[f["anomaly_type"] == a_type, "row_number"].dropna().astype(int)) if len(f) else set()
        planted = set(t["row_number"].astype(int))
        tp = len(planted & flagged)
        rows.append({"anomaly_type": a_type, "injected": len(planted), "caught_as_this_type": tp,
                     "caught_by_any_check": len(planted & any_flag), "recall": round(tp / len(planted), 3),
                     "other_flags_of_this_type": len(flagged - planted)})
    return pd.DataFrame(rows)

# %%
# Cell 11b: overfitting checks and benchmark scores (for the model evaluation slide)


def iforest_percentiles(df: pd.DataFrame, file_type: str, ref: dict) -> np.ndarray:
    """Isolation Forest score of every row as a percentile of the TRAINING score distribution."""
    ft = _norm_type(file_type)
    d = prepare(df, ft)
    X = make_features(d, ft).reindex(columns=ref["feature_cols"], fill_value=0.0)
    ok = X.notna().all(axis=1).values
    out = np.full(len(X), np.nan)
    if ok.any():
        raw = -ref["model"].score_samples(X[ok])
        q = ref["score_quantiles"]
        out[ok] = np.interp(raw, q, np.linspace(0, 1, len(q)))
    return out


def overfitting_check(splits: dict, file_type: str, ref: dict, config: dict | None = None) -> pd.DataFrame:
    """Flag rates on data the model was fitted on vs data it never saw.
    No overfitting looks like: similar rates on every split, and the Isolation Forest rate near the
    contamination target (0.5%). Overfitting looks like: low rates on train, much higher on unseen data."""
    cfg, ft = _cfg(config), _norm_type(file_type)
    value_type = VALUE_SPEC[ft][2]
    rows = []
    for name, df in splits.items():
        flags = pd.DataFrame(AnomalyDetector(ft, reference=ref, config=config).score_file(df))
        n = len(df)
        share = lambda mask: round(100 * flags.loc[mask, "row_number"].nunique() / n, 3) if len(flags) else 0.0
        rows.append({"split": name, "rows": n,
                     "iforest_flag_%": share(flags["method"] == "IFOREST") if len(flags) else 0.0,
                     f"{value_type}_flag_%": share(flags["anomaly_type"] == value_type) if len(flags) else 0.0,
                     "any_flag_%": share(flags["row_number"].notna()) if len(flags) else 0.0,
                     "iforest_target_%": 100 * cfg["iforest_contamination"]})
    return pd.DataFrame(rows)


def baseline_drift(ref: dict, other_df: pd.DataFrame, file_type: str, config: dict | None = None) -> pd.DataFrame:
    """Compare the saved group baselines with the same statistics on an independent file.
    Small differences mean the baselines describe the data, not the training sample."""
    cfg, ft = _cfg(config), _norm_type(file_type)
    col, groups, _, scale = VALUE_SPEC[ft]
    d = prepare(other_df, ft)
    vals = _scaled(d[col], scale)
    rows = []
    for key, s in vals.groupby([d[g] for g in groups]):
        k = "|".join(map(str, key))
        if k in ref["group_stats"] and s.notna().sum() >= cfg["min_group_size"]:
            c, sp = _center_spread(s, ref["outlier_method"])
            rc, rsp = ref["group_stats"][k]["center"], ref["group_stats"][k]["spread"]
            tc, oc = _unscaled(rc, scale), _unscaled(c, scale)
            rows.append({"group": k.replace("|", ", "), "train_center": round(tc, 2), "other_center": round(oc, 2),
                         "center_diff_%": round(100 * (oc - tc) / abs(tc), 2) if tc else np.nan,
                         "spread_diff_%": round(100 * (sp - rsp) / abs(rsp), 2) if rsp else np.nan})
    return pd.DataFrame(rows)


def benchmark(eval_df: pd.DataFrame, file_type: str, ref: dict | None, seeds=(1, 2, 3, 4, 5), n: int = 100,
              today=None, config: dict | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Repeat inject-and-detect over several seeds on held-out data.
    Returns (per-seed scores, summary with mean and std).
    precision_vs_planted is a lower bound: real anomalies already in the data count against it."""
    from sklearn.metrics import average_precision_score, roc_auc_score
    ft = _norm_type(file_type)
    per_seed = []
    for seed in seeds:
        inj, truth = inject_for_test(eval_df, ft, n=n, seed=seed, today=today)
        flags = pd.DataFrame(AnomalyDetector(ft, reference=ref, config=config, today=today).score_file(inj))
        for a_type, t in truth.groupby("anomaly_type"):
            planted = set(t["row_number"].astype(int))
            got = set(flags.loc[flags["anomaly_type"] == a_type, "row_number"].dropna().astype(int)) if len(flags) else set()
            tp = len(planted & got)
            rec, prec = tp / len(planted), (tp / len(got) if got else 0.0)
            per_seed.append({"seed": seed, "anomaly_type": a_type, "planted": len(planted), "recall": rec,
                             "precision_vs_planted": prec, "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0})
        if ref is not None and "model" in ref:  # threshold-free view of the ML model alone
            y = np.zeros(len(inj), dtype=int)
            y[truth["row_number"].astype(int).values - 1] = 1
            sc = iforest_percentiles(inj, ft, ref)
            m = ~np.isnan(sc)
            per_seed.append({"seed": seed, "anomaly_type": "IFOREST (all planted)", "planted": int(y.sum()),
                             "roc_auc": roc_auc_score(y[m], sc[m]), "pr_auc": average_precision_score(y[m], sc[m])})
    per = pd.DataFrame(per_seed)
    metrics = [c for c in ("recall", "precision_vs_planted", "f1", "roc_auc", "pr_auc") if c in per]
    summ = per.groupby("anomaly_type")[metrics].agg(["mean", "std"]).round(3)
    summ.columns = [f"{m}_{s}" for m, s in summ.columns]
    return per, summ.dropna(axis=1, how="all").reset_index()

# %%
# Cell 12: command line (python -m app.services.anomaly_engine "bank_txns_100,000.csv" --eval)


def main():
    ap = argparse.ArgumentParser(description="Layer 2 anomaly detection")
    ap.add_argument("path")
    ap.add_argument("--type", help="ACCOUNTS | BANK_TXNS | PAYMENTS | RATES (default: from file name)")
    ap.add_argument("--eval", action="store_true", help="70/15/15 split, fit on train, inject into test, report recall")
    ap.add_argument("--fit", action="store_true", help="fit the reference on the whole file and save it")
    ap.add_argument("--model-dir", default="models")
    ap.add_argument("--out", default="anomalies_out.csv")
    args = ap.parse_args()

    ft = _norm_type(args.type) if args.type else guess_file_type(args.path)
    df = pd.read_csv(args.path, dtype=str)
    print(f"Loaded {len(df):,} rows as {ft}")

    if args.eval:
        train, _, test = (df, None, df) if ft == "RATES" else split_70_15_15(df)
        t = time.time()
        ref = fit_reference(train, ft, args.model_dir)
        print(f"Fitted on {len(train):,} training rows in {time.time() - t:.1f}s")
        test_inj, truth = inject_for_test(test, ft)
        t = time.time()
        flags = AnomalyDetector(ft, reference=ref).score_file(test_inj)
        print(f"Scored {len(test_inj):,} test rows in {time.time() - t:.1f}s\n")
        print(evaluate(flags, truth).to_string(index=False))
    else:
        if args.fit:
            fit_reference(df, ft, args.model_dir)
        t = time.time()
        flags = AnomalyDetector(ft, model_dir=args.model_dir).score_file(df)
        print(f"Scored in {time.time() - t:.1f}s")

    out = pd.DataFrame(flags)
    if len(out):
        print("\nFlags by type:\n" + out.groupby(["anomaly_type", "rule_ref", "method"]).size()
              .sort_values(ascending=False).to_string())
        out.to_csv(args.out, index=False)
        print(f"\nSaved {len(out):,} flags to {args.out}")


if __name__ == "__main__" and "ipykernel" not in sys.modules:  # skip inside notebooks
    main()

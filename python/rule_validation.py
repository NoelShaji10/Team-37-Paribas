"""
Python Data Quality / Rule Validation Layer
Run from the project root:
    python .\python\rule_validation.py

Validates four CSV feeds, writes dq_exceptions.csv, quarantines files that
fail fatal file-level checks, and records file/record hashes in SQLite.

Notes:
- Amount limits, trailer-count format, and the authoritative IFSC master must
  be supplied/configured if required by the actual specification.
- A plain CSV without a trailer cannot prove that it was truncated.
- SQLite is used here for a self-contained demonstration of cross-run/cross-file
  duplicate prevention. If your project already has a target database, move the
  duplicate-table logic into that database's load step.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pycountry

# ---------------------------- CONFIGURATION ----------------------------

DATA_DIR = Path(
    r"C:\Users\darsh\Downloads\BNP_Hackathon_Data\data\dataset"
)
OUTPUT_DIR = Path(__file__).resolve().parent
EXCEPTIONS_FILE = OUTPUT_DIR / "dq_exceptions.csv"
DB_FILE = OUTPUT_DIR / "validation_dedup.db"
QUARANTINE_DIR = OUTPUT_DIR / "quarantine"
LOG_FILE = OUTPUT_DIR / "validation_log.jsonl"

# Configure these only if the requirements document specifies limits.
MIN_TRANSACTION_AMOUNT = None
MAX_TRANSACTION_AMOUNT = None
MAX_DECIMAL_PLACES = 4
STALE_RATE_DAYS = 7
PENDING_PAYMENT_MAX_DAYS = 30

EXPECTED_FILES = {
    "accounts_sample_100.csv": {
        "dataset": "accounts",
        "required_columns": [
            "account_number", "account_holder_name", "account_type",
            "balance", "currency", "account_status", "ifsc_code",
        ],
    },
    "bank_txns_sample_100.csv": {
        "dataset": "bank_transactions",
        "required_columns": [
            "transaction_id", "account_number", "transaction_date",
            "transaction_type", "amount", "currency", "description", "ifsc_code",
        ],
    },
    "payments_sample_100.csv": {
        "dataset": "payments",
        "required_columns": [
            "payment_id", "account_number", "payment_date", "payment_method",
            "amount", "currency", "payment_status", "ifsc_code",
        ],
    },
    "rates_sample_100.csv": {
        "dataset": "rates",
        "required_columns": [
            "rate_id", "currency_pair", "rate_date", "exchange_rate", "rate_type",
        ],
    },
}

ACCOUNT_TYPES = {"checking", "savings", "current", "business"}
ACCOUNT_STATUSES = {"active", "inactive", "closed", "suspended"}
TRANSACTION_TYPES = {"debit", "credit"}
PAYMENT_METHODS = {"credit card", "bank transfer", "direct debit", "wire"}
PAYMENT_STATUSES = {"pending", "completed", "failed", "cancelled"}
RATE_TYPES = {"buy", "sell"}
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
ACCOUNT_RE = re.compile(r"^[A-Z0-9]{10,20}$")


# ---------------------------- LOGGING / HELPERS ----------------------------

def log_event(event: dict) -> None:
    event = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), **event}
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")


def add_issue(issues, dataset, rule_id, row_number, field, value, message,
              severity="ERROR", filename=""):
    issues.append({
        "filename": filename,
        "dataset": dataset,
        "severity": severity,
        "rule_id": rule_id,
        "row_number": row_number,
        "field": field,
        "value": value,
        "issue": message,
    })


def norm(series):
    return series.fillna("").astype(str).str.strip()


def currency_exists(value):
    value = str(value).strip().upper()
    return bool(value) and pycountry.currencies.get(alpha_3=value) is not None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def record_hash(row: dict) -> str:
    normalized = {
        str(k).strip().lower(): ("" if pd.isna(v) else str(v).strip())
        for k, v in row.items()
    }
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def init_dedup_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS loaded_records (
                file_id TEXT NOT NULL,
                record_hash TEXT NOT NULL,
                first_seen_utc TEXT NOT NULL,
                PRIMARY KEY (file_id, record_hash)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS loaded_files (
                file_id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                checksum TEXT NOT NULL,
                first_seen_utc TEXT NOT NULL
            )
        """)
        conn.commit()


def register_file_and_records(path: Path, df: pd.DataFrame, dataset: str, issues):
    """Persist hashes idempotently and report duplicate rows within this input file."""
    checksum = sha256_file(path)
    file_id = f"{dataset}:{checksum}"
    now = datetime.now(timezone.utc).isoformat()

    with sqlite3.connect(DB_FILE) as conn:
        prior = conn.execute(
            "SELECT filename, file_id FROM loaded_files WHERE checksum = ? LIMIT 1", (checksum,)
        ).fetchone()

        # Re-running the same file is normal and should be idempotent.
        # Only report the same checksum if it arrived under a different filename.
        if prior and prior[0] != path.name:
            add_issue(
                issues, dataset, "F-DUP-FILE", "", "filename", path.name,
                f"File checksum matches previously registered file {prior[0]}",
                severity="WARNING", filename=path.name
            )
        conn.execute(
            "INSERT INTO loaded_files(file_id, filename, checksum, first_seen_utc) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(file_id) DO NOTHING",
            (file_id, path.name, checksum, now),
        )

        seen_hashes = set()
        for i, row in df.iterrows():
            h = record_hash(row.to_dict())

            # In-file duplicate detection is independent of whether this script
            # has been run before.
            if h in seen_hashes:
                add_issue(
                    issues, dataset, "DUP-RECORD-HASH", int(i) + 2, "record_hash", h,
                    "Duplicate normalized record hash within this file",
                    severity="WARNING", filename=path.name
                )
            seen_hashes.add(h)

            # Persistent idempotent loading: repeated (file_id, record_hash)
            # pairs are ignored by the database, as required.
            conn.execute(
                "INSERT INTO loaded_records(file_id, record_hash, first_seen_utc) "
                "VALUES (?, ?, ?) ON CONFLICT(file_id, record_hash) DO NOTHING",
                (file_id, h, now),
            )
        conn.commit()


def quarantine(path: Path, reason: str):
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    target = QUARANTINE_DIR / path.name
    if target.exists():
        target = QUARANTINE_DIR / f"{path.stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{path.suffix}"
    shutil.move(str(path), str(target))
    log_event({
        "event": "FILE_QUARANTINED",
        "filename": path.name,
        "quarantine_path": str(target),
        "reason": reason,
    })


def inspect_file(path: Path, spec: dict, issues):
    """Fatal file checks; returns (DataFrame or None, fatal reason or None)."""
    dataset = spec["dataset"]
    if not path.exists():
        reason = f"Expected file not found: {path.name}"
        add_issue(issues, dataset, "F-MISSING", "", "", "", reason, filename=path.name)
        log_event({"event": "FILE_REJECTED", "filename": path.name, "reason": reason})
        return None, reason

    if path.stat().st_size == 0:
        reason = "File is empty"
        add_issue(issues, dataset, "F-EMPTY", "", "", "", reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    checksum = sha256_file(path)

    # Strict UTF-8 first; UTF-8 BOM is accepted.
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        reason = "File is not valid UTF-8 text"
        add_issue(issues, dataset, "F-ENCODING", "", "", "", reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    if not raw.strip():
        reason = "File contains no non-whitespace content"
        add_issue(issues, dataset, "F-EMPTY", "", "", "", reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    # Check delimiter and parse consistency.
    try:
        sample = raw[:8192]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        if dialect.delimiter != ",":
            reason = f"Unexpected delimiter {repr(dialect.delimiter)}; expected comma"
            add_issue(issues, dataset, "F-DELIMITER", 1, "", dialect.delimiter, reason, filename=path.name)
            quarantine(path, reason)
            return None, reason
        df = pd.read_csv(path, encoding="utf-8-sig", dtype=str, keep_default_na=False)
    except Exception as exc:
        reason = f"CSV parsing failed: {exc}"
        add_issue(issues, dataset, "F-PARSE", "", "", "", reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    df.columns = [str(c).strip().lower() for c in df.columns]

    if len(df.columns) != len(set(df.columns)):
        reason = "Header contains duplicate column names"
        add_issue(issues, dataset, "F-HEADER-DUP", 1, "", list(df.columns), reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    missing_columns = [c for c in spec["required_columns"] if c not in df.columns]
    if missing_columns:
        reason = f"Required schema columns missing: {missing_columns}"
        add_issue(issues, dataset, "F-SCHEMA", 1, "", missing_columns, reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    # CSV records have variable lengths by nature. pandas parse errors catch many
    # malformed/truncated rows; trailer count is not available in these sample CSVs.
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f, delimiter=",")
            header_len = len(next(reader))
            for line_no, record in enumerate(reader, start=2):
                if len(record) != header_len:
                    reason = f"Record has {len(record)} fields; expected {header_len} (line {line_no})"
                    add_issue(issues, dataset, "F-RECORD-LENGTH", line_no, "", record, reason, filename=path.name)
    except Exception as exc:
        reason = f"Unable to inspect record lengths: {exc}"
        add_issue(issues, dataset, "F-RECORD-LENGTH", "", "", "", reason, filename=path.name)
        quarantine(path, reason)
        return None, reason

    log_event({
        "event": "FILE_ACCEPTED_FOR_VALIDATION",
        "filename": path.name,
        "dataset": dataset,
        "checksum_sha256": checksum,
        "row_count": len(df),
        "column_count": len(df.columns),
        "trailer_count_check": "NOT_AVAILABLE_FOR_THIS_CSV_FORMAT",
    })
    return df, None


# ---------------------------- RECORD / MASTER / BUSINESS RULES ----------------------------

def required_checks(df, dataset, filename, columns, issues):
    for col in columns:
        if col not in df.columns:
            continue
        vals = norm(df[col])
        for idx in df.index[vals.eq("")]:
            add_issue(issues, dataset, "R-REQUIRED", int(idx) + 2, col, "",
                      f"Mandatory field {col} is empty", filename=filename)


def date_check(df, dataset, filename, col, issues):
    if col not in df.columns:
        return pd.Series(pd.NaT, index=df.index)
    raw = norm(df[col])
    parsed = pd.to_datetime(raw, errors="coerce")
    for idx in df.index[raw.ne("") & parsed.isna()]:
        add_issue(issues, dataset, "R-DATE-FORMAT", int(idx) + 2, col, raw.loc[idx],
                  "Invalid date format or unparseable date", filename=filename)
    today = pd.Timestamp.today().normalize()
    for idx in df.index[parsed.notna() & (parsed.dt.normalize() > today)]:
        add_issue(issues, dataset, "B-FUTURE-DATE", int(idx) + 2, col, raw.loc[idx],
                  "Date is in the future", filename=filename)
    return parsed


def amount_check(df, dataset, filename, col, issues, allow_zero=False, check_precision=True):
    if col not in df.columns:
        return pd.Series(float("nan"), index=df.index)
    raw = norm(df[col])
    num = pd.to_numeric(raw, errors="coerce")
    for idx in df.index[raw.ne("") & num.isna()]:
        add_issue(issues, dataset, "R-NUMERIC", int(idx) + 2, col, raw.loc[idx],
                  "Expected a numeric decimal value", filename=filename)
    invalid = num.notna() & ((num < 0) if allow_zero else (num <= 0))
    for idx in df.index[invalid]:
        add_issue(issues, dataset, "B-AMOUNT-RANGE", int(idx) + 2, col, raw.loc[idx],
                  "Amount must be non-negative" if allow_zero else "Amount must be greater than zero",
                  filename=filename)
    for idx in df.index[num.notna() & raw.str.contains(r"\.\d{5,}$", regex=True)] if check_precision else []:
        add_issue(issues, dataset, "R-DECIMAL-PRECISION", int(idx) + 2, col, raw.loc[idx],
                  f"Value exceeds {MAX_DECIMAL_PLACES} decimal places", filename=filename)
    lower_bad = MIN_TRANSACTION_AMOUNT is not None and num.notna() & (num < MIN_TRANSACTION_AMOUNT)
    upper_bad = MAX_TRANSACTION_AMOUNT is not None and num.notna() & (num > MAX_TRANSACTION_AMOUNT)
    if MIN_TRANSACTION_AMOUNT is not None:
        for idx in df.index[lower_bad]:
            add_issue(issues, dataset, "B-AMOUNT-LIMIT", int(idx) + 2, col, raw.loc[idx],
                      f"Amount below configured minimum {MIN_TRANSACTION_AMOUNT}", filename=filename)
    if MAX_TRANSACTION_AMOUNT is not None:
        for idx in df.index[upper_bad]:
            add_issue(issues, dataset, "B-AMOUNT-LIMIT", int(idx) + 2, col, raw.loc[idx],
                      f"Amount above configured maximum {MAX_TRANSACTION_AMOUNT}", filename=filename)
    return num


def currency_check(df, dataset, filename, col, issues):
    if col not in df.columns:
        return
    for idx, val in norm(df[col]).str.upper().items():
        if val and not currency_exists(val):
            add_issue(issues, dataset, "M-CURRENCY", int(idx) + 2, col, val,
                      "Currency code does not exist in ISO 4217 currency list", filename=filename)


def ifsc_check(df, dataset, filename, col, issues, required=True):
    if col not in df.columns:
        return
    for idx, val in norm(df[col]).str.upper().items():
        if not val and not required:
            continue
        if not val or not IFSC_RE.fullmatch(val):
            add_issue(issues, dataset, "R-IFSC-FORMAT", int(idx) + 2, col, val,
                      "IFSC must match ^[A-Z]{4}0[A-Z0-9]{6}$", filename=filename)
        # Format does not prove that IFSC exists in a reference master.


def duplicate_id_check(df, dataset, filename, col, issues, rule="DUP-ID"):
    if col not in df.columns:
        return
    vals = norm(df[col]).str.upper()
    dup = vals.ne("") & vals.duplicated(keep=False)
    for idx in df.index[dup]:
        add_issue(issues, dataset, rule, int(idx) + 2, col, vals.loc[idx],
                  f"Duplicate identifier {col} within file", filename=filename)


def validate_accounts(df, filename, issues):
    dataset = "accounts"
    required_checks(df, dataset, filename, EXPECTED_FILES[filename]["required_columns"], issues)
    duplicate_id_check(df, dataset, filename, "account_number", issues, "A-DUP-ID")

    if "account_number" in df:
        for idx, val in norm(df["account_number"]).str.upper().items():
            if val and not ACCOUNT_RE.fullmatch(val):
                add_issue(issues, dataset, "A-ACCOUNT-FORMAT", int(idx) + 2,
                          "account_number", val, "Account number must be 10-20 alphanumeric characters",
                          filename=filename)

    if "account_type" in df:
        for idx, val in norm(df["account_type"]).str.lower().items():
            if val and val not in ACCOUNT_TYPES:
                add_issue(issues, dataset, "A-ACCOUNT-TYPE", int(idx) + 2,
                          "account_type", val, "Invalid account type", filename=filename)

    if "account_status" in df:
        for idx, val in norm(df["account_status"]).str.lower().items():
            if val and val not in ACCOUNT_STATUSES:
                add_issue(issues, dataset, "A-ACCOUNT-STATUS", int(idx) + 2,
                          "account_status", val, "Invalid account status", filename=filename)

    if "balance" in df:
        amount_check(df, dataset, filename, "balance", issues, allow_zero=True)
    currency_check(df, dataset, filename, "currency", issues)
    ifsc_check(df, dataset, filename, "ifsc_code", issues)

    return df


def validate_transactions(df, filename, accounts, issues):
    dataset = "bank_transactions"
    required_checks(df, dataset, filename, EXPECTED_FILES[filename]["required_columns"], issues)
    duplicate_id_check(df, dataset, filename, "transaction_id", issues, "T-DUP-ID")
    date_check(df, dataset, filename, "transaction_date", issues)
    amounts = amount_check(df, dataset, filename, "amount", issues)
    currency_check(df, dataset, filename, "currency", issues)
    ifsc_check(df, dataset, filename, "ifsc_code", issues, required=False)

    if "transaction_type" in df:
        for idx, val in norm(df["transaction_type"]).str.lower().items():
            if val and val not in TRANSACTION_TYPES:
                add_issue(issues, dataset, "B-TXN-TYPE", int(idx) + 2, "transaction_type",
                          val, "Transaction type must be debit or credit", filename=filename)

    if "account_number" in df and accounts is not None and "account_number" in accounts:
        known = set(norm(accounts["account_number"]).str.upper())
        for idx, val in norm(df["account_number"]).str.upper().items():
            if val and val not in known:
                add_issue(issues, dataset, "M-ACCOUNT-REF", int(idx) + 2,
                          "account_number", val, "Account does not exist in accounts master",
                          filename=filename)
            elif val and accounts is not None:
                # Active-account rule: only if a unique matching master row is available.
                matches = accounts[norm(accounts["account_number"]).str.upper().eq(val)]
                if not matches.empty and "account_status" in matches:
                    statuses = set(norm(matches["account_status"]).str.lower())
                    if statuses and "active" not in statuses:
                        add_issue(issues, dataset, "B-ACCOUNT-ACTIVE", int(idx) + 2,
                                  "account_number", val, "Transaction references an account that is not active",
                                  filename=filename)
    return df


def validate_payments(df, filename, accounts, issues):
    dataset = "payments"
    required_checks(df, dataset, filename, EXPECTED_FILES[filename]["required_columns"], issues)
    duplicate_id_check(df, dataset, filename, "payment_id", issues, "P-DUP-ID")
    dates = date_check(df, dataset, filename, "payment_date", issues)
    amount_check(df, dataset, filename, "amount", issues)
    currency_check(df, dataset, filename, "currency", issues)

    if "payment_method" in df:
        for idx, val in norm(df["payment_method"]).str.lower().items():
            if val and val not in PAYMENT_METHODS:
                add_issue(issues, dataset, "B-PAYMENT-METHOD", int(idx) + 2,
                          "payment_method", val, "Invalid payment method", filename=filename)

    if "payment_status" in df:
        for idx, val in norm(df["payment_status"]).str.lower().items():
            if val and val not in PAYMENT_STATUSES:
                add_issue(issues, dataset, "B-PAYMENT-STATUS", int(idx) + 2,
                          "payment_status", val, "Invalid payment status", filename=filename)

        # Pending-payment age check (only based on configured 30-day threshold).
        statuses = norm(df["payment_status"]).str.lower()
        old_pending = statuses.eq("pending") & dates.notna() & (
            dates.dt.normalize() < pd.Timestamp.today().normalize() - pd.Timedelta(days=PENDING_PAYMENT_MAX_DAYS)
        )
        for idx in df.index[old_pending]:
            add_issue(issues, dataset, "B-PENDING-STALE", int(idx) + 2, "payment_date",
                      norm(df["payment_date"]).loc[idx],
                      f"Pending payment is older than {PENDING_PAYMENT_MAX_DAYS} days",
                      filename=filename)

    if "account_number" in df and accounts is not None and "account_number" in accounts:
        known = set(norm(accounts["account_number"]).str.upper())
        account_norm = norm(accounts["account_number"]).str.upper()
        for idx, val in norm(df["account_number"]).str.upper().items():
            if val and val not in known:
                add_issue(issues, dataset, "M-ACCOUNT-REF", int(idx) + 2,
                          "account_number", val, "Account does not exist in accounts master",
                          filename=filename)
            elif val:
                matches = accounts[account_norm.eq(val)]
                if not matches.empty and "account_status" in matches:
                    statuses = set(norm(matches["account_status"]).str.lower())
                    if statuses and "active" not in statuses:
                        add_issue(issues, dataset, "B-ACCOUNT-ACTIVE", int(idx) + 2,
                                  "account_number", val, "Payment references an account that is not active",
                                  filename=filename)

    if "payment_method" in df and "ifsc_code" in df:
        methods = norm(df["payment_method"]).str.lower()
        for idx in df.index[methods.eq("bank transfer")]:
            val = norm(df["ifsc_code"]).str.upper().loc[idx]
            if not val or not IFSC_RE.fullmatch(val):
                add_issue(issues, dataset, "P-IFSC-REQUIRED", int(idx) + 2,
                          "ifsc_code", val, "Bank transfer requires a valid IFSC code",
                          filename=filename)
    return df


def reconcile_payments(payments, transactions, issues):
    if payments is None or transactions is None:
        return
    required_p = {"payment_status", "account_number", "amount", "payment_date"}
    required_t = {"account_number", "amount", "transaction_date"}
    if not required_p.issubset(payments.columns) or not required_t.issubset(transactions.columns):
        return

    p = payments.copy()
    t = transactions.copy()
    p["_status"] = norm(p["payment_status"]).str.lower()
    p["_account"] = norm(p["account_number"]).str.upper()
    t["_account"] = norm(t["account_number"]).str.upper()
    p["_amount"] = pd.to_numeric(norm(p["amount"]), errors="coerce").round(2)
    t["_amount"] = pd.to_numeric(norm(t["amount"]), errors="coerce").round(2)
    p["_date"] = pd.to_datetime(norm(p["payment_date"]), errors="coerce").dt.normalize()
    t["_date"] = pd.to_datetime(norm(t["transaction_date"]), errors="coerce").dt.normalize()
    tkeys = set(zip(t["_account"], t["_date"], t["_amount"]))

    for idx, row in p[p["_status"].eq("completed")].iterrows():
        key = (row["_account"], row["_date"], row["_amount"])
        if not row["_account"] or pd.isna(row["_date"]) or pd.isna(row["_amount"]):
            continue
        if key not in tkeys:
            payment_id = norm(p["payment_id"]).loc[idx] if "payment_id" in p else ""
            add_issue(issues, "payments", "B-PAYMENT-RECON", int(idx) + 2, "payment_id",
                      payment_id,
                      "Completed payment has no matching transaction by account, date and amount",
                      filename="payments_sample_100.csv")


def validate_rates(df, filename, issues):
    dataset = "rates"
    required_checks(df, dataset, filename, EXPECTED_FILES[filename]["required_columns"], issues)
    dates = date_check(df, dataset, filename, "rate_date", issues)
    rates = amount_check(df, dataset, filename, "exchange_rate", issues, check_precision=False)

    if "currency_pair" in df:
        for idx, pair in norm(df["currency_pair"]).str.upper().items():
            parts = pair.split("/")
            if pair and (len(parts) != 2 or not all(currency_exists(p) for p in parts)):
                add_issue(issues, dataset, "M-CURRENCY-PAIR", int(idx) + 2,
                          "currency_pair", pair, "Currency pair must be two valid ISO currency codes (AAA/BBB)",
                          filename=filename)

    if "rate_type" in df:
        for idx, val in norm(df["rate_type"]).str.lower().items():
            if val and val not in RATE_TYPES:
                add_issue(issues, dataset, "B-RATE-TYPE", int(idx) + 2,
                          "rate_type", val, "Rate type must be buy or sell", filename=filename)

    # Quote identity is pair + date + type. rate_id may identify a date/pair batch
    # containing both a buy and sell quote, so it is not used alone for quote duplicates.
    if {"currency_pair", "rate_date", "rate_type"}.issubset(df.columns):
        keys = pd.DataFrame({
            "pair": norm(df["currency_pair"]).str.upper(),
            "date": dates.dt.normalize(),
            "type": norm(df["rate_type"]).str.lower(),
        }, index=df.index)
        dup = keys["pair"].ne("") & keys["date"].notna() & keys["type"].ne("") & keys.duplicated(keep=False)
        for idx in df.index[dup]:
            add_issue(issues, dataset, "R-DUP-QUOTE", int(idx) + 2, "currency_pair",
                      keys.loc[idx].to_dict(), "Duplicate quote for pair/date/rate type",
                      filename=filename)

        stale = dates.notna() & (dates.dt.normalize() < pd.Timestamp.today().normalize() - pd.Timedelta(days=STALE_RATE_DAYS))
        for idx in df.index[stale]:
            add_issue(issues, dataset, "B-RATE-STALE", int(idx) + 2, "rate_date",
                      norm(df["rate_date"]).loc[idx], f"Rate is older than {STALE_RATE_DAYS} days",
                      filename=filename)

        temp = pd.DataFrame({
            "pair": norm(df["currency_pair"]).str.upper(),
            "date": dates.dt.normalize(),
            "type": norm(df["rate_type"]).str.lower(),
            "rate": rates,
        }, index=df.index)
        # A conventional quote has buy <= sell. Flag the pair/date when buy > sell.
        for (pair, date), group in temp.groupby(["pair", "date"]):
            buys = group.loc[group["type"].eq("buy"), "rate"].dropna()
            sells = group.loc[group["type"].eq("sell"), "rate"].dropna()
            if not buys.empty and not sells.empty and buys.min() > sells.max():
                for idx in group.index:
                    add_issue(issues, dataset, "B-RATE-SPREAD", int(idx) + 2, "exchange_rate",
                              group.loc[idx, "rate"], "Potential inverted spread: buy rate exceeds sell rate",
                              filename=filename)
    return df


# ---------------------------- MAIN ----------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    init_dedup_db()
    all_issues = []
    frames = {}

    for filename, spec in EXPECTED_FILES.items():
        path = DATA_DIR / filename
        df, fatal_reason = inspect_file(path, spec, all_issues)
        if df is None:
            continue
        # Register hashes only after the file passed fatal file-level checks.
        register_file_and_records(path, df, spec["dataset"], all_issues)
        frames[filename] = df

    accounts_name = "accounts_sample_100.csv"
    txn_name = "bank_txns_sample_100.csv"
    pay_name = "payments_sample_100.csv"
    rates_name = "rates_sample_100.csv"

    accounts = validate_accounts(frames[accounts_name], accounts_name, all_issues) if accounts_name in frames else None
    transactions = validate_transactions(frames[txn_name], txn_name, accounts, all_issues) if txn_name in frames else None
    payments = validate_payments(frames[pay_name], pay_name, accounts, all_issues) if pay_name in frames else None
    if rates_name in frames:
        validate_rates(frames[rates_name], rates_name, all_issues)

    reconcile_payments(payments, transactions, all_issues)

    result = pd.DataFrame(all_issues)
    if result.empty:
        result = pd.DataFrame(columns=[
            "filename", "dataset", "severity", "rule_id", "row_number", "field", "value", "issue"
        ])
    result.to_csv(EXCEPTIONS_FILE, index=False, encoding="utf-8-sig")

    log_event({
        "event": "VALIDATION_FINISHED",
        "input_files_found": len(frames),
        "exception_count": len(result),
        "exceptions_csv": str(EXCEPTIONS_FILE),
        "dedup_database": str(DB_FILE),
    })

    print(f"Validation complete. Files accepted for validation: {len(frames)}/{len(EXPECTED_FILES)}")
    print(f"Exceptions/warnings: {len(result)}")
    print(f"Report: {EXCEPTIONS_FILE}")
    print(f"Log: {LOG_FILE}")
    print(f"Dedup database: {DB_FILE}")
    if not result.empty:
        print("\nFindings by dataset, severity and rule:")
        print(result.groupby(["dataset", "severity", "rule_id"]).size().to_string())
    print("\nImportant: trailer-count validation is unavailable because these sample CSVs do not expose trailer records/counts.")
    print("IFSC format is validated; IFSC existence requires an authoritative IFSC reference master.")
    print("Amount min/max checks are configurable and remain disabled until official limits are supplied.")


if __name__ == "__main__":
    main()

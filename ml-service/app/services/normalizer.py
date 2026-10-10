"""AI normalisation and suggested fixes (diagram step 4.3; spec sections III, V.4, V.5).

Tier A, deterministic normalisation: the workbook's transformation rules (ACCT-1..RATE-5) plus safe
clean-up (" inr " or "I N R" -> INR). Applied automatically before validation and logged
(original -> normalised, rule ID). Nothing is guessed in this tier.

Reference checks: values that are still not in the master data after Tier A (currency not in the
workbook's ISO 4217 list, enum not in the Lookup sheet, bad currency pair) are returned as issues.

Tier B, AI-suggested corrections for rejected values: fuzzy matching, lookup tables and context
(e.g. the same account's IFSC elsewhere in the file). Each suggestion has a confidence score and an
explanation and is NEVER applied automatically: an operator accepts, edits or rejects it.

Learning from fixes: accepted and edited corrections are remembered per (field, original value) and
offered first next time, with confidence (accepted + 1) / (shown + 2).

">50% rule": if one fix pattern explains more than half of a column's errors in a file (for example
the whole file uses dd/mm/yyyy dates), it is proposed once as a file-level rule for approval.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

import pandas as pd
from rapidfuzz import fuzz, process
from rapidfuzz.distance import Levenshtein

REF_DIR = os.path.join(os.path.dirname(__file__), "..", "reference")
MEMORY_PATH = os.getenv("FIX_MEMORY_PATH", os.path.join(REF_DIR, "fix_memory.json"))
IFSC_MASTER_PATH = os.getenv("IFSC_MASTER_PATH", "")  # optional: Kaggle/RBI IFSC CSV
SESSION_TTL_SECONDS = 6 * 3600

IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PAIR_PATTERN = re.compile(r"^[A-Z]{3}/[A-Z]{3}$")

# Workbook Lookup sheet + column notes
ENUMS = {
    "account_type": ["checking", "savings", "current", "business"],
    "account_status": ["active", "inactive", "closed", "suspended"],
    "transaction_type": ["debit", "credit"],
    "payment_method": ["credit card", "bank transfer", "direct debit", "wire"],
    "payment_status": ["pending", "completed", "failed", "cancelled"],
    "rate_type": ["buy", "sell"],
}
ENUM_RULE = {"account_type": "ACCT-2", "account_status": "ACCT-6", "transaction_type": "TXN-4",
             "payment_method": "PAY-4", "payment_status": "PAY-7", "rate_type": "RATE-5"}
# Common banking synonyms (suggested, never auto-applied)
ENUM_SYNONYMS = {
    "transaction_type": {"dr": "debit", "cr": "credit", "withdrawal": "debit", "deposit": "credit"},
    "account_type": {"chequing": "checking", "saving": "savings", "biz": "business"},
    "payment_method": {"card": "credit card", "neft": "bank transfer", "rtgs": "bank transfer",
                       "imps": "bank transfer", "transfer": "bank transfer", "dd": "direct debit"},
    "payment_status": {"done": "completed", "success": "completed", "complete": "completed",
                       "canceled": "cancelled", "declined": "failed"},
    "account_status": {"open": "active", "dormant": "inactive", "blocked": "suspended"},
}
# Currency symbols and words that map unambiguously (Tier A)
CURRENCY_ALIASES = {"RS": "INR", "RS.": "INR", "RUPEE": "INR", "RUPEES": "INR", "₹": "INR",
                    "$": "USD", "US$": "USD", "€": "EUR", "EURO": "EUR", "£": "GBP"}
# Short bank names -> real RBI IFSC bank prefixes (lookup table, used for suggestions)
BANK_ALIASES = {"PNB": "PUNB", "SBI": "SBIN", "BOB": "BARB", "BOI": "BKID", "UBI": "UBIN", "ICICI": "ICIC",
                "AXIS": "UTIB", "KOTAK": "KKBK", "YES": "YESB", "IDFC": "IDFB", "RBL": "RATN"}
# Date formats tried for repair; the first matching unambiguous one wins
DATE_FORMATS = ["%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y%m%d", "%d-%b-%Y",
                "%d %b %Y", "%b %d %Y", "%d.%m.%Y"]
DATE_COLUMNS = ["transaction_date", "payment_date", "rate_date", "effective_date", "date"]
DECIMALS = {"balance": 4, "amount": 4, "exchange_rate": 8}  # ACCT-3, TXN-5, RATE-4


def _str(v: Any) -> str:
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v)


class _Reference:
    """Master data: ISO currencies (workbook Currency List) and IFSC reference."""

    def __init__(self):
        cur = pd.read_csv(os.path.join(REF_DIR, "currencies.csv"), dtype=str)
        self.currencies = set(cur["code"].str.strip().str.upper())
        self.currency_names = dict(zip(cur["code"], cur["name"]))
        self.ifsc, self.ifsc_source = self._load_ifsc()
        self.ifsc_by_prefix: dict[str, list[str]] = defaultdict(list)
        for code in self.ifsc:
            self.ifsc_by_prefix[code[:4]].append(code)

    @staticmethod
    def _load_ifsc() -> tuple[set[str], str]:
        codes: set[str] = set()
        source = "observed in organiser files"
        local = os.path.join(REF_DIR, "ifsc_reference.csv")
        if os.path.exists(local):
            codes |= set(pd.read_csv(local, dtype=str)["ifsc"].str.upper())
        if IFSC_MASTER_PATH and os.path.exists(IFSC_MASTER_PATH):
            master = pd.read_csv(IFSC_MASTER_PATH, dtype=str)
            col = next((c for c in master.columns if c.strip().upper() == "IFSC"), master.columns[0])
            codes |= set(master[col].dropna().str.strip().str.upper())
            source += " + IFSC master file"
        return {c for c in codes if IFSC_PATTERN.match(c)}, source


class _FixMemory:
    """Learning from fixes, kept in a small JSON file (no database change)."""

    def __init__(self, path: str):
        self.path, self.lock = path, threading.Lock()
        try:
            with open(path) as f:
                self.data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {}

    @staticmethod
    def _key(field: str, original: str) -> str:
        return f"{field.lower()}|{original.strip().upper()}"

    def best(self, field: str, original: str) -> tuple[str, float, int] | None:
        entry = self.data.get(self._key(field, original))
        if not entry:
            return None
        value, stats = max(entry.items(), key=lambda kv: (kv[1]["accepted"], -kv[1]["rejected"]))
        if stats["accepted"] == 0:
            return None
        shown = stats["accepted"] + stats["rejected"]
        return value, (stats["accepted"] + 1) / (shown + 2), stats["accepted"]

    def record(self, field: str, original: str, corrected: str | None, accepted: bool,
               suggested: str | None = None) -> None:
        with self.lock:
            entry = self.data.setdefault(self._key(field, original), {})
            if accepted and corrected:
                s = entry.setdefault(corrected.strip(), {"accepted": 0, "rejected": 0})
                s["accepted"] += 1
            if suggested and (not accepted or (corrected and corrected.strip() != suggested.strip())):
                s = entry.setdefault(suggested.strip(), {"accepted": 0, "rejected": 0})
                s["rejected"] += 1  # the operator did not take this suggestion
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.data, f, indent=1)
            os.replace(tmp, self.path)


class _Session:
    """Per-file context between batches."""

    def __init__(self):
        self.account_ifsc: dict[str, str] = {}
        self.changes_by_rule: Counter = Counter()
        self.issues_by_type: Counter = Counter()
        self.column_issues: Counter = Counter()
        self.fix_kinds: dict[str, Counter] = defaultdict(Counter)
        self.fix_examples: dict[tuple[str, str], tuple[str, str]] = {}
        self.touched = time.time()


class Normalizer:
    def __init__(self):
        self.ref = _Reference()
        self.memory = _FixMemory(MEMORY_PATH)
        self.sessions: dict[str, _Session] = {}
        self.lock = threading.Lock()

    # ------------------------------------------------------------------ sessions
    def _session(self, file_id: str) -> _Session:
        with self.lock:
            now = time.time()
            for fid in [f for f, s in self.sessions.items() if now - s.touched > SESSION_TTL_SECONDS]:
                del self.sessions[fid]
            s = self.sessions.setdefault(file_id, _Session())
            s.touched = now
            return s

    def reference_info(self) -> dict:
        return {"currencies": len(self.ref.currencies), "ifsc_codes": len(self.ref.ifsc),
                "ifsc_source": self.ref.ifsc_source, "learned_fixes": len(self.memory.data)}

    # ------------------------------------------------------------------ Tier A
    def normalize_batch(self, file_id: str, file_type: str, rows: list[dict],
                        row_numbers: list[int] | None = None) -> dict:
        """Tier A normalisation + master-data checks. Returns normalised rows, change log, issues."""
        s = self._session(file_id)
        out_rows, changes, issues = [], [], []
        for k, row in enumerate(rows):
            rn = row_numbers[k] if row_numbers and k < len(row_numbers) else k + 1
            new = dict(row)

            def change(field, value, rule):
                old = _str(new.get(field))
                if value != old:
                    changes.append({"rowNumber": rn, "field": field, "original": old, "normalized": value,
                                    "rule": rule})
                    s.changes_by_rule[rule] += 1
                    new[field] = value

            for idf in ("account_number", "transaction_id", "payment_id", "rate_id"):
                if idf in new and _str(new[idf]):
                    rule = {"account_number": "ACCT-1", "transaction_id": "TXN-1",
                            "payment_id": "PAY-1", "rate_id": "RATE-1"}[idf]
                    v = re.sub(r"\s+", "", _str(new[idf]))
                    change(idf, v.upper() if idf == "account_number" else v, rule)
            if "currency" in new and _str(new["currency"]):
                raw = re.sub(r"\s+", "", _str(new["currency"])).upper()
                change("currency", CURRENCY_ALIASES.get(raw, raw), "ACCT-4/TXN-6/PAY-6")
            if "currency_pair" in new and _str(new["currency_pair"]):
                change("currency_pair", re.sub(r"\s+", "", _str(new["currency_pair"])).upper().replace("-", "/"),
                       "RATE-2")
            if "ifsc_code" in new and _str(new["ifsc_code"]):
                change("ifsc_code", re.sub(r"\s+", "", _str(new["ifsc_code"])).upper(), "ACCT-5/TXN-7")
            for col in ENUMS:
                if col in new and _str(new[col]):
                    change(col, re.sub(r"\s+", " ", _str(new[col])).strip().lower(), ENUM_RULE[col])
            for col, dec in DECIMALS.items():
                if col in new and _str(new[col]):
                    try:
                        val = float(_str(new[col]).replace(",", ""))
                        if round(val, dec) != val or "," in _str(new[col]):
                            change(col, f"{round(val, dec):.{dec}f}".rstrip("0").rstrip("."),
                                   {"balance": "ACCT-3", "amount": "TXN-5", "exchange_rate": "RATE-4"}[col])
                    except ValueError:
                        pass  # Layer 1 rejects non-numeric values

            # Master-data checks (values Tier A could not resolve)
            cur = _str(new.get("currency"))
            if cur and cur not in self.ref.currencies:
                issues.append(self._issue(s, rn, "currency", cur, f"Currency {cur} is not in the ISO 4217 master list",
                                          "INVALID_CURRENCY", "A-5/T-6/P-6"))
            pair = _str(new.get("currency_pair"))
            if pair:
                parts = pair.split("/")
                if not PAIR_PATTERN.match(pair) or any(p not in self.ref.currencies for p in parts):
                    issues.append(self._issue(s, rn, "currency_pair", pair,
                                              f"Currency pair {pair} must be AAA/BBB with valid ISO codes",
                                              "INVALID_CURRENCY_PAIR", "R-2"))
            for col, allowed in ENUMS.items():
                v = _str(new.get(col))
                if col in new and v and v not in allowed:
                    issues.append(self._issue(s, rn, col, v, f"{col} '{v}' is not one of: {', '.join(allowed)}",
                                              "INVALID_ENUM", ENUM_RULE[col]))

            # PAY-8: IFSC is required when the payment method is bank transfer
            if _str(new.get("payment_method")) == "bank transfer" and not _str(new.get("ifsc_code")):
                issues.append(self._issue(s, rn, "ifsc_code", "", "IFSC is required for bank transfer payments",
                                          "MISSING_IFSC", "PAY-8"))

            # Context for later suggestions: the account's IFSC as seen elsewhere in the file
            acct, ifsc = _str(new.get("account_number")), _str(new.get("ifsc_code"))
            if acct and IFSC_PATTERN.match(ifsc):
                s.account_ifsc.setdefault(acct, ifsc)
            out_rows.append(new)
        return {"rows": out_rows, "changes": changes, "issues": issues}

    @staticmethod
    def _issue(s: _Session, rn, col, value, message, etype, rule) -> dict:
        s.issues_by_type[etype] += 1
        return {"rowNumber": rn, "columnName": col, "cellValue": value, "errorMessage": message,
                "errorType": etype, "ruleRef": rule}

    # ------------------------------------------------------------------ Tier B
    def suggest_batch(self, file_id: str, file_type: str, issues: list[dict]) -> list[dict]:
        """One suggestion per rejected value (or an explanation when no safe fix exists)."""
        s = self._session(file_id)
        out = []
        for it in issues:
            col = _str(it.get("columnName"))
            res = self.suggest(col, _str(it.get("cellValue")), _str(it.get("errorType")), it.get("row") or {}, s)
            s.column_issues[col] += 1
            if res.get("fixKind"):
                s.fix_kinds[col][res["fixKind"]] += 1
                s.fix_examples.setdefault((col, res["fixKind"]), (_str(it.get("cellValue")), _str(res.get("suggestion"))))
            out.append({"rowNumber": it.get("rowNumber"), "columnName": col, **res})
        return out

    def suggest(self, field: str, value: str, error_type: str = "", row: dict | None = None,
                session: _Session | None = None) -> dict:
        row, f = row or {}, field.lower()
        learned = self.memory.best(f, value) if value else None
        if f == "currency":
            res = self._suggest_currency(value)
        elif f in ("ifsc_code", "ifsc"):
            res = self._suggest_ifsc(value, row, session)
        elif f in DATE_COLUMNS:
            res = self._suggest_date(value)
        elif f in ENUMS:
            res = self._suggest_enum(f, value)
        elif f == "amount":
            res = self._suggest_amount(value)
        elif f == "currency_pair":
            res = self._suggest_pair(value)
        else:
            res = _none(f"No automatic fix for {field}; please review manually")
        if learned and learned[0] == res.get("suggestion"):
            # Operators already confirmed this exact fix: combine both pieces of evidence (noisy-OR)
            conf = 1 - (1 - res.get("confidence", 0)) * (1 - learned[1])
            return {**res, "confidence": round(min(conf, 0.99), 3), "source": res["source"] + "+LEARNED",
                    "explanation": res["explanation"] + f"; confirmed by operators {learned[2]} time(s)"}
        if learned and learned[1] >= res.get("confidence", 0):
            return {"suggestion": learned[0], "confidence": round(learned[1], 3), "source": "LEARNED",
                    "fixKind": f"LEARNED:{learned[0]}",
                    "explanation": f"Operators corrected '{value}' to '{learned[0]}' {learned[2]} time(s) before"}
        return res

    def _suggest_currency(self, value: str) -> dict:
        v = re.sub(r"\s+", "", value).upper()
        if v in self.ref.currencies:
            return {"suggestion": v, "confidence": 1.0, "source": "NORMALIZE", "fixKind": "CASE_SPACE",
                    "explanation": f"'{value}' normalises to {v}"}
        if v in CURRENCY_ALIASES:
            c = CURRENCY_ALIASES[v]
            return {"suggestion": c, "confidence": 0.98, "source": "LOOKUP", "fixKind": f"ALIAS:{v}->{c}",
                    "explanation": f"'{value}' is a common way of writing {c}"}
        if not re.fullmatch(r"[A-Z0-9]{2,4}", v):
            return _none(f"'{value}' does not look like a currency code")
        # Edit-distance-1 candidates, weighted by how common each currency is in bank data
        prior = {"INR": 5.0, "USD": 4.0, "EUR": 3.0, "GBP": 2.0, "AED": 1.5, "SGD": 1.2, "JPY": 1.2}
        cands = [c for c in self.ref.currencies if Levenshtein.distance(v, c) == 1]
        if not cands:
            return _none(f"No ISO currency is one character away from '{value}'")
        weights = {c: prior.get(c, 1.0) for c in cands}
        best = max(weights, key=weights.get)
        share = weights[best] / sum(weights.values())
        conf = round(0.6 + 0.35 * share, 3)
        others = sorted((c for c in cands if c != best), key=lambda c: -weights[c])[:3]
        return {"suggestion": best, "confidence": conf, "source": "FUZZY", "fixKind": f"TYPO:{v}->{best}",
                "explanation": f"'{value}' is one character from {best} ({self.ref.currency_names.get(best, '')})"
                               + (f"; other candidates: {', '.join(others)}" if others else "")}

    def _suggest_ifsc(self, value: str, row: dict, session: _Session | None) -> dict:
        v = re.sub(r"\s+", "", value).upper()
        if not v:  # missing IFSC (e.g. PAY-8 bank transfer): use the account's IFSC from the same file
            acct = _str(row.get("account_number")).strip().upper()
            known = session.account_ifsc.get(acct) if session else None
            if known:
                return {"suggestion": known, "confidence": 0.9, "source": "CONTEXT", "fixKind": "ACCOUNT_IFSC",
                        "explanation": f"Account {acct} uses IFSC {known} in other rows of this file"}
            return _none("IFSC is missing and this account has no IFSC elsewhere in the file")
        cands: dict[str, tuple[float, str]] = {}
        # 1. Short bank name in place of the 4-letter prefix, e.g. PNB0006666 -> PUNB0006666
        m = re.match(r"^([A-Z]+)(\d.*)$", v)
        if m and m.group(1) in BANK_ALIASES:
            fixed = BANK_ALIASES[m.group(1)] + m.group(2)
            if IFSC_PATTERN.match(fixed):
                known = fixed in self.ref.ifsc
                cands[fixed] = (0.92 if known else 0.8,
                                f"'{m.group(1)}' is the short name for IFSC bank code {BANK_ALIASES[m.group(1)]}"
                                + ("" if known else "; the corrected code is not in our reference list, please verify"))
        # 2. Closest codes in the reference list (same bank only, when the bank prefix is known)
        pool = self.ref.ifsc_by_prefix.get(v[:4]) or list(self.ref.ifsc)
        for code, score, _ in process.extract(v, pool, scorer=fuzz.ratio, limit=3):
            if score >= 75:
                conf = round(score / 100 * 0.85, 3)
                if code not in cands or cands[code][0] < conf:
                    cands[code] = (conf, f"Closest IFSC in the reference list ({score:.0f}% similar)")
        if not cands:
            return _none(f"No close IFSC found for '{value}'")
        ranked = sorted(cands.items(), key=lambda kv: -kv[1][0])
        (best, (conf, why)) = ranked[0]
        if len(ranked) > 1 and ranked[1][1][0] >= conf - 0.05:  # near-tie: we cannot really tell
            conf = round(conf * 0.8, 3)
            why += f"; close alternative {ranked[1][0]}"
        kind = f"IFSC_PREFIX:{m.group(1)}" if m and m.group(1) in BANK_ALIASES and best.startswith(
            BANK_ALIASES[m.group(1)]) else "IFSC_FUZZY"
        return {"suggestion": best, "confidence": conf, "source": "LOOKUP" if kind != "IFSC_FUZZY" else "FUZZY",
                "fixKind": kind, "explanation": why}

    def _suggest_date(self, value: str) -> dict:
        v = value.strip()
        date_part, time_part = v, ""
        m = re.match(r"^(.*?)[ T](\d{1,2}:\d{2}(?::\d{2})?)$", v)
        if m:
            date_part, time_part = m.group(1), " " + m.group(2)
        hits = []
        for fmt in DATE_FORMATS:
            try:
                hits.append((fmt, datetime.strptime(date_part, fmt)))
            except ValueError:
                continue
        if not hits:
            return _none(f"'{value}' does not match any known date format")
        dates = sorted({d.date() for _, d in hits})
        fmt, d = hits[0]
        iso = d.strftime("%Y-%m-%d") + time_part
        if d.date() > datetime.now().date():
            return _none(f"'{value}' reads as {d:%Y-%m-%d}, which is in the future; no automatic fix")
        if len(dates) > 1:
            alts = " or ".join(str(x) for x in dates)
            return {"suggestion": iso, "confidence": 0.5, "source": "PARSER", "fixKind": f"DATE_FORMAT:{fmt}",
                    "explanation": f"Ambiguous date '{value}': could be {alts}; please confirm"}
        return {"suggestion": iso, "confidence": 0.95, "source": "PARSER", "fixKind": f"DATE_FORMAT:{fmt}",
                "explanation": f"'{value}' is in format {fmt}; rewritten as ISO {iso}"}

    def _suggest_enum(self, field: str, value: str) -> dict:
        v = re.sub(r"\s+", " ", value).strip().lower()
        allowed = ENUMS[field]
        if v in allowed:
            return {"suggestion": v, "confidence": 1.0, "source": "NORMALIZE", "fixKind": "CASE_SPACE",
                    "explanation": f"'{value}' normalises to '{v}'"}
        syn = ENUM_SYNONYMS.get(field, {}).get(v)
        if syn:
            return {"suggestion": syn, "confidence": 0.9, "source": "LOOKUP", "fixKind": f"SYNONYM:{v}->{syn}",
                    "explanation": f"'{value}' is a common synonym for '{syn}'"}
        match = process.extract(v, allowed, scorer=fuzz.ratio, limit=2)
        if not match or match[0][1] < 70:
            return _none(f"'{value}' is not close to any allowed value ({', '.join(allowed)})")
        best, score, _ = match[0]
        conf = score / 100 * 0.9
        if len(match) > 1 and match[1][1] >= score - 5:
            conf *= 0.7
        return {"suggestion": best, "confidence": round(conf, 3), "source": "FUZZY", "fixKind": f"TYPO:{v}->{best}",
                "explanation": f"'{value}' looks like a typo of '{best}' ({score:.0f}% similar)"}

    @staticmethod
    def _suggest_amount(value: str) -> dict:
        v = value.strip().replace(",", "")
        try:
            num = float(v)
        except ValueError:
            cleaned = re.sub(r"[^\d.\-]", "", v)
            try:
                num = float(cleaned)
                return {"suggestion": cleaned, "confidence": 0.8, "source": "NORMALIZE", "fixKind": "AMOUNT_CHARS",
                        "explanation": f"Removed non-numeric characters from '{value}'"}
            except ValueError:
                return _none(f"'{value}' is not a number")
        if num <= 0:
            return _none(f"Amount {value} is not positive. If the sign was used to mark a debit, set the type "
                         f"to debit and the amount to {abs(num):g}; please confirm manually")
        return _none("Amount looks valid; please review the rule that rejected it")

    def _suggest_pair(self, value: str) -> dict:
        v = re.sub(r"[\s\-_]", "", value).upper()
        if len(v) == 6 and v[:3] in self.ref.currencies and v[3:] in self.ref.currencies:
            fixed = f"{v[:3]}/{v[3:]}"
            return {"suggestion": fixed, "confidence": 0.95, "source": "NORMALIZE", "fixKind": "PAIR_FORMAT",
                    "explanation": f"Rewritten in AAA/BBB form as {fixed}"}
        return _none(f"'{value}' cannot be read as a pair of ISO currency codes")

    # ------------------------------------------------------------------ learning + file end
    def feedback(self, field: str, original: str, corrected: str | None, accepted: bool,
                 suggested: str | None = None) -> dict:
        self.memory.record(field, original, corrected, accepted, suggested)
        return {"learned": self.memory.best(field, original) is not None}

    def finish(self, file_id: str) -> dict:
        """Summary for the file and the '>50% rule' proposals. Frees the session."""
        with self.lock:
            s = self.sessions.pop(file_id, None)
        if s is None:
            return {"summary": {}, "proposals": []}
        proposals = []
        for col, kinds in s.fix_kinds.items():
            total = s.column_issues[col]
            for kind, n in kinds.most_common(1):
                if total >= 5 and n / total > 0.5 and not kind.startswith("LEARNED"):
                    orig, fixed = s.fix_examples.get((col, kind), ("", ""))
                    proposals.append({
                        "column": col, "fixKind": kind, "rows": n, "share": round(n / total, 3),
                        "example": {"original": orig, "suggested": fixed},
                        "message": f"{n} of {total} {col} errors in this file share one fix ({kind}); "
                                   f"approve it once to apply to all of them",
                    })
        return {"summary": {"normalizedByRule": dict(s.changes_by_rule), "issuesByType": dict(s.issues_by_type),
                            "rejectedValuesByColumn": dict(s.column_issues)},
                "proposals": proposals}


def _none(why: str) -> dict:
    return {"suggestion": None, "confidence": 0.0, "source": "NONE", "fixKind": None, "explanation": why}


normalizer = Normalizer()

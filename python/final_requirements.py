import csv
import hashlib
import os
from pathlib import Path
from collections import defaultdict
from datetime import datetime, date

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(r"C:\Users\darsh\Downloads\BNP_Hackathon_Data\data\dataset")
OUT = ROOT / "python"
OUT.mkdir(exist_ok=True)

FILES = {
    "accounts": "accounts_sample_100.csv",
    "bank_transactions": "bank_txns_sample_100.csv",
    "payments": "payments_sample_100.csv",
    "rates": "rates_sample_100.csv",
}
FINDINGS = []
CHECKLIST = []

def finding(dataset, rule, row, field, value, message, severity="ERROR"):
    FINDINGS.append({
        "dataset": dataset,
        "severity": severity,
        "rule_id": rule,
        "row_number": row,
        "field": field,
        "value": value,
        "issue": message,
        "filename": FILES.get(dataset, "")
    })

def load_csv(dataset, filename):
    path = DATA / filename
    if not path.exists():
        finding(dataset, "F-FILE-MISSING", "", "", str(path),
                "Required sample file is missing")
        return []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                finding(dataset, "F-HEADER-MISSING", "", "", "",
                        "CSV header is missing")
                return []
            return [
                {str(k).strip(): (v or "").strip() for k, v in row.items() if k is not None}
                for row in reader
            ]
    except (UnicodeDecodeError, csv.Error, OSError) as exc:
        finding(dataset, "F-READ-ERROR", "", "", "",
                f"Cannot read CSV: {exc}")
        return []

def column(rows, candidates):
    if not rows:
        return None
    mapping = {c.lower().strip(): c for c in rows[0]}
    return next((mapping[c] for c in candidates if c in mapping), None)

def parse_number(value):
    try:
        return float(str(value).replace(",", "").strip())
    except (ValueError, TypeError):
        return None

datasets = {name: load_csv(name, filename) for name, filename in FILES.items()}

# 1. Duplicate rows within files and exact duplicate rows across files.
row_hashes = defaultdict(list)
for dataset, rows in datasets.items():
    seen = set()
    for row_num, row in enumerate(rows, start=2):
        normalized = "|".join(
            f"{k.strip().lower()}={str(v).strip()}"
            for k, v in sorted(row.items())
        )
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        row_hashes[digest].append((dataset, row_num))
        if digest in seen:
            finding(dataset, "DUP-WITHIN-FILE", row_num, "", digest,
                    "Duplicate row found within this CSV")
        seen.add(digest)

for digest, locations in row_hashes.items():
    different_files = {dataset for dataset, _ in locations}
    if len(different_files) > 1:
        for dataset, row_num in locations:
            finding(dataset, "DUP-ACROSS-FILES", row_num, "", digest,
                    "Exact normalized row appears in more than one CSV")

CHECKLIST.append(("Within-file duplicate rows", "Checked"))
CHECKLIST.append(("Exact cross-file duplicate rows", "Checked; see supplemental report"))

# 2. Debit/credit consistency: when a separate transaction type is present,
# amounts should be non-negative. The sign convention must still be confirmed
# against the assignment specification.
rows = datasets["bank_transactions"]
type_col = column(rows, {"transaction_type", "type", "debit_credit", "dr_cr"})
amount_col = column(rows, {"amount", "transaction_amount", "txn_amount"})
if rows and type_col and amount_col:
    for row_num, row in enumerate(rows, start=2):
        typ = row.get(type_col, "").strip().lower()
        amount = parse_number(row.get(amount_col, ""))
        if typ in {"debit", "credit", "dr", "cr"} and amount is not None and amount < 0:
            finding("bank_transactions", "B-DEBIT-CREDIT-SIGN",
                    row_num, amount_col, row.get(amount_col),
                    "Negative amount with separate debit/credit transaction type; confirm sign convention")
    CHECKLIST.append(("Debit/credit amount-sign check", "Ran; confirm bank sign convention"))
else:
    CHECKLIST.append(("Debit/credit amount-sign check", "Not run: expected columns not found"))

# 3. Optional official amount limits. Set environment variables only when
# your assignment gives the exact permitted limits.
minimum = os.getenv("DQ_MIN_AMOUNT")
maximum = os.getenv("DQ_MAX_AMOUNT")
min_value = parse_number(minimum) if minimum else None
max_value = parse_number(maximum) if maximum else None

for dataset in ("bank_transactions", "payments"):
    rows = datasets[dataset]
    amount_col = column(rows, {"amount", "transaction_amount", "payment_amount", "txn_amount"})
    if amount_col and (min_value is not None or max_value is not None):
        for row_num, row in enumerate(rows, start=2):
            amount = parse_number(row.get(amount_col, ""))
            if amount is None:
                continue
            if min_value is not None and amount < min_value:
                finding(dataset, "B-AMOUNT-MIN", row_num, amount_col,
                        row.get(amount_col), f"Amount is below configured minimum {min_value}")
            if max_value is not None and amount > max_value:
                finding(dataset, "B-AMOUNT-MAX", row_num, amount_col,
                        row.get(amount_col), f"Amount exceeds configured maximum {max_value}")
        CHECKLIST.append((f"{dataset} amount limits", "Checked using configured limits"))
    else:
        CHECKLIST.append((f"{dataset} amount limits",
                          "Not checked: official limits were not configured"))

# 4. Optional authoritative IFSC reference file.
# Place ifsc_master.csv in the dataset directory with a column named ifsc_code
# or IFSC. Without this reference file, format validation alone cannot prove
# that a code exists.
ifsc_path = DATA / "ifsc_master.csv"
if ifsc_path.exists():
    try:
        with ifsc_path.open("r", encoding="utf-8-sig", newline="") as f:
            ref_reader = csv.DictReader(f)
            ref_col = next(
                (c for c in (ref_reader.fieldnames or [])
                 if c.lower().strip() in {"ifsc_code", "ifsc"}), None
            )
            if ref_col:
                valid_ifsc = {
                    (row.get(ref_col) or "").strip().upper()
                    for row in ref_reader
                }
                for dataset in ("accounts", "bank_transactions", "payments"):
                    rows = datasets[dataset]
                    col = column(rows, {"ifsc_code", "ifsc"})
                    if col:
                        for row_num, row in enumerate(rows, start=2):
                            code = row.get(col, "").strip().upper()
                            if code and code not in valid_ifsc:
                                finding(dataset, "M-IFSC-UNKNOWN", row_num, col,
                                        code, "IFSC not found in supplied reference master")
                CHECKLIST.append(("IFSC existence", "Checked against ifsc_master.csv"))
            else:
                CHECKLIST.append(("IFSC existence", "Skipped: reference file has no IFSC column"))
    except (OSError, csv.Error, UnicodeDecodeError) as exc:
        CHECKLIST.append(("IFSC existence", f"Skipped: reference read failed: {exc}"))
else:
    CHECKLIST.append(("IFSC existence", "Not checked: authoritative ifsc_master.csv not supplied"))

# 5. Currency validation against ISO 4217 when pycountry is installed.
try:
    import pycountry
    valid_currencies = {c.alpha_3 for c in pycountry.currencies}
    for dataset in ("accounts", "bank_transactions", "payments", "rates"):
        rows = datasets[dataset]
        col = column(rows, {"currency", "currency_code", "buy_currency", "sell_currency"})
        if col:
            for row_num, row in enumerate(rows, start=2):
                value = row.get(col, "").strip().upper()
                if value and value not in valid_currencies:
                    finding(dataset, "R-CURRENCY-UNKNOWN", row_num, col,
                            value, "Currency code not recognized by installed ISO currency reference")
    CHECKLIST.append(("ISO currency reference", "Checked with pycountry"))
except ImportError:
    CHECKLIST.append(("ISO currency reference", "Skipped: pycountry is not installed"))

# 6. Trailer counts cannot be validated unless the source format defines them.
CHECKLIST.append(("Trailer record/count", "Not verifiable from these ordinary CSV samples"))

# Save supplemental findings.
findings_path = OUT / "final_supplemental_findings.csv"
fields = ["dataset", "severity", "rule_id", "row_number", "field", "value", "issue", "filename"]
with findings_path.open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(FINDINGS)

# Combine existing validator report with supplemental findings.
existing = OUT / "dq_exceptions.csv"
combined_path = OUT / "final_combined_dq_exceptions.csv"
with combined_path.open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    if existing.exists():
        with existing.open("r", encoding="utf-8-sig", newline="") as old:
            for row in csv.DictReader(old):
                writer.writerow({key: row.get(key, "") for key in fields})
    for row in FINDINGS:
        writer.writerow(row)

check_path = OUT / "final_requirements_checklist.csv"
with check_path.open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["requirement", "status"])
    writer.writerows(CHECKLIST)

print("\nSUPPLEMENTAL CHECKS COMPLETE")
print("New supplemental findings:", len(FINDINGS))
print("Combined findings report:", combined_path)
print("Supplemental-only report:", findings_path)
print("Requirements checklist:", check_path)
print("\nChecklist:")
for item, status in CHECKLIST:
    print(f"- {item}: {status}")
print("\nNote: checks marked 'Not checked' require official specifications/reference data.")

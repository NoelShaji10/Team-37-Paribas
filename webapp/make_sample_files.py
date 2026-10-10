"""
Creates SYNTHETIC sample files (random data, not real transactions) for testing the dashboard.
Every file is named sample_*, so the dashboard labels it "SAMPLE (synthetic)".

    python webapp/make_sample_files.py            # writes into ./samples
    python webapp/make_sample_files.py --large 200000
"""
import argparse
import csv
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

COLUMNS = ["transaction_id", "account_number", "transaction_date", "transaction_type", "amount", "currency"]


def rows(n, rng):
    base = datetime(2024, 1, 1)
    for i in range(n):
        yield [f"TXN{i:09d}", str(rng.randint(10**9, 10**11)),
               (base + timedelta(seconds=rng.randint(0, 3 * 365 * 86400))).strftime("%Y-%m-%d %H:%M:%S"),
               rng.choice(["debit", "credit"]), f"{rng.uniform(1, 90000):.2f}",
               rng.choice(["INR", "USD", "EUR", "GBP"])]


def write_csv(path, n, rng):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        w.writerows(rows(n, rng))


def write_json(path, n, rng):
    data = {"transactions": [dict(zip(COLUMNS, r)) for r in rows(n, rng)]}
    Path(path).write_text(json.dumps(data), encoding="utf-8")


def write_xlsx(path, n, rng):
    from openpyxl import Workbook
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("transactions")
    ws.append(COLUMNS)
    for r in rows(n, rng):
        ws.append(r)
    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="samples")
    ap.add_argument("--small", type=int, default=100)
    ap.add_argument("--medium", type=int, default=10_000)
    ap.add_argument("--large", type=int, default=500_000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)
    write_csv(out / "sample_small.csv", a.small, rng)
    write_csv(out / "sample_medium.csv", a.medium, rng)
    write_csv(out / "sample_large.csv", a.large, rng)
    write_json(out / "sample_transactions.json", a.medium // 2, rng)
    write_xlsx(out / "sample_transactions.xlsx", a.medium // 2, rng)
    # deliberately bad files, to see failures handled gracefully
    (out / "sample_empty.csv").write_bytes(b"")
    (out / "sample_header_only.csv").write_text(",".join(COLUMNS) + "\n", encoding="utf-8")
    (out / "sample_broken.json").write_text('{"transactions": [ {"transaction_id": "T1", ', encoding="utf-8")
    (out / "sample_fake.xlsx").write_text("this is not really an excel file", encoding="utf-8")
    (out / "sample_notes.txt").write_text("unsupported type", encoding="utf-8")
    for p in sorted(out.iterdir()):
        print(f"{p.name:28s}{p.stat().st_size / 1024:>12,.1f} KB")


if __name__ == "__main__":
    main()

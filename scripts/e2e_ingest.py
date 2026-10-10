"""End-to-end ingestion test: upload files to the backend at the same time, watch them process,
then check that Layer 1 (rejections) and Layer 2 (anomalies) produced results.

Run from the repo root, with the backend (port 5000) and ML service (port 8000) already running:

    ml-service/.venv/bin/python scripts/e2e_ingest.py                      # all *_100,000.csv in data/
    ml-service/.venv/bin/python scripts/e2e_ingest.py --rows 2000           # quick run: first 2,000 rows of each
    ml-service/.venv/bin/python scripts/e2e_ingest.py data/payments_100,000.csv

Exit code 0 = every file finished (COMPLETED or NEEDS_REVIEW); 1 = something failed or timed out.
Needs only the `requests` package (already in ml-service/requirements.txt).
"""
import argparse
import glob
import os
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import requests

DONE = {"COMPLETED", "NEEDS_REVIEW", "FAILED"}


def check(name, url):
    try:
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        print(f"  OK    {name:12s} {url}")
        return r.json()
    except Exception as e:
        print(f"  FAIL  {name:12s} {url}  ({e})")
        return None


def preflight(backend, ml):
    print("Preflight")
    ok = check("backend", f"{backend}/health") is not None
    if check("ml-service", f"{ml}/health") is None:
        ok = False
    else:
        status = check("models", f"{ml}/anomaly/status") or {}
        missing = [t for t, v in status.items() if not v]
        if missing:
            print(f"  WARN  models missing for {missing}: run `python -m training.train_anomaly` in ml-service/")
    return ok


def shorten(path, rows, tmp):
    """Copy the header + first N rows to a temp file with the same name (quick runs)."""
    out = os.path.join(tmp, os.path.basename(path))
    with open(path, encoding="utf-8") as src, open(out, "w", encoding="utf-8") as dst:
        for i, line in enumerate(src):
            if i > rows:
                break
            dst.write(line)
    return out


def upload(backend, path):
    t0 = time.time()
    with open(path, "rb") as fh:
        r = requests.post(f"{backend}/api/files/upload", files={"file": (os.path.basename(path), fh, "text/csv")},
                          timeout=600)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    msg = str(body.get("message") or r.text[:200])
    if r.status_code >= 300 and "duplicate" in msg.lower():
        print(f"  DUPLICATE {os.path.basename(path):25s} rejected by the backend (already processed): {msg}")
        return None
    if r.status_code >= 300 or not body.get("success"):
        raise RuntimeError(f"upload failed ({r.status_code}): {msg}")
    data = body["data"]
    print(f"  queued {data['fileName']:28s} type={data.get('fileType')}  id={data['fileId']}  ({time.time() - t0:.1f}s)")
    return data["fileId"]


def print_table(rows):
    print(f"\n  {'file':28s} {'type':18s} {'status':13s} {'prog':>5s} {'rows':>9s} {'rejected':>9s} {'anomalies':>9s}")
    for f in rows:
        c = f.get("_count") or {}
        print(f"  {str(f.get('originalName') or f.get('fileName'))[:28]:28s} {str(f.get('fileType')):18s} "
              f"{str(f.get('status')):13s} {f.get('progress', 0):>4.0f}% {f.get('processedRows', 0):>9,} "
              f"{f.get('failedRows', 0):>9,} {c.get('anomalies', 0):>9,}")


def main():
    ap = argparse.ArgumentParser(description="End-to-end ingestion test")
    ap.add_argument("files", nargs="*", help="CSV files (default: data/*_100,000.csv)")
    ap.add_argument("--backend", default="http://localhost:5000")
    ap.add_argument("--ml", default="http://localhost:8000")
    ap.add_argument("--rows", type=int, default=0, help="upload only the first N rows of each file")
    ap.add_argument("--timeout", type=int, default=1800, help="seconds to wait for processing")
    ap.add_argument("--poll", type=float, default=3.0)
    args = ap.parse_args()

    files = args.files or sorted(glob.glob(os.path.join("data", "*_100,000.csv")))
    if not files:
        sys.exit("No files found. Put the CSVs in data/ or pass paths.")
    if not preflight(args.backend, args.ml):
        sys.exit("Preflight failed: start the services first (see ml-service/LAYER2.md).")

    tmp = tempfile.mkdtemp(prefix="e2e_")
    if args.rows:
        files = [shorten(f, args.rows, tmp) for f in files]

    print(f"\nUploading {len(files)} files at the same time")
    t_start = time.time()
    with ThreadPoolExecutor(max_workers=len(files)) as pool:  # concurrent uploads, like a month-end burst
        ids = [i for i in pool.map(lambda p: upload(args.backend, p), files) if i]
    if not ids:
        sys.exit("\nEvery file was a duplicate. For a fresh run: ./scripts/reset_db.sh, or use a different --rows value.")

    print("\nProcessing")
    tracked, last = set(ids), []
    while time.time() - t_start < args.timeout:
        all_files = requests.get(f"{args.backend}/api/files", timeout=30).json().get("data", [])
        last = [f for f in all_files if f.get("id") in tracked]
        running = [f for f in last if f.get("status") not in DONE]
        print(f"  {time.time() - t_start:6.0f}s  done {len(last) - len(running)}/{len(tracked)}  "
              + "  ".join(f"{str(f.get('originalName'))[:14]}:{f.get('progress', 0):.0f}%" for f in running))
        if not running and len(last) == len(tracked):
            break
        time.sleep(args.poll)

    print_table(last)
    failed = [f for f in last if f.get("status") == "FAILED"]
    unfinished = [f for f in last if f.get("status") not in DONE]

    print("\nLayer 2 anomaly types per file")
    for f in last:
        try:
            detail = requests.get(f"{args.backend}/api/files/{f['id']}", timeout=120).json().get("data", {})
            kinds = Counter(a.get("anomalyType") for a in detail.get("anomalies", []))
            rules = Counter((a.get("details") or {}).get("ruleRef") for a in detail.get("anomalies", []))
            top = ", ".join(f"{k} {v:,}" for k, v in kinds.most_common(5)) or "none"
            print(f"  {str(f.get('originalName'))[:28]:28s} {top}")
            if kinds and None in rules:
                print("        note: some anomalies have no ruleRef (saved by old code?)")
            if f.get("predictedDurationMs") and f.get("actualDurationMs"):
                print(f"        time: predicted {f['predictedDurationMs'] / 1000:.1f}s, "
                      f"actual {f['actualDurationMs'] / 1000:.1f}s")
        except Exception as e:
            print(f"  {f.get('originalName')}: could not fetch details ({e})")

    print(f"\nTotal wall time {time.time() - t_start:.0f}s for {len(files)} files")
    if failed or unfinished:
        for f in failed:
            print(f"  FAILED {f.get('originalName')}: {f.get('errorMessage')}")
        for f in unfinished:
            print(f"  NOT FINISHED {f.get('originalName')}: {f.get('status')}")
        sys.exit(1)
    print("PASS: every file finished")


if __name__ == "__main__":
    main()

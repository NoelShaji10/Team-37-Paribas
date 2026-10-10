"""
Processing-time prediction for ANY transaction file (CSV, JSON, XLSX), e.g. your 100 sample files.

Why a separate file? file_time_prediction.py only understands 4 CSV file types with fixed names and headers
(accounts_*, bank_txns_*, payments_*, rates_*). Your 100 files are mixed formats with free names, so this
version predicts from what is always known when a file arrives: its FORMAT, its SIZE, and how many other
files are being processed at the same moment. The unit of work is webapp/processing.py (parse + count rows),
the same code the dashboard uses. file_time_prediction.py and realtime_file_monitor.py stay untouched.

Commands (run from the repository root):
  collect     process files in parallel (separate processes), log size / format / seconds   -> output/processing_timings.csv
  import-log  add rows from your own table of "process start / complete / size"
  train       fit the model (70/15/15 split), save output/processing_time_model.joblib
  predict     per-file predicted wait, duration and finish time for files arriving together
  run         predict, then really process them in parallel and compare predicted vs actual
"""
from __future__ import annotations

import argparse
import csv
import glob
import heapq
import json
import multiprocessing as mp
import random
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
try:
    from webapp import processing  # noqa: E402
except ImportError:
    sys.exit("Cannot import webapp.processing. Run this from the repository root and make sure the "
             "webapp\\ folder (with __init__.py) is next to python\\.")

OUT = Path("output")
TIMINGS_CSV = OUT / "processing_timings.csv"
MODEL_PATH = OUT / "processing_time_model.joblib"
FORMATS = ["CSV", "JSON", "XLSX"]
FIELDS = ["file_name", "file_format", "size_bytes", "rows", "active_workers", "duration_sec",
          "queue_wait_sec", "status", "data_label"]
_active = None                                     # shared counter of files being processed right now


# ------------------------------------------------------------------ features
def format_of(path) -> str | None:
    return processing.SUPPORTED_FORMATS.get(Path(path).suffix.lower())


def features(kind: str, fmt: str, size_bytes: float, concurrency: float) -> list:
    mb = size_bytes / 1e6
    onehot = [1.0 if fmt == f else 0.0 for f in FORMATS]
    if kind == "linear_per_format":              # own start-up cost and own seconds-per-MB for each format
        return onehot + [mb * o for o in onehot] + [float(concurrency)]
    return [mb, float(concurrency)] + onehot     # for the tree model


# ------------------------------------------------------------------ parallel processing
def _init_worker(counter):
    global _active
    _active = counter


def _process(path, submit_ts):
    """Runs in a worker process: times ONE file and records how many files were running."""
    start_wall = time.time()
    with _active.get_lock():
        _active.value += 1
        active = _active.value                       # includes this file
    t0 = time.perf_counter()
    rec = processing.process_file(Path(path), Path(path).name)       # <-- the real work
    duration = time.perf_counter() - t0
    with _active.get_lock():
        _active.value -= 1
    return {"path": str(path), "file_name": rec["file_name"], "file_format": rec["file_format"],
            "size_bytes": rec["size_bytes"], "rows": rec["rows"], "active_workers": active,
            "duration_sec": duration, "queue_wait_sec": start_wall - submit_ts,
            "finish_sec": time.time() - submit_ts, "status": rec["status"],
            "error": rec["error_message"], "data_label": rec["data_label"]}


def run_parallel(files, workers):
    counter = mp.Value("i", 0)
    out = []
    t_submit = time.time()
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker, initargs=(counter,)) as ex:
        futs = [ex.submit(_process, str(p), t_submit) for p in files]
        for f in as_completed(futs):
            out.append(f.result())
    return out


def expand(patterns):
    """Windows PowerShell does not expand wildcards like samples\\*.csv, so we do it here."""
    files = []
    for p in patterns:
        hits = sorted(glob.glob(p))
        if not hits:
            sys.exit(f"no file matches '{p}' (check the path and the spelling)")
        files.extend(hits)
    return [Path(f) for f in files if Path(f).is_file()]


# ------------------------------------------------------------------ collect
def append_rows(rows):
    OUT.mkdir(parents=True, exist_ok=True)
    new = not TIMINGS_CSV.exists()
    with open(TIMINGS_CSV, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerows(rows)


def cmd_collect(a):
    files = sorted(p for p in Path(a.dir).iterdir() if p.is_file() and format_of(p))
    if not files:
        sys.exit(f"no .csv / .json / .xlsx files found in {a.dir}")
    jobs = files * a.repeat
    random.Random(1).shuffle(jobs)
    levels = [int(x) for x in a.workers_list.split(",")]
    groups = [jobs[i::len(levels)] for i in range(len(levels))]
    print(f"{len(files)} files x {a.repeat} repeat(s) = {len(jobs)} runs, worker levels {levels}")
    total = 0
    for workers, grp in zip(levels, groups):
        t0 = time.time()
        res = run_parallel(grp, workers)
        append_rows(res)
        total += len(res)
        ok = sum(r["status"] == "success" for r in res)
        print(f"  {len(res):4d} runs with {workers} worker process(es) in {time.time() - t0:5.1f}s  "
              f"({ok} succeeded, {len(res) - ok} failed as expected for broken files)")
    print(f"logged {total} runs -> {TIMINGS_CSV}")


# ------------------------------------------------------------------ import-log
def parse_time(s: str) -> datetime:
    s = s.strip()
    for fmt in ("%I:%M:%S %p", "%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    raise ValueError(f"cannot read time '{s}'")


def parse_size(s: str) -> int:
    m = re.match(r"^\s*([\d.,]+)\s*(B|KB|MB|GB)?\s*$", s.strip(), re.IGNORECASE)
    if not m:
        raise ValueError(f"cannot read size '{s}'")
    unit = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}[(m.group(2) or "B").upper()]
    return int(float(m.group(1).replace(",", "")) * unit)


def cmd_import_log(a):
    """Reads a CSV with columns like: Process start, Complete, SIZE (e.g. '3:40:50 AM', '3:40:52 AM', '239.3 KB')."""
    rows = []
    with open(a.csv, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        cols = {c.strip().lower(): c for c in reader.fieldnames or []}
        need = {"start": next((cols[c] for c in cols if "start" in c), None),
                "end": next((cols[c] for c in cols if "complete" in c or c == "end"), None),
                "size": next((cols[c] for c in cols if "size" in c), None)}
        if None in need.values():
            sys.exit(f"need columns for start, complete and size; found {list(cols)}")
        for i, r in enumerate(reader, start=1):
            if not (r[need["start"]] or "").strip():
                continue
            start, end = parse_time(r[need["start"]]), parse_time(r[need["end"]])
            if end < start:
                end += timedelta(days=1)                      # finished after midnight
            rows.append({"file_name": r.get("file_name") or f"imported_{i:04d}", "file_format": a.format.upper(),
                         "size_bytes": parse_size(r[need["size"]]), "rows": 0, "active_workers": 1,
                         "duration_sec": (end - start).total_seconds(), "queue_wait_sec": 0,
                         "status": "success", "data_label": "imported log (your own table)"})
    append_rows(rows)
    print(f"imported {len(rows)} rows from {a.csv} (format assumed: {a.format.upper()}) -> {TIMINGS_CSV}")


# ------------------------------------------------------------------ train
def cmd_train(a):
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, r2_score

    if not TIMINGS_CSV.exists():
        sys.exit(f"no {TIMINGS_CSV} yet; run `collect` first")
    df = pd.read_csv(TIMINGS_CSV)
    df = df[(df["status"] == "success") & df["file_format"].isin(FORMATS)].reset_index(drop=True)
    if len(df) < a.min_rows:
        sys.exit(f"only {len(df)} successful rows in {TIMINGS_CSV}; need at least {a.min_rows}. "
                 f"Run `collect --repeat 3` (or more) to build more data.")
    y = df["duration_sec"].to_numpy()
    size = df["size_bytes"].to_numpy()
    n = len(df)

    # 70/15/15. Validation = the LARGEST 15% of files, so the winner is the model that copes with bigger files
    # than it trained on. Train / test = random 70% / 15% of the rest.
    order = np.argsort(size)
    val = order[int(0.85 * n):]
    rest = np.random.default_rng(42).permutation(order[:int(0.85 * n)])
    tr, te = rest[:int(0.70 * n)], rest[int(0.70 * n):]

    def X(kind):
        return np.array([features(kind, r.file_format, r.size_bytes, r.active_workers) for r in df.itertuples()])

    candidates = {"linear_per_format": LinearRegression(),
                  "gbm": GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=42)}
    mats = {k: X(k) for k in candidates}
    scores = {}
    for kind, m in candidates.items():
        m.fit(mats[kind][tr], y[tr])
        scores[kind] = mean_absolute_error(y[val], np.maximum(m.predict(mats[kind][val]), 0))
        print(f"  {kind:18s} MAE on the largest 15% of files: {scores[kind]:.3f}s")
    best = min(scores, key=scores.get)
    model = candidates[best]
    pred = np.maximum(model.predict(mats[best][te]), 0)
    mae, r2 = mean_absolute_error(y[te], pred), r2_score(y[te], pred)
    model.fit(mats[best], y)                                    # final refit on ALL rows
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "kind": best, "trained_on": int(n),
                 "metrics": {"test_mae_sec": float(mae), "test_r2": float(r2),
                             "large_file_mae_sec": float(scores[best])}}, MODEL_PATH)
    print(f"best: {best} | random test MAE {mae:.3f}s, R2 {r2:.3f} | trained on {n} runs -> {MODEL_PATH}")


# ------------------------------------------------------------------ predict
class ProcessingTimePredictor:
    """Load once, reuse: this is what the dashboard will call in Phase 2."""

    def __init__(self, path=MODEL_PATH):
        import joblib
        if not Path(path).exists():
            raise FileNotFoundError(f"{path} not found; run `train` first")
        b = joblib.load(path)
        self.model, self.kind, self.metrics, self.trained_on = b["model"], b["kind"], b["metrics"], b["trained_on"]

    def duration(self, fmt: str, size_bytes: float, concurrency: float = 1) -> float:
        x = [features(self.kind, fmt, size_bytes, concurrency)]
        return max(0.001, float(self.model.predict(x)[0]))

    def predict_batch(self, files, workers):
        """Simulate N workers taking files in arrival order. One prediction per file."""
        free = [0.0] * workers
        heapq.heapify(free)
        out = []
        for p in files:
            size = Path(p).stat().st_size
            fmt = format_of(p)
            start = heapq.heappop(free)
            busy = sum(1 for f in free if f > start) + 1
            if fmt is None or size == 0:                       # will be rejected instantly
                dur, note = 0.0, "will fail fast (unsupported type or empty)"
            else:
                dur, note = self.duration(fmt, size, busy), ""
            heapq.heappush(free, start + dur)
            out.append({"file_name": Path(p).name, "path": str(p), "file_format": fmt or "UNSUPPORTED",
                        "size_kb": round(size / 1024, 1), "predicted_queue_wait_sec": round(start, 3),
                        "predicted_duration_sec": round(dur, 3), "predicted_finish_sec": round(start + dur, 3),
                        "concurrency_assumed": busy, "note": note})
        return out


def cmd_predict(a):
    preds = ProcessingTimePredictor().predict_batch(expand(a.files), a.workers)
    print(f"{'file':40s}{'format':>8s}{'KB':>11s}{'wait':>9s}{'duration':>10s}{'finish':>9s}")
    for r in preds:
        print(f"{r['file_name'][:39]:40s}{r['file_format']:>8s}{r['size_kb']:>11,.0f}"
              f"{r['predicted_queue_wait_sec']:>8.2f}s{r['predicted_duration_sec']:>9.2f}s{r['predicted_finish_sec']:>8.2f}s")
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(preds, indent=2), encoding="utf-8")
        print(f"wrote {a.json}")


def cmd_run(a):
    files = expand(a.files)
    pred = ProcessingTimePredictor()
    preds = pred.predict_batch(files, a.workers)
    actual = {r["path"]: r for r in run_parallel(files, a.workers)}
    print(f"{'file':38s}{'format':>7s}{'KB':>10s}{'pred':>8s}{'actual':>8s}{'error':>8s}  status")
    errs = []
    for p in preds:
        r = actual[p["path"]]
        err = r["duration_sec"] - p["predicted_duration_sec"]
        if r["status"] == "success":
            errs.append(abs(err))
        print(f"{p['file_name'][:37]:38s}{r['file_format']:>7s}{r['size_bytes'] / 1024:>10,.0f}"
              f"{p['predicted_duration_sec']:>7.2f}s{r['duration_sec']:>7.2f}s{err:>+7.2f}s  "
              f"{'ok' if r['status'] == 'success' else 'failed: ' + r['error'][:30]}")
    if errs:
        print(f"\nmean absolute error on {len(errs)} successful files: {sum(errs) / len(errs):.3f}s")


# ------------------------------------------------------------------ CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("collect", help="process files in parallel and log timings")
    s.add_argument("--dir", default="samples", help="folder holding your .csv/.json/.xlsx files")
    s.add_argument("--workers-list", default="1,2,4", help="worker counts to cycle through (varies concurrency)")
    s.add_argument("--repeat", type=int, default=3, help="process every file this many times (more training rows)")
    s.set_defaults(fn=cmd_collect)

    s = sub.add_parser("import-log", help="import a CSV table of process start / complete / size")
    s.add_argument("csv")
    s.add_argument("--format", default="CSV", help="file format those rows were (CSV, JSON or XLSX)")
    s.set_defaults(fn=cmd_import_log)

    s = sub.add_parser("train", help="train the model from the timings log")
    s.add_argument("--min-rows", type=int, default=30)
    s.set_defaults(fn=cmd_train)

    s = sub.add_parser("predict", help="predict per-file time for files arriving together")
    s.add_argument("files", nargs="+")
    s.add_argument("--workers", type=int, default=4)
    s.add_argument("--json")
    s.set_defaults(fn=cmd_predict)

    s = sub.add_parser("run", help="predict, process in parallel, compare")
    s.add_argument("files", nargs="+")
    s.add_argument("--workers", type=int, default=4)
    s.set_defaults(fn=cmd_run)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":      # required on Windows (processes are spawned, not forked)
    main()
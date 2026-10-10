"""
Per-file processing-time prediction for files that arrive together and run in parallel.

Pipeline (each step is a CLI command):
  make-data  -> build many test files of different sizes from your big CSVs
  collect    -> run them through the validator IN PARALLEL (separate processes) and log, per file,
                size / rows / how many files were running / seconds taken  -> output/file_timings.csv
  train      -> fit a model on that log (70/15/15 split), keep the best, save output/time_model.joblib
  predict    -> for a set of files arriving now: predicted duration, queue wait, finish time, per file
  run        -> predict, then really process the files in parallel and compare predicted vs actual

Unit of work today = file-level validation (final_level_validation.py). When the full validator
(record rules etc.) exists, swap it into _process() and re-run collect + train: nothing else changes.

Needs: pandas, numpy, scikit-learn, joblib (already in your requirements.txt).
"""
from __future__ import annotations

import argparse
import csv
import glob
import heapq
import json
import multiprocessing as mp
import os
import random
import shutil
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import file_level_validation as flv  # noqa: E402

OUT = Path("output")
TIMINGS_CSV = OUT / "file_timings.csv"
MODEL_PATH = OUT / "time_model.joblib"
TYPES = list(flv.FILE_TYPES)
TIMING_FIELDS = ["file_name", "file_type", "size_bytes", "rows", "active_workers",
                 "duration_sec", "queue_wait_sec", "passed"]

_active = None            # shared counter of files currently being processed (set in each worker)


# ------------------------------------------------------------------ small helpers
def file_type_of(path) -> str | None:
    m = flv.FILENAME_RE.match(Path(path).name)
    return m.group(1).lower() if m else None


def count_rows(path) -> int:
    """Fast data-row count (newlines, minus header). ~0.1 s per 100 MB."""
    n, last = 0, b"\n"
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            n += chunk.count(b"\n")
            last = chunk[-1:]
    if last != b"\n":
        n += 1
    return max(n - 1, 0)


def fv_direct(file_type, rows, size_bytes, concurrency):
    """Features for a model that predicts seconds directly (extrapolates linearly in rows)."""
    return [float(rows), size_bytes / 1e6, float(concurrency)] + [1.0 if file_type == t else 0.0 for t in TYPES]


def fv_per_row(file_type, rows, size_bytes, concurrency):
    """Features for a model that predicts seconds PER ROW (then x rows): stays sensible for files
    bigger than any seen in training, because per-row cost is roughly constant."""
    import math as _m
    return [_m.log10(rows + 1), size_bytes / max(rows, 1), float(concurrency)] + \
           [1.0 if file_type == t else 0.0 for t in TYPES]


def predict_seconds(kind, model, file_type, rows, size_bytes, concurrency):
    if kind == "per_row_gbm":
        return float(model.predict([fv_per_row(file_type, rows, size_bytes, concurrency)])[0]) * max(rows, 1)
    return float(model.predict([fv_direct(file_type, rows, size_bytes, concurrency)])[0])


# ------------------------------------------------------------------ parallel processing
def _init_worker(counter):
    global _active
    _active = counter


def _process(path, registry_dir, submit_ts, rows):
    """Runs in a worker process. Times ONE file and records how many files were running."""
    start_wall = time.time()
    with _active.get_lock():
        _active.value += 1
        active = _active.value                       # includes this file
    t0 = time.perf_counter()
    try:
        svc = flv.FileValidationService(flv.ChecksumRegistry(Path(registry_dir) / "reg.sqlite"))
        res = svc.validate_file(path)                # <-- swap in the full validator here later
        passed, err = res.passed, res.error_code
    except Exception as e:                           # never let one file kill the pool
        passed, err = False, f"EXC:{e.__class__.__name__}"
    duration = time.perf_counter() - t0
    with _active.get_lock():
        _active.value -= 1
    return {"path": str(path), "file_name": Path(path).name, "file_type": file_type_of(path) or "other",
            "size_bytes": Path(path).stat().st_size, "rows": rows, "active_workers": active,
            "duration_sec": duration, "queue_wait_sec": start_wall - submit_ts,
            "finish_sec": time.time() - submit_ts, "passed": passed, "error": err}


def run_parallel(files, workers):
    """Process all files at once with a pool of `workers` PROCESSES (one file per worker at a time)."""
    rows_by_path = {str(p): count_rows(p) for p in files}
    counter = mp.Value("i", 0)
    tmp = tempfile.mkdtemp(prefix="flv_")
    out = []
    try:
        t_submit = time.time()
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker, initargs=(counter,)) as ex:
            futs = [ex.submit(_process, str(p), tmp, t_submit, rows_by_path[str(p)]) for p in files]
            for f in as_completed(futs):
                out.append(f.result())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ------------------------------------------------------------------ make-data
def cmd_make_data(a):
    src_dir, out_dir = Path(a.src), Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(a.seed)
    per_type = max(1, a.n // len(TYPES))
    made = 0
    for t in TYPES:
        src = next((p for p in (src_dir / f"{t}_1_000_000.csv", src_dir / f"{t}_100_000.csv",
                                src_dir / f"{t}_sample_100.csv") if p.exists()), None)
        if src is None:
            print(f"  skip {t}: no source csv in {src_dir}")
            continue
        with open(src, "r", encoding="utf-8", newline="") as f:
            header = f.readline()
            lines = f.readlines()
        hi = min(a.max_rows, len(lines))
        lo = min(a.min_rows, hi)
        for i in range(per_type):
            k = int(round(lo * ((hi / lo) ** rng.random())))        # log-uniform sizes
            start = rng.randint(0, len(lines) - k)
            with open(out_dir / f"{t}_gen{i:04d}_{k}.csv", "w", encoding="utf-8", newline="") as w:
                w.write(header)
                w.writelines(lines[start:start + k])
            made += 1
        del lines
        print(f"  {t}: {per_type} files from {src.name} (rows {lo:,}..{hi:,})")
    print(f"made {made} files in {out_dir}")


# ------------------------------------------------------------------ collect
def cmd_collect(a):
    files = sorted(Path(a.dir).glob("*.csv"))
    if not files:
        sys.exit(f"no csv files in {a.dir}")
    random.Random(1).shuffle(files)
    worker_levels = [int(x) for x in a.workers_list.split(",")]
    groups = [files[i::len(worker_levels)] for i in range(len(worker_levels))]
    OUT.mkdir(parents=True, exist_ok=True)
    new = not TIMINGS_CSV.exists()
    total = 0
    with open(TIMINGS_CSV, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=TIMING_FIELDS, extrasaction="ignore")
        if new:
            w.writeheader()
        for workers, grp in zip(worker_levels, groups):
            t0 = time.time()
            res = run_parallel(grp, workers)
            for r in res:
                w.writerow(r)
            fh.flush()
            total += len(res)
            print(f"  {len(res)} files with {workers} worker process(es) in {time.time() - t0:.1f}s")
            if a.cleanup:
                for p in grp:
                    p.unlink(missing_ok=True)
    print(f"logged {total} files -> {TIMINGS_CSV}")


# ------------------------------------------------------------------ train
def cmd_train(a):
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, r2_score

    df = pd.read_csv(TIMINGS_CSV)
    df = df[df["passed"].astype(str) == "True"].reset_index(drop=True)
    if len(df) < 30:
        sys.exit(f"only {len(df)} passed rows in {TIMINGS_CSV}; collect more (target 1000+)")
    rows = df["rows"].to_numpy()
    y = df["duration_sec"].to_numpy()
    Xd = np.array([fv_direct(r.file_type, r.rows, r.size_bytes, r.active_workers) for r in df.itertuples()])
    Xp = np.array([fv_per_row(r.file_type, r.rows, r.size_bytes, r.active_workers) for r in df.itertuples()])
    y_pr = y / np.maximum(rows, 1)

    # Split (Excel: 70/15/15). Validation = the LARGEST 15% of files, so model choice rewards models that
    # cope with files bigger than they trained on. Train/test = random 70% / 15% of the rest.
    order = np.argsort(rows)
    n = len(df)
    val = order[int(0.85 * n):]
    rest = np.random.default_rng(42).permutation(order[:int(0.85 * n)])
    tr, te = rest[:int(0.70 * n)], rest[int(0.70 * n):]

    models = {"linear": ("linear", LinearRegression(), Xd, y),
              "per_row_gbm": ("per_row_gbm", GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=42), Xp, y_pr)}
    scores = {}
    for name, (kind, m, X, target) in models.items():
        m.fit(X[tr], target[tr])
        pred = np.maximum(m.predict(X[val]) * (rows[val] if kind == "per_row_gbm" else 1), 0.0)
        scores[name] = mean_absolute_error(y[val], pred)
        print(f"  {name:12s} MAE on the largest 15% of files: {scores[name]:.3f}s")
    best = min(scores, key=scores.get)
    kind, model, X, target = models[best]
    pred = np.maximum(model.predict(X[te]) * (rows[te] if kind == "per_row_gbm" else 1), 0.0)
    mae, r2 = mean_absolute_error(y[te], pred), r2_score(y[te], pred)
    model.fit(X, target)                                    # final refit on ALL data
    bpr = (df.assign(b=df.size_bytes / df.rows.clip(lower=1)).groupby("file_type")["b"].median().to_dict())
    joblib.dump({"model": model, "kind": kind, "bytes_per_row": bpr, "trained_on": int(n),
                 "metrics": {"test_mae_sec": float(mae), "test_r2": float(r2),
                             "large_file_mae_sec": float(scores[best])}}, MODEL_PATH)
    print(f"best: {best} | random test MAE {mae:.3f}s, R2 {r2:.3f} | trained on {n} files -> {MODEL_PATH}")
    if n < 1000:
        print("  note: the Excel suggests 1000+ records; more data = better predictions.")


# ------------------------------------------------------------------ predict
class TimePredictor:
    def __init__(self, path=MODEL_PATH):
        import joblib
        bundle = joblib.load(path)
        self.model, self.kind, self.metrics = bundle["model"], bundle["kind"], bundle["metrics"]

    def duration(self, file_type, rows, size_bytes, concurrency):
        return max(0.01, predict_seconds(self.kind, self.model, file_type, rows, size_bytes, concurrency))

    def predict_batch(self, files, workers):
        """Simulate N workers pulling files in arrival order. Returns one prediction per file."""
        free = [0.0] * workers                    # time each worker becomes free
        heapq.heapify(free)
        out = []
        for p in files:
            size = Path(p).stat().st_size
            rows = count_rows(p)
            t = file_type_of(p) or "other"
            start = heapq.heappop(free)
            busy = sum(1 for f in free if f > start) + 1          # files running when this one starts
            dur = self.duration(t, rows, size, busy)
            heapq.heappush(free, start + dur)
            out.append({"file_name": Path(p).name, "path": str(p), "file_type": t, "rows": rows,
                        "size_mb": round(size / 1e6, 2), "predicted_queue_wait_sec": round(start, 2),
                        "predicted_duration_sec": round(dur, 2), "predicted_finish_sec": round(start + dur, 2),
                        "concurrency_assumed": busy})
        return out


def expand(patterns):
    files = []
    for p in patterns:
        hits = sorted(glob.glob(p))
        files.extend(hits if hits else [p])
    return [Path(f) for f in files]


def print_predictions(preds):
    print(f"{'file':34s}{'rows':>10s}{'MB':>8s}{'wait':>8s}{'duration':>10s}{'finish':>9s}")
    for r in preds:
        print(f"{r['file_name'][:33]:34s}{r['rows']:>10,}{r['size_mb']:>8.1f}"
              f"{r['predicted_queue_wait_sec']:>7.1f}s{r['predicted_duration_sec']:>9.1f}s{r['predicted_finish_sec']:>8.1f}s")


def cmd_predict(a):
    preds = TimePredictor().predict_batch(expand(a.files), a.workers)
    print_predictions(preds)
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(preds, indent=2), encoding="utf-8")
        print(f"wrote {a.json}")


def cmd_run(a):
    files = expand(a.files)
    preds = TimePredictor().predict_batch(files, a.workers)
    actual = {r["path"]: r for r in run_parallel(files, a.workers)}
    print(f"{'file':30s}{'rows':>9s}{'pred dur':>10s}{'actual':>9s}{'pred fin':>10s}{'actual':>9s}  status")
    for p in preds:
        r = actual[p["path"]]
        print(f"{p['file_name'][:29]:30s}{p['rows']:>9,}{p['predicted_duration_sec']:>9.1f}s{r['duration_sec']:>8.1f}s"
              f"{p['predicted_finish_sec']:>9.1f}s{r['finish_sec']:>8.1f}s  {'PASS' if r['passed'] else 'FAIL ' + str(r['error'])}")


# ------------------------------------------------------------------ CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("make-data", help="build test files of varied sizes from the big CSVs")
    s.add_argument("--src", required=True, help="folder holding accounts_1_000_000.csv etc.")
    s.add_argument("--out", default="output/training_files")
    s.add_argument("--n", type=int, default=400, help="total files (split across 4 types)")
    s.add_argument("--min-rows", type=int, default=500)
    s.add_argument("--max-rows", type=int, default=60000)
    s.add_argument("--seed", type=int, default=7)
    s.set_defaults(fn=cmd_make_data)

    s = sub.add_parser("collect", help="process files in parallel and log timings")
    s.add_argument("--dir", default="output/training_files")
    s.add_argument("--workers-list", default="1,2,4,8", help="worker counts to vary concurrency")
    s.add_argument("--cleanup", action="store_true", help="delete each file after it is logged")
    s.set_defaults(fn=cmd_collect)

    s = sub.add_parser("train", help="train the time model from file_timings.csv")
    s.set_defaults(fn=cmd_train)

    s = sub.add_parser("predict", help="predict per-file time for files arriving together")
    s.add_argument("files", nargs="+")
    s.add_argument("--workers", type=int, default=4)
    s.add_argument("--json", help="also write predictions as JSON for the dashboard/API")
    s.set_defaults(fn=cmd_predict)

    s = sub.add_parser("run", help="predict, then process in parallel and compare")
    s.add_argument("files", nargs="+")
    s.add_argument("--workers", type=int, default=4)
    s.set_defaults(fn=cmd_run)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":      # required on Windows (processes are spawned, not forked)
    main()

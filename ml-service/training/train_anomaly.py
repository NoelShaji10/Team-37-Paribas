"""Train the Layer 2 reference models (and optionally write evaluation reports).

Run from ml-service/:
    python -m training.train_anomaly --data-dir ../data
    python -m training.train_anomaly --data-dir ../data --eval     # also overfitting + benchmark CSVs

Expects the organiser files in --data-dir, e.g. "bank_txns_1,000,000.csv". The 100k files, if present,
are used as an independent test set. Models go to app/models/ (gitignored: regenerate, don't commit).
"""
import argparse
import gc
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services import anomaly_engine as engine  # noqa: E402

PREFIX = {"BANK_TXNS": "bank_txns", "PAYMENTS": "payments", "ACCOUNTS": "accounts", "RATES": "rates"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="../data")
    ap.add_argument("--train-size", default="1,000,000", help="file suffix used for training")
    ap.add_argument("--test-size", default="100,000", help="file suffix used as independent test")
    ap.add_argument("--out", default=os.path.join("app", "models"))
    ap.add_argument("--eval", action="store_true")
    ap.add_argument("--reports", default="reports")
    ap.add_argument("--today", default=None, help="fix 'today' for reproducible reports, e.g. 2026-10-10")
    args = ap.parse_args()

    overfit, drift, bench = [], [], []
    for ft, prefix in PREFIX.items():
        path = os.path.join(args.data_dir, f"{prefix}_{args.train_size}.csv")
        if not os.path.exists(path):
            print(f"SKIP {ft}: {path} not found")
            continue
        t0 = time.time()
        df = pd.read_csv(path, dtype=str)
        if ft == "RATES":  # series checks only: nothing to learn
            engine.fit_reference(df.head(1), ft, args.out)
            if args.eval:
                _, s = engine.benchmark(df, ft, None, seeds=(1, 2, 3), n=100, today=args.today)
                bench.append(s.assign(file_type=ft))
            print(f"{ft:10s} ready in {time.time() - t0:.0f}s")
            continue
        train, val, test = engine.split_70_15_15(df)
        del df
        ref = engine.fit_reference(train, ft, args.out)
        print(f"{ft:10s} trained on {len(train):,} rows in {time.time() - t0:.0f}s")
        if args.eval:
            splits = {"train (sample)": train.sample(len(test), random_state=0), "validation": val, "test": test}
            ext_path = os.path.join(args.data_dir, f"{prefix}_{args.test_size}.csv")
            ext = pd.read_csv(ext_path, dtype=str) if os.path.exists(ext_path) else None
            if ext is not None:
                splits["independent file"] = ext
                drift.append(engine.baseline_drift(ref, ext, ft).assign(file_type=ft))
            overfit.append(engine.overfitting_check(splits, ft, ref).assign(file_type=ft))
            _, s = engine.benchmark(test, ft, ref, seeds=(1, 2, 3, 4, 5), n=100, today=args.today)
            bench.append(s.assign(file_type=ft))
        del train, val, test
        gc.collect()

    if args.eval:
        os.makedirs(args.reports, exist_ok=True)
        for name, parts in (("eval_overfitting", overfit), ("eval_baseline_drift", drift), ("eval_benchmark", bench)):
            if parts:
                out = pd.concat(parts, ignore_index=True)
                out.to_csv(os.path.join(args.reports, f"{name}.csv"), index=False)
                print(f"\n{name}\n{out.to_string(index=False)}")


if __name__ == "__main__":
    main()

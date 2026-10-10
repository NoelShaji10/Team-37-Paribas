"""
The processing log: one CSV file, one row per processed file (successes AND failures).

- append_record() is guarded by a lock, so several uploads at once cannot garble the file.
  (Run the app with ONE uvicorn worker; the lock only protects threads inside one process.)
- If the log's header ever differs from FIELDS (e.g. a later phase adds columns), the old file is
  renamed to processing_log.csv.old-<timestamp> instead of being overwritten, and a new log starts.
"""
from __future__ import annotations

import csv
import os
import threading
import time
from pathlib import Path

LOG_PATH = Path(os.environ.get("PROCESSING_LOG", "output/processing_log.csv"))
FIELDS = ["file_id", "file_name", "file_format", "size_bytes", "size_kb", "rows", "start_time",
          "end_time", "duration_sec", "status", "error_message", "data_label"]
_lock = threading.Lock()


def _ensure_header(path: Path) -> None:
    """Create the log with a header, or move an old-format log out of the way."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        with open(path, "r", encoding="utf-8", newline="") as f:
            first = next(csv.reader(f), [])
        if first == FIELDS:
            return
        path.rename(path.with_name(f"{path.name}.old-{int(time.time())}"))
    with open(path, "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerow(FIELDS)


def append_record(record: dict, path: Path | None = None) -> None:
    path = Path(path or LOG_PATH)
    with _lock:
        _ensure_header(path)
        with open(path, "a", encoding="utf-8", newline="") as f:
            csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore").writerow(record)


def _typed(row: dict) -> dict:
    """CSV gives back text; turn the numeric columns back into numbers."""
    out = dict(row)
    for key, cast in (("size_bytes", int), ("size_kb", float), ("rows", int), ("duration_sec", float)):
        try:
            out[key] = cast(out[key])
        except (KeyError, TypeError, ValueError):
            out[key] = 0
    return out


def read_records(path: Path | None = None) -> list[dict]:
    """All records, oldest first. Empty list if there is no log yet."""
    path = Path(path or LOG_PATH)
    if not path.exists():
        return []
    with _lock, open(path, "r", encoding="utf-8", newline="") as f:
        return [_typed(r) for r in csv.DictReader(f)]


def compute_stats(records: list[dict]) -> dict:
    ok = [r for r in records if r["status"] == "success"]
    return {
        "files_processed": len(records),
        "successful": len(ok),
        "failed": len(records) - len(ok),
        # average over SUCCESSFUL files only: a failed file stops early and would pull the average down
        "avg_duration_sec": round(sum(r["duration_sec"] for r in ok) / len(ok), 4) if ok else None,
        "total_rows_processed": sum(r["rows"] for r in ok),
    }

"""Layer 2 service wrapper.

The Node backend sends valid rows in batches over HTTP. File-wide checks (velocity,
near-duplicates, rates series) need every row of a file, so this keeps one
AnomalyDetector per file between calls until /anomaly/finish is called.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import pandas as pd

from app.services import anomaly_engine as engine

MODEL_DIR = os.getenv("ANOMALY_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "models"))
SESSION_TTL_SECONDS = 6 * 3600  # forget files that never called finish

# The backend uses BANK_TXNS (classifier) and BANK_TRANSACTIONS (Prisma enum): accept both.
TYPE_ALIASES = {"BANK_TRANSACTIONS": "BANK_TXNS", "BANK_TXNS": "BANK_TXNS", "PAYMENTS": "PAYMENTS",
                "ACCOUNTS": "ACCOUNTS", "RATES": "RATES"}


def normalise_type(file_type: str) -> str:
    t = (file_type or "").strip().upper()
    if t not in TYPE_ALIASES:
        raise ValueError(f"Unsupported file type {file_type!r}; expected one of {sorted(TYPE_ALIASES)}")
    return TYPE_ALIASES[t]


class _Session:
    def __init__(self, detector: engine.AnomalyDetector):
        self.detector = detector
        self.row_map: list[int] = []  # internal row (index + 1) -> real file row number
        self.touched = time.time()


class AnomalyDetectorService:
    def __init__(self, model_dir: str = MODEL_DIR):
        self.model_dir = model_dir
        self.refs: dict[str, dict | None] = {}
        self.sessions: dict[str, _Session] = {}
        self.lock = threading.Lock()
        self.reload()

    def reload(self) -> dict:
        """Load the trained reference for every file type (run after training)."""
        self.refs = {ft: engine.load_reference(ft, self.model_dir) for ft in engine.FILE_TYPES}
        return self.status()

    def status(self) -> dict:
        """Loaded models: training rows, date, code version, scikit-learn version used vs installed."""
        return {ft: (None if ref is None else {
                    "rows": ref.get("rows"), "fitted_at": ref.get("fitted_at"), "version": ref.get("version"),
                    "sklearn_trained": ref.get("sklearn_trained"), "sklearn_runtime": ref.get("sklearn_runtime"),
                    "sklearn_mismatch": ref.get("sklearn_mismatch", False)})
                for ft, ref in self.refs.items()}

    def _session(self, file_id: str, file_type: str) -> _Session:
        with self.lock:
            now = time.time()
            for fid in [f for f, s in self.sessions.items() if now - s.touched > SESSION_TTL_SECONDS]:
                del self.sessions[fid]
            if file_id not in self.sessions:
                ft = normalise_type(file_type)
                self.sessions[file_id] = _Session(engine.AnomalyDetector(ft, reference=self.refs.get(ft)))
            s = self.sessions[file_id]
            s.touched = now
            return s

    @staticmethod
    def _map_rows(flags: list[dict], row_map: list[int]) -> list[dict]:
        for f in flags:
            r = f.get("row_number")
            if r is not None and 1 <= r <= len(row_map):
                f["row_number"] = row_map[r - 1]
        return flags

    def detect_batch(self, file_id: str, file_type: str, rows: list[dict[str, Any]],
                     row_numbers: list[int] | None = None) -> list[dict]:
        """Row-level checks for one batch of Layer-1-valid rows."""
        if not rows:
            return []
        s = self._session(file_id, file_type)
        start = len(s.row_map) + 1
        s.row_map.extend(row_numbers if row_numbers and len(row_numbers) == len(rows)
                         else range(start, start + len(rows)))
        flags = s.detector.score_chunk(pd.DataFrame(rows), start_row=start)
        return self._map_rows(flags, s.row_map)

    def finish(self, file_id: str) -> list[dict]:
        """File-wide checks once every batch is sent. Frees the session."""
        with self.lock:
            s = self.sessions.pop(file_id, None)
        if s is None:
            return []
        return self._map_rows(s.detector.finish(), s.row_map)

    def detect_file(self, features: dict, history: list[dict] | None = None) -> list[dict]:
        features = dict(features)
        if features.get("file_type"):
            features["file_type"] = normalise_type(features["file_type"])
        for h in history or []:
            if h.get("file_type"):
                h["file_type"] = normalise_type(h["file_type"])
        return engine.detect_file_anomalies(features, history)

    def detect(self, features: dict[str, Any], file_type: str | None = None):
        """Single-row check kept for the original /anomaly/detect contract."""
        ft = normalise_type(file_type) if file_type else self._guess_type(features)
        if ft is None:
            return False, 0.0, "Could not tell the file type from the row's columns"
        det = engine.AnomalyDetector(ft, reference=self.refs.get(ft))
        try:
            flags = det.score_chunk(pd.DataFrame([features]), start_row=1)
        except ValueError as e:
            return False, 0.0, str(e)
        if not flags:
            return False, 0.0, "No anomaly"
        top = max(flags, key=lambda f: f["score"])
        return True, top["score"], f"[{top['anomaly_type']}] {top['explanation']}"

    @staticmethod
    def _guess_type(features: dict) -> str | None:
        keys = set(features)
        for ft, cols in engine.COLUMNS.items():
            if set(cols) <= keys:
                return ft
        return None


anomaly_detector = AnomalyDetectorService()

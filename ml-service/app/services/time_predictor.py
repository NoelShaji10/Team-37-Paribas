"""Processing-time prediction (ETA) for the backend.

Uses the model trained by python/file_time_prediction.py (Tiya), saved as output/time_model.joblib,
through that script's own predict_seconds() so training and serving use identical features.
If no trained model is found, falls back to a simple size-based heuristic, labelled "heuristic".

Model search order: $TIME_MODEL_PATH, <repo>/output/time_model.joblib, <repo>/python/output/time_model.joblib,
ml-service/app/models/time_model.joblib.
"""
from __future__ import annotations

import os
import sys
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PYTHON_DIR = os.path.join(REPO_ROOT, "python")

# Backend file types -> the names used by python/file_level_validation.py
TYPE_MAP = {"BANK_TRANSACTIONS": "bank_txns", "BANK_TXNS": "bank_txns", "PAYMENTS": "payments",
            "ACCOUNTS": "accounts", "RATES": "rates"}


def _candidate_paths() -> list[str]:
    return [p for p in (
        os.getenv("TIME_MODEL_PATH"),
        os.path.join(REPO_ROOT, "output", "time_model.joblib"),
        os.path.join(PYTHON_DIR, "output", "time_model.joblib"),
        os.path.join(os.path.dirname(__file__), "..", "models", "time_model.joblib"),
    ) if p]


class TimePredictorService:
    def __init__(self):
        self.bundle: dict | None = None
        self.model_path: str | None = None
        self.load_error: str | None = None
        self._predict_fn = None
        self.reload()

    def reload(self) -> dict:
        self.bundle, self.model_path, self.load_error, self._predict_fn = None, None, None, None
        path = next((p for p in _candidate_paths() if os.path.exists(p) and os.path.getsize(p) > 0), None)
        if path:
            try:
                import joblib
                if PYTHON_DIR not in sys.path:
                    sys.path.insert(0, PYTHON_DIR)
                from file_time_prediction import predict_seconds  # Tiya's feature builder + predictor
                self.bundle, self.model_path, self._predict_fn = joblib.load(path), path, predict_seconds
            except Exception as e:  # keep serving with the heuristic
                self.load_error = f"{type(e).__name__}: {e}"
        return self.status()

    def status(self) -> dict:
        if not self.bundle:
            return {"method": "heuristic", "model_path": None, "error": self.load_error}
        return {"method": "model", "model_path": self.model_path, "kind": self.bundle.get("kind"),
                "trained_on": self.bundle.get("trained_on"), "metrics": self.bundle.get("metrics")}

    def predict(self, file_type: str | None, rows: int, size_bytes: int, concurrency: int = 1) -> dict[str, Any]:
        rows, size_bytes, concurrency = max(int(rows), 0), max(int(size_bytes), 0), max(int(concurrency), 1)
        if self.bundle and self._predict_fn:
            t = TYPE_MAP.get((file_type or "").upper(), (file_type or "other").lower())
            sec = self._predict_fn(self.bundle["kind"], self.bundle["model"], t, rows, size_bytes, concurrency)
            return {"seconds": round(max(0.01, sec), 2), "method": "model"}
        return {"seconds": self._heuristic(size_bytes / 1e6, rows), "method": "heuristic"}

    @staticmethod
    def _heuristic(file_size_mb: float, row_count: int) -> float:
        # About 500 rows per second plus file I/O overhead (the original placeholder formula)
        return round(1.5 + file_size_mb * 0.4 + row_count / 500.0, 2)

    def predict_seconds(self, file_size_mb: float, row_count: int) -> float:
        """Original API, kept for compatibility."""
        return self.predict(None, row_count, int(file_size_mb * 1e6), 1)["seconds"]


time_predictor = TimePredictorService()

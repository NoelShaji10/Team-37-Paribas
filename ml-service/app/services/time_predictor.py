"""Processing-time prediction (ETA) for the backend.

Supports both versions of Tiya's model in python/file_time_prediction.py:
* PR #8 (current): output/processing_time_model.joblib, kinds "linear_per_format" or "gbm",
  features = file format, size and concurrency, built by her own features() function.
* Earlier version: output/time_model.joblib, kinds "linear" or "per_row_gbm" (file type, rows, size, concurrency).
If no trained model is found, a size-based heuristic is used and labelled "heuristic".

Model search order: $TIME_MODEL_PATH, <repo>/output/processing_time_model.joblib, <repo>/output/time_model.joblib,
ml-service/app/models/processing_time_model.joblib, ml-service/app/models/time_model.joblib.
"""
from __future__ import annotations

import math
import os
import sys
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PYTHON_DIR = os.path.join(REPO_ROOT, "python")
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")

NEW_KINDS = ("linear_per_format", "gbm")       # PR #8
OLD_KINDS = ("linear", "per_row_gbm")          # earlier version
OLD_TYPES = ["accounts", "bank_txns", "payments", "rates"]
TYPE_MAP = {"BANK_TRANSACTIONS": "bank_txns", "BANK_TXNS": "bank_txns", "PAYMENTS": "payments",
            "ACCOUNTS": "accounts", "RATES": "rates"}


def _candidate_paths() -> list[str]:
    return [p for p in (
        os.getenv("TIME_MODEL_PATH"),
        os.path.join(REPO_ROOT, "output", "processing_time_model.joblib"),
        os.path.join(REPO_ROOT, "output", "time_model.joblib"),
        os.path.join(MODELS_DIR, "processing_time_model.joblib"),
        os.path.join(MODELS_DIR, "time_model.joblib"),
    ) if p]


def _old_features(kind: str, file_type: str, rows: int, size_bytes: int, concurrency: int) -> list:
    """Feature vectors of the earlier time model (copied here, because PR #8 removed those functions)."""
    onehot = [1.0 if file_type == t else 0.0 for t in OLD_TYPES]
    if kind == "per_row_gbm":
        return [math.log10(rows + 1), size_bytes / max(rows, 1), float(concurrency)] + onehot
    return [float(rows), size_bytes / 1e6, float(concurrency)] + onehot


class TimePredictorService:
    def __init__(self):
        self.bundle: dict | None = None
        self.model_path: str | None = None
        self.load_error: str | None = None
        self._new_features = None
        self.reload()

    def reload(self) -> dict:
        self.bundle, self.model_path, self.load_error, self._new_features = None, None, None, None
        for path in _candidate_paths():
            if not (os.path.exists(path) and os.path.getsize(path) > 0):
                continue
            try:
                import joblib
                bundle = joblib.load(path)
                if bundle.get("kind") in NEW_KINDS:
                    for p in (REPO_ROOT, PYTHON_DIR):
                        if p not in sys.path:
                            sys.path.insert(0, p)
                    from file_time_prediction import features  # Tiya's PR #8 feature builder
                    self._new_features = features
                elif bundle.get("kind") not in OLD_KINDS:
                    raise ValueError(f"unknown model kind {bundle.get('kind')!r}")
                self.bundle, self.model_path = bundle, path
                break
            except (Exception, SystemExit) as e:  # her module exits if webapp/ is missing; keep serving
                self.load_error = f"{os.path.basename(path)}: {type(e).__name__}: {e}"
        return self.status()

    def status(self) -> dict:
        if not self.bundle:
            return {"method": "heuristic", "model_path": None, "error": self.load_error}
        return {"method": "model", "model_path": self.model_path, "kind": self.bundle.get("kind"),
                "trained_on": self.bundle.get("trained_on"), "metrics": self.bundle.get("metrics")}

    def predict(self, file_type: str | None, rows: int, size_bytes: int, concurrency: int = 1,
                file_format: str = "CSV") -> dict[str, Any]:
        rows, size_bytes, concurrency = max(int(rows), 0), max(int(size_bytes), 0), max(int(concurrency), 1)
        if self.bundle:
            kind, model = self.bundle["kind"], self.bundle["model"]
            if kind in NEW_KINDS:
                x = self._new_features(kind, file_format.upper(), size_bytes, concurrency)
                sec = float(model.predict([x])[0])
            else:
                t = TYPE_MAP.get((file_type or "").upper(), (file_type or "other").lower())
                x = _old_features(kind, t, rows, size_bytes, concurrency)
                sec = float(model.predict([x])[0]) * (max(rows, 1) if kind == "per_row_gbm" else 1)
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

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.time_predictor import time_predictor

router = APIRouter()


class TimePredictionRequest(BaseModel):
    fileType: Optional[str] = None      # ACCOUNTS | BANK_TRANSACTIONS | PAYMENTS | RATES
    rowCount: int = 100
    sizeBytes: Optional[int] = None
    fileSizeMb: float = 1.0             # used when sizeBytes is not sent (older callers)
    concurrency: int = 1                # files expected to run at the same time


class TimePredictionResponse(BaseModel):
    estimatedSeconds: float
    unit: str = "seconds"
    method: str                         # "model" (trained) or "heuristic" (no model found)


@router.post("/predict-time", response_model=TimePredictionResponse)
def predict_processing_time(req: TimePredictionRequest):
    size = req.sizeBytes if req.sizeBytes is not None else int(req.fileSizeMb * 1e6)
    res = time_predictor.predict(req.fileType, req.rowCount, size, req.concurrency)
    return TimePredictionResponse(estimatedSeconds=res["seconds"], method=res["method"])


@router.get("/status")
def status():
    """Which time model is loaded. method=heuristic means: train it with python/file_time_prediction.py."""
    return time_predictor.status()


@router.post("/reload")
def reload():
    return time_predictor.reload()

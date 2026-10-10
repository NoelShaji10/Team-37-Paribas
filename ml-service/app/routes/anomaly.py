from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import anomaly_engine as engine
from app.services.anomaly_detector import anomaly_detector

router = APIRouter()


class AnomalyRequest(BaseModel):  # original single-row contract (kept for compatibility)
    fileId: str
    features: Dict[str, Any]
    fileType: Optional[str] = None


class AnomalyResponse(BaseModel):
    fileId: str
    isAnomaly: bool
    score: float
    reason: str
    explanation: str  # mlClient.ts reads "explanation"


class BatchRequest(BaseModel):
    fileId: str
    fileType: str
    rows: List[Dict[str, Any]]
    rowNumbers: Optional[List[int]] = None  # real file row numbers of the rows sent


class FinishRequest(BaseModel):
    fileId: str


class FileLevelRequest(BaseModel):
    features: Dict[str, Any]
    history: List[Dict[str, Any]] = []


class FlagsResponse(BaseModel):
    fileId: Optional[str] = None
    count: int
    flags: List[Dict[str, Any]]


@router.post("/detect", response_model=AnomalyResponse)
def detect_anomaly(req: AnomalyRequest):
    is_anomaly, score, reason = anomaly_detector.detect(req.features, req.fileType)
    return AnomalyResponse(fileId=req.fileId, isAnomaly=is_anomaly, score=score, reason=reason, explanation=reason)


@router.post("/detect-batch", response_model=FlagsResponse)
def detect_batch(req: BatchRequest):
    """Row-level Layer 2 checks for one batch of valid rows."""
    try:
        flags = anomaly_detector.detect_batch(req.fileId, req.fileType, req.rows, req.rowNumbers)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return FlagsResponse(fileId=req.fileId, count=len(flags), flags=flags)


@router.post("/finish", response_model=FlagsResponse)
def finish(req: FinishRequest):
    """File-wide checks (velocity, near-duplicates, rates series). Call once after the last batch."""
    flags = anomaly_detector.finish(req.fileId)
    return FlagsResponse(fileId=req.fileId, count=len(flags), flags=flags)


@router.post("/file-level", response_model=FlagsResponse)
def file_level(req: FileLevelRequest):
    """Size, record count, rejection rate and processing-time anomalies for a finished file."""
    try:
        flags = anomaly_detector.detect_file(req.features, req.history)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return FlagsResponse(count=len(flags), flags=flags)


@router.get("/status")
def status():
    """Which trained references are loaded. Empty entries mean: run training/train_anomaly.py."""
    return anomaly_detector.status()


@router.post("/reload")
def reload():
    return anomaly_detector.reload()


@router.get("/coverage")
def coverage():
    return engine.coverage_report().to_dict("records")

"""AI normalisation and suggested fixes. See app/services/normalizer.py for the logic."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.normalizer import normalizer

router = APIRouter()


class NormalizeRequest(BaseModel):
    fileId: str
    fileType: str
    rows: List[Dict[str, Any]]
    rowNumbers: Optional[List[int]] = None


class Issue(BaseModel):
    rowNumber: Optional[int] = None
    columnName: str
    cellValue: Optional[str] = None
    errorType: Optional[str] = None
    errorMessage: Optional[str] = None
    row: Optional[Dict[str, Any]] = None


class SuggestRequest(BaseModel):
    fileId: str
    fileType: str
    issues: List[Issue]


class FeedbackRequest(BaseModel):
    field: str
    original: str
    corrected: Optional[str] = None
    accepted: bool
    suggested: Optional[str] = None


class FinishRequest(BaseModel):
    fileId: str


@router.post("/batch")
def normalize_batch(req: NormalizeRequest):
    """Tier A: apply workbook transformation rules, log every change, report master-data issues."""
    return normalizer.normalize_batch(req.fileId, req.fileType, req.rows, req.rowNumbers)


@router.post("/suggest")
def suggest(req: SuggestRequest):
    """Tier B: one suggestion (or an explanation) per rejected value. Never applied automatically."""
    return {"suggestions": normalizer.suggest_batch(req.fileId, req.fileType, [i.model_dump() for i in req.issues])}


@router.post("/feedback")
def feedback(req: FeedbackRequest):
    """Learning from fixes: call when an operator accepts, edits or rejects a suggestion."""
    return normalizer.feedback(req.field, req.original, req.corrected, req.accepted, req.suggested)


@router.post("/finish")
def finish(req: FinishRequest):
    """File summary and '>50% rule' proposals. Call once after the last batch."""
    return normalizer.finish(req.fileId)


@router.get("/reference")
def reference():
    return normalizer.reference_info()

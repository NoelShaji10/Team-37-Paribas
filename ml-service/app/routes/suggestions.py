"""Single-value fix suggestion. Accepts the backend's shape (fieldName, originalValue, context) and the
older shape (field, invalidValue). Uses the same engine as /normalize/suggest."""
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.normalizer import normalizer

router = APIRouter()


class SuggestionRequest(BaseModel):
    fieldName: Optional[str] = None
    originalValue: Optional[str] = None
    context: Dict[str, Any] = {}
    field: Optional[str] = None          # older shape
    invalidValue: Optional[str] = None   # older shape


@router.post("/suggest-fix")
def suggest_fix(req: SuggestionRequest):
    field = req.fieldName or req.field or ""
    value = req.originalValue if req.originalValue is not None else (req.invalidValue or "")
    res = normalizer.suggest(field, value, row=req.context)
    return {"field": field, "originalValue": value, "suggestedValue": res["suggestion"],
            "confidence": res["confidence"], "explanation": res["explanation"], "source": res["source"]}

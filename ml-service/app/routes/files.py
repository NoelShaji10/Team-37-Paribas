from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.file_validator import file_validator

router = APIRouter()


class FileValidationRequest(BaseModel):
    path: str                       # absolute path on this machine (backend and ML service share the disk)
    fileName: Optional[str] = None  # original name, when the stored file was renamed


@router.post("/validate")
def validate_file(req: FileValidationRequest):
    """File-level checks before ingestion: extension, filename, empty, encoding/delimiter/header,
    record length and trailer. Failed files should be quarantined with the returned reason."""
    return file_validator.validate(req.path, req.fileName)

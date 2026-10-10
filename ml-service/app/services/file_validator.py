"""File-level validation for the backend, using Tiya's python/file_level_validation.py unchanged.

Two adjustments for running inside the app (made here, not in her file):
* Duplicate detection is skipped: the backend already rejects duplicates by checksum in PostgreSQL,
  and a second registry (her SQLite file) would disagree with it after a database reset.
* The filename rule also accepts commas and spaces, because the organiser files are named like
  "bank_txns_100,000.csv". Her pattern (letters, digits, _ and -) would quarantine every one of them.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PYTHON_DIR = os.path.join(REPO_ROOT, "python")
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import file_level_validation as flv  # noqa: E402  (Tiya's module)

flv.FILENAME_RE = re.compile(r"^(accounts|bank_txns|payments|rates)_[A-Za-z0-9_\-, ]+\.csv$", re.IGNORECASE)


class _NoRegistry:
    """Stands in for her ChecksumRegistry; duplicates are handled by the backend."""

    def claim(self, checksum: str, file_name: str) -> bool:  # noqa: ARG002
        return True

    def release(self, checksum: str) -> None:  # noqa: ARG002
        return None


class FileValidator:
    def __init__(self):
        self.service = flv.FileValidationService(registry=_NoRegistry())
        # Same checks, same order, minus the duplicate check
        self.service.checks = [flv.check_extension, flv.check_filename, flv.check_not_empty,
                               flv.check_encoding_delimiter_header, flv.check_records]

    def validate(self, path: str, file_name: str | None = None) -> dict[str, Any]:
        """Validate the file at `path`. If the stored name differs from the original (uploads get a
        random name), the check runs on a temporary link carrying the original name."""
        if not os.path.exists(path):
            return {"passed": False, "errorCode": flv.FILE_UNREADABLE, "reason": f"File not found: {path}",
                    "fileType": None, "totalRows": 0}
        target, link = path, None
        if file_name and os.path.basename(path) != file_name:
            link_dir = os.path.join(os.path.dirname(path), ".validate")
            os.makedirs(link_dir, exist_ok=True)
            link = os.path.join(link_dir, os.path.basename(file_name))
            if os.path.lexists(link):
                os.remove(link)
            os.symlink(os.path.abspath(path), link)
            target = link
        try:
            r = self.service.validate_file(target)
        finally:
            if link and os.path.lexists(link):
                os.remove(link)
        return {"passed": r.passed, "errorCode": r.error_code, "reason": r.reason, "fileType": r.file_type,
                "totalRows": r.total_rows}


file_validator = FileValidator()


from __future__ import annotations

import codecs
import csv
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

# ----------------------------------------------------------------- config
FILE_TYPES: dict[str, list[str]] = {          # expected header per file type
    "accounts":  ["account_number", "account_holder_name", "account_type", "balance",
                  "currency", "account_status", "ifsc_code"],
    "bank_txns": ["transaction_id", "account_number", "transaction_date", "transaction_type",
                  "amount", "currency", "description", "ifsc_code"],
    "payments":  ["payment_id", "account_number", "payment_date", "payment_method",
                  "amount", "currency", "payment_status", "ifsc_code"],
    "rates":     ["rate_id", "currency_pair", "rate_date", "exchange_rate", "rate_type"],
}
FILENAME_RE = re.compile(r"^(accounts|bank_txns|payments|rates)_[A-Za-z0-9_\-]+\.csv$", re.IGNORECASE)
TRAILER_RE = re.compile(r"^(TRAILER|TRL|FOOTER|EOF)$", re.IGNORECASE)   # first cell of a trailer row
ALLOWED_EXTENSIONS = {".csv"}
HEAD_BYTES = 64 * 1024
HASH_CHUNK = 1024 * 1024

# stable error codes (all fatal -> quarantine)
FILE_NAME_PATTERN = "FILE_NAME_PATTERN"
FILE_EXTENSION = "FILE_EXTENSION"
FILE_EMPTY = "FILE_EMPTY"
FILE_ENCODING = "FILE_ENCODING"
FILE_DELIMITER = "FILE_DELIMITER"
FILE_DUPLICATE = "FILE_DUPLICATE"
FILE_HEADER_MISMATCH = "FILE_HEADER_MISMATCH"
FILE_RECORD_LENGTH = "FILE_RECORD_LENGTH"
FILE_TRUNCATED = "FILE_TRUNCATED"
FILE_UNREADABLE = "FILE_UNREADABLE"


# ----------------------------------------------------------------- result types
@dataclass(frozen=True)
class FileResult:
    passed: bool
    error_code: Optional[str] = None
    reason: Optional[str] = None
    file_type: Optional[str] = None
    checksum: Optional[str] = None
    total_rows: int = 0                      # data rows (header and trailer excluded)

    @staticmethod
    def ok() -> "FileResult":
        return FileResult(True)

    @staticmethod
    def fail(code: str, reason: str) -> "FileResult":
        return FileResult(False, code, reason)


@dataclass
class FileContext:
    """Per-file state, created fresh for every validation (never shared between files)."""
    path: Path
    file_type: Optional[str] = None
    header: list[str] = field(default_factory=list)
    checksum: Optional[str] = None
    total_rows: int = 0


# ----------------------------------------------------------------- checksum registry
class ChecksumRegistry:
    """SQLite-backed 'files already accepted'. claim() is atomic, so two processes
    validating the same file at the same time cannot both pass."""

    def __init__(self, db_path: str | Path = "output/file_registry.sqlite"):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.execute("CREATE TABLE IF NOT EXISTS file_checksums ("
                      "checksum TEXT PRIMARY KEY, file_name TEXT, seen_at TEXT)")

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path, timeout=30)

    def claim(self, checksum: str, file_name: str) -> bool:
        """True if this checksum was new (now claimed); False if already seen."""
        with self._conn() as c:
            cur = c.execute("INSERT OR IGNORE INTO file_checksums VALUES (?,?,?)",
                            (checksum, file_name, datetime.now(timezone.utc).isoformat()))
            return cur.rowcount == 1

    def release(self, checksum: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM file_checksums WHERE checksum = ?", (checksum,))


# ----------------------------------------------------------------- helpers
def _decode_head(path: Path) -> str:
    """Decode the first HEAD_BYTES as UTF-8 (tolerating a cut multi-byte char at the end)."""
    with open(path, "rb") as f:
        raw = f.read(HEAD_BYTES)
    dec = codecs.getincrementaldecoder("utf-8-sig")(errors="strict")
    return dec.decode(raw, final=False)


def _split_header(line: str) -> list[str]:
    return [h.strip().lower() for h in next(csv.reader([line]))]


# ----------------------------------------------------------------- checks
Check = Callable[[FileContext], Optional[FileResult]]   # return None = pass, FileResult = fail


def check_extension(ctx: FileContext):
    if ctx.path.suffix.lower() not in ALLOWED_EXTENSIONS:
        return FileResult.fail(FILE_EXTENSION,
                               f"Extension '{ctx.path.suffix}' not allowed; expected .csv")


def check_filename(ctx: FileContext):
    m = FILENAME_RE.match(ctx.path.name)
    if not m:
        return FileResult.fail(FILE_NAME_PATTERN,
                               f"File name '{ctx.path.name}' does not match <accounts|bank_txns|payments|rates>_<name>.csv")
    ctx.file_type = m.group(1).lower()


def check_not_empty(ctx: FileContext):
    try:
        size = ctx.path.stat().st_size
    except OSError as e:
        return FileResult.fail(FILE_UNREADABLE, f"Cannot read file: {e}")
    if size == 0:
        return FileResult.fail(FILE_EMPTY, "File is empty (0 bytes)")


def check_encoding_delimiter_header(ctx: FileContext):
    """Head-only check: UTF-8 decodable, comma-delimited, header matches the file type exactly."""
    try:
        text = _decode_head(ctx.path)
    except UnicodeDecodeError as e:
        return FileResult.fail(FILE_ENCODING, f"File is not valid UTF-8 near byte {e.start}")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return FileResult.fail(FILE_EMPTY, "File has no content (blank lines only)")
    first = lines[0]
    if "," not in first and (";" in first or "\t" in first or "|" in first):
        return FileResult.fail(FILE_DELIMITER, "Delimiter is not a comma (found ; tab or |)")
    header = _split_header(first)
    expected = FILE_TYPES[ctx.file_type]
    if header != expected:
        missing = [c for c in expected if c not in header]
        extra = [c for c in header if c not in expected]
        detail = []
        if missing: detail.append(f"missing {missing}")
        if extra: detail.append(f"unexpected {extra}")
        if not missing and not extra: detail.append("columns are in a different order")
        return FileResult.fail(FILE_HEADER_MISMATCH,
                               f"Header does not match {ctx.file_type} schema: " + "; ".join(detail))
    ctx.header = header
    if len(lines) == 1 and ctx.path.stat().st_size < HEAD_BYTES:
        return FileResult.fail(FILE_EMPTY, "File has a header but no data rows")


def make_duplicate_check(registry: ChecksumRegistry) -> Check:
    def check_duplicate(ctx: FileContext):
        h = hashlib.sha256()
        with open(ctx.path, "rb") as f:
            for chunk in iter(lambda: f.read(HASH_CHUNK), b""):
                h.update(chunk)
        ctx.checksum = h.hexdigest()
        if not registry.claim(ctx.checksum, ctx.path.name):
            return FileResult.fail(FILE_DUPLICATE,
                                   f"Identical file already processed (sha256 {ctx.checksum[:12]}...)")
    return check_duplicate


def check_records(ctx: FileContext):
    """One streaming pass: full-file UTF-8 check, every row has header-length fields,
    optional trailer row ('TRAILER,<count>') must be last and match the row count."""
    width = len(ctx.header)
    rows = 0
    trailer_count: Optional[int] = None
    trailer_line = 0
    try:
        with open(ctx.path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            next(reader)                                        # header
            for rec in reader:
                line_no = reader.line_num
                if not rec or all(not c.strip() for c in rec):
                    continue                                    # blank line
                if trailer_count is not None:
                    return FileResult.fail(FILE_TRUNCATED,
                                           f"Data found after trailer row (line {line_no})")
                if TRAILER_RE.match(rec[0].strip()):
                    try:
                        trailer_count = int(rec[1].strip())
                        trailer_line = line_no
                        continue
                    except (IndexError, ValueError):
                        return FileResult.fail(FILE_TRUNCATED,
                                               f"Trailer row at line {line_no} has no valid row count")
                if len(rec) != width:
                    return FileResult.fail(FILE_RECORD_LENGTH,
                                           f"Line {line_no} has {len(rec)} fields, expected {width}")
                rows += 1
    except UnicodeDecodeError as e:
        return FileResult.fail(FILE_ENCODING, f"File is not valid UTF-8 near byte {e.start}")
    except csv.Error as e:
        return FileResult.fail(FILE_RECORD_LENGTH, f"Malformed CSV: {e}")
    if rows == 0:
        return FileResult.fail(FILE_EMPTY, "File has a header but no data rows")
    if trailer_count is not None and trailer_count != rows:
        return FileResult.fail(FILE_TRUNCATED,
                               f"Trailer (line {trailer_line}) says {trailer_count} rows but file has {rows}")
    ctx.total_rows = rows


# ----------------------------------------------------------------- service
class FileValidationService:
    def __init__(self, registry: Optional[ChecksumRegistry] = None):
        self.registry = registry or ChecksumRegistry()
        self.checks: list[Check] = [
            check_extension,
            check_filename,
            check_not_empty,
            check_encoding_delimiter_header,
            make_duplicate_check(self.registry),
            check_records,
        ]

    def validate_file(self, path: str | Path) -> FileResult:
        ctx = FileContext(Path(path))
        for check in self.checks:
            failure = check(ctx)
            if failure is not None:
                if ctx.checksum and failure.error_code != FILE_DUPLICATE:
                    self.registry.release(ctx.checksum)   # failed file must not block a corrected resend
                return FileResult(False, failure.error_code, failure.reason,
                                  ctx.file_type, ctx.checksum)
        return FileResult(True, None, None, ctx.file_type, ctx.checksum, ctx.total_rows)


# ----------------------------------------------------------------- quarantine
def quarantine_file(path: str | Path, result: FileResult,
                    quarantine_dir: str | Path = "output/quarantine",
                    log_file: str | Path = "output/file_validation_log.jsonl") -> Path:
    """Move a failed file into the quarantine folder and append the reason to a JSON-lines log."""
    path = Path(path)
    qdir = Path(quarantine_dir); qdir.mkdir(parents=True, exist_ok=True)
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    target = qdir / path.name
    if target.exists():
        target = qdir / f"{path.stem}.{datetime.now().strftime('%Y%m%d%H%M%S%f')}{path.suffix}"
    shutil.move(str(path), str(target))
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "file": path.name,
                            "quarantined_to": str(target), "error_code": result.error_code,
                            "reason": result.reason}) + "\n")
    return target


# ----------------------------------------------------------------- CLI
if __name__ == "__main__":
    """python file_level_validation.py <file> [<file> ...] [--quarantine]
    Checks only; with --quarantine failed files are MOVED to output/quarantine."""
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_q = "--quarantine" in sys.argv
    if not args:
        sys.exit("usage: python file_level_validation.py <file> [<file> ...] [--quarantine]")
    svc = FileValidationService(ChecksumRegistry("output/file_registry.sqlite"))
    for p in args:
        r = svc.validate_file(p)
        if r.passed:
            print(f"PASS  {Path(p).name}  type={r.file_type} rows={r.total_rows:,}")
        else:
            print(f"FAIL  {Path(p).name}  [{r.error_code}] {r.reason}")
            if do_q:
                print("      quarantined ->", quarantine_file(p, r))
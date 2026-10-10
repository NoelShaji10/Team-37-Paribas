"""
FastAPI app. It only handles web things (receive uploads, return JSON/CSV, serve the page).
All real work is in processing.py and logstore.py.

Run from the repository root:   python -m uvicorn webapp.main:app --reload
Then open:                      http://127.0.0.1:8000
"""
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from . import logstore, processing

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 500 * 1024 * 1024        # refuse single files above 500 MB
CHUNK = 1024 * 1024                         # copy uploads to disk 1 MB at a time (never all in memory)

app = FastAPI(title="File Processing Dashboard")


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


def _handle_one(up: UploadFile) -> dict:
    """Save one upload to a temp file, process it, log it, delete the temp file."""
    name = Path((up.filename or "unnamed").replace("\\", "/")).name or "unnamed"   # drop any folder part
    suffix = Path(name).suffix.lower()
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir) / f"upload{suffix}"
            size, too_big = 0, False
            with open(tmp_path, "wb") as out:
                while True:
                    chunk = up.file.read(CHUNK)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        too_big = True
                        break
                    out.write(chunk)
            if too_big:
                record = processing.failure_record(
                    name, size, f"File is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
            else:
                record = processing.process_file(tmp_path, name)
    except Exception as e:                       # e.g. disk full while saving the upload
        record = processing.failure_record(name, 0, f"Could not read the uploaded file ({e.__class__.__name__})")
    finally:
        up.file.close()
    logstore.append_record(record)
    return record


@app.post("/api/upload")
def upload(files: list[UploadFile] = File(...)):
    """Accepts one or many files; returns one record per file (success or failure)."""
    return {"results": [_handle_one(f) for f in files]}


@app.get("/api/records")
def records(limit: int = 500):
    """Processing history, newest first."""
    return {"records": list(reversed(logstore.read_records()))[: max(1, min(limit, 5000))]}


@app.get("/api/stats")
def stats():
    return logstore.compute_stats(logstore.read_records())


@app.get("/download/log")
def download_log():
    if not logstore.LOG_PATH.exists():
        return JSONResponse({"detail": "No processing log yet. Upload a file first."}, status_code=404)
    return FileResponse(logstore.LOG_PATH, media_type="text/csv", filename="processing_log.csv")

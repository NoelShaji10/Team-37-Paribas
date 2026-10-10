"""Basic tests for the Phase 1 dashboard. Run:  python -m pytest tests/test_webapp.py
The first group tests the core (no web server needed). The api_ tests need fastapi + httpx and are
skipped automatically if those are not installed."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from webapp import logstore, processing  # noqa: E402

HEADER = "transaction_id,account_number,amount\n"


def make(tmp_path, name, content):
    p = tmp_path / name
    p.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    return p


def run(tmp_path, name, content):
    return processing.process_file(make(tmp_path, name, content), name)


# ---------------------------------------------------------------- CSV
def test_csv_counts_rows_and_records_metadata(tmp_path):
    r = run(tmp_path, "tx.csv", HEADER + "T1,111,5\nT2,222,6\nT3,333,7\n")
    assert r["status"] == "success" and r["rows"] == 3 and r["file_format"] == "CSV"
    assert r["size_bytes"] > 0 and r["size_kb"] == round(r["size_bytes"] / 1024, 2)
    assert r["duration_sec"] >= 0 and r["start_time"] <= r["end_time"] and r["error_message"] == ""


def test_csv_ignores_blank_lines_and_bom(tmp_path):
    r = run(tmp_path, "tx.csv", b"\xef\xbb\xbf" + (HEADER + "\nT1,1,1\n\n,,\nT2,2,2\n").encode())
    assert r["status"] == "success" and r["rows"] == 2


def test_csv_with_quoted_newline_counts_one_row(tmp_path):
    r = run(tmp_path, "tx.csv", HEADER + 'T1,"line1\nline2",5\nT2,2,2\n')
    assert r["rows"] == 2


def test_empty_file_fails(tmp_path):
    r = run(tmp_path, "empty.csv", b"")
    assert r["status"] == "failure" and "empty" in r["error_message"].lower()


def test_header_only_fails(tmp_path):
    r = run(tmp_path, "h.csv", HEADER)
    assert r["status"] == "failure" and "no transaction rows" in r["error_message"]


def test_binary_data_in_csv_fails(tmp_path):
    r = run(tmp_path, "bin.csv", b"\x00\x01\x02\x03" * 100)
    assert r["status"] == "failure" and "binary" in r["error_message"]


def test_invalid_utf8_csv_fails(tmp_path):
    r = run(tmp_path, "bad.csv", HEADER.encode() + b"T1,\xff\xfe,5\n")
    assert r["status"] == "failure" and "UTF-8" in r["error_message"]


# ---------------------------------------------------------------- JSON
def test_json_list(tmp_path):
    r = run(tmp_path, "tx.json", json.dumps([{"a": 1}, {"a": 2}]))
    assert r["status"] == "success" and r["rows"] == 2 and r["file_format"] == "JSON"


def test_json_object_with_transactions_key(tmp_path):
    r = run(tmp_path, "tx.json", json.dumps({"meta": 1, "transactions": [{"a": 1}] * 4}))
    assert r["rows"] == 4


def test_json_object_without_list_fails(tmp_path):
    r = run(tmp_path, "tx.json", json.dumps({"a": 1}))
    assert r["status"] == "failure" and "list of transactions" in r["error_message"]


def test_broken_json_fails_with_position(tmp_path):
    r = run(tmp_path, "tx.json", '{"transactions": [ {"a": 1}, ')
    assert r["status"] == "failure" and r["error_message"].startswith("Invalid JSON")


# ---------------------------------------------------------------- XLSX
def test_xlsx_counts_rows(tmp_path):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["transaction_id", "amount"])
    for i in range(7):
        ws.append([f"T{i}", i])
    ws.append([None, None])                       # blank row is ignored
    p = tmp_path / "tx.xlsx"
    wb.save(p)
    r = processing.process_file(p, "tx.xlsx")
    assert r["status"] == "success" and r["rows"] == 7 and r["file_format"] == "XLSX"


def test_fake_xlsx_fails(tmp_path):
    r = run(tmp_path, "fake.xlsx", "not an excel file")
    assert r["status"] == "failure" and "Not a valid .xlsx" in r["error_message"]


# ---------------------------------------------------------------- other
def test_unsupported_extension_fails(tmp_path):
    r = run(tmp_path, "notes.txt", "hello")
    assert r["status"] == "failure" and "Unsupported" in r["error_message"] and r["file_format"] == "TXT"


def test_sample_files_are_labelled(tmp_path):
    assert run(tmp_path, "sample_a.csv", HEADER + "T1,1,1\n")["data_label"] == "sample (synthetic)"
    assert run(tmp_path, "real.csv", HEADER + "T1,1,1\n")["data_label"] == "user upload"


# ---------------------------------------------------------------- log store
def test_log_roundtrip_and_stats(tmp_path):
    log = tmp_path / "log.csv"
    good = run(tmp_path, "g.csv", HEADER + "T1,1,1\nT2,2,2\n")
    bad = run(tmp_path, "b.csv", b"")
    logstore.append_record(good, log)
    logstore.append_record(bad, log)
    recs = logstore.read_records(log)
    assert [r["file_name"] for r in recs] == ["g.csv", "b.csv"]
    assert isinstance(recs[0]["rows"], int) and isinstance(recs[0]["duration_sec"], float)
    s = logstore.compute_stats(recs)
    assert s["files_processed"] == 2 and s["successful"] == 1 and s["failed"] == 1
    assert s["avg_duration_sec"] == recs[0]["duration_sec"] and s["total_rows_processed"] == 2


def test_stats_with_no_records():
    s = logstore.compute_stats([])
    assert s["files_processed"] == 0 and s["avg_duration_sec"] is None


def test_read_missing_log_gives_empty_list(tmp_path):
    assert logstore.read_records(tmp_path / "nope.csv") == []


def test_old_format_log_is_moved_not_overwritten(tmp_path):
    log = tmp_path / "log.csv"
    log.write_text("some,old,columns\n1,2,3\n", encoding="utf-8")
    logstore.append_record(run(tmp_path, "g.csv", HEADER + "T1,1,1\n"), log)
    assert len(logstore.read_records(log)) == 1
    assert any(p.name.startswith("log.csv.old-") for p in tmp_path.iterdir())


# ---------------------------------------------------------------- API (needs fastapi + httpx)
def test_api_upload_and_dashboard_endpoints(tmp_path):
    import pytest
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from webapp.main import app

    old = logstore.LOG_PATH
    logstore.LOG_PATH = tmp_path / "api_log.csv"
    try:
        c = TestClient(app)
        assert c.get("/").status_code == 200
        assert c.get("/download/log").status_code == 404           # nothing logged yet
        files = [("files", ("sample_ok.csv", (HEADER + "T1,1,1\n").encode(), "text/csv")),
                 ("files", ("sample_bad.json", b"{oops", "application/json"))]
        res = c.post("/api/upload", files=files).json()["results"]
        assert [r["status"] for r in res] == ["success", "failure"]
        stats = c.get("/api/stats").json()
        assert stats["files_processed"] == 2 and stats["failed"] == 1
        recs = c.get("/api/records").json()["records"]
        assert recs[0]["file_name"] == "sample_bad.json"             # newest first
        dl = c.get("/download/log")
        assert dl.status_code == 200 and dl.text.startswith("file_id,file_name")
    finally:
        logstore.LOG_PATH = old

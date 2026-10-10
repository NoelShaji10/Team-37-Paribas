"""ETA prediction and file-level validation endpoints. Run from ml-service/:  python -m pytest -q tests"""
import os

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
HEADER = "payment_id,account_number,payment_date,payment_method,amount,currency,payment_status,ifsc_code\n"


def test_prediction_returns_seconds_and_method():
    r = client.post("/prediction/predict-time", json={"fileType": "PAYMENTS", "rowCount": 10000,
                                                      "sizeBytes": 800000, "concurrency": 2}).json()
    assert r["estimatedSeconds"] > 0 and r["method"] in ("model", "heuristic")
    old = client.post("/prediction/predict-time", json={"fileSizeMb": 1.0, "rowCount": 100}).json()
    assert old["estimatedSeconds"] > 0  # the original request shape still works
    assert client.get("/prediction/status").json()["method"] in ("model", "heuristic")


def test_file_validation_pass_and_fail(tmp_path):
    good = tmp_path / "payments_100,000.csv"   # organiser-style name with a comma must pass
    good.write_text(HEADER + "P1,1,2025-01-01,wire,10,INR,completed,SBIN0001111\n")
    r = client.post("/files/validate", json={"path": str(good)}).json()
    assert r["passed"] and r["fileType"] == "payments" and r["totalRows"] == 1

    short = tmp_path / "payments_bad.csv"
    short.write_text(HEADER + "P1,1,2025-01-01\n")
    r = client.post("/files/validate", json={"path": str(short)}).json()
    assert not r["passed"] and r["errorCode"] == "FILE_RECORD_LENGTH"


def test_file_validation_uses_original_name_for_uploads(tmp_path):
    stored = tmp_path / "a1b2c3"               # multer stores uploads under a random name
    stored.write_text(HEADER + "P1,1,2025-01-01,wire,10,INR,completed,SBIN0001111\n")
    assert client.post("/files/validate", json={"path": str(stored), "fileName": "payments_demo.csv"}).json()["passed"]
    r = client.post("/files/validate", json={"path": str(stored), "fileName": "report.csv"}).json()
    assert r["errorCode"] == "FILE_NAME_PATTERN"
    assert not os.path.exists(tmp_path / ".validate" / "report.csv")  # temporary link cleaned up

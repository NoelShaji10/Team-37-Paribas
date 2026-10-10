"""Layer 2 API tests. Run from ml-service/:  python -m pytest -q tests"""
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def make_txns(n=400, seed=0):
    rng = np.random.default_rng(seed)
    return [{
        "transaction_id": f"T{i}", "account_number": f"{1000000000 + i}",
        "transaction_date": f"2025-0{1 + i % 9}-1{i % 9} {i % 24:02d}:{i % 60:02d}:00",
        "transaction_type": "debit" if i % 2 else "credit", "amount": f"{rng.uniform(100, 500000):.2f}",
        "currency": ["INR", "USD", "EUR"][i % 3], "description": "x", "ifsc_code": "SBIN0001111",
    } for i in range(n)]


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_batch_flags_high_value_with_real_row_numbers():
    rows = make_txns()
    rows[10]["amount"] = "9000000.00"
    rows[11]["amount"], rows[11]["currency"] = "499500.00", "INR"
    row_numbers = list(range(1001, 1001 + len(rows)))  # pretend these rows sit at file rows 1001+
    r = client.post("/anomaly/detect-batch", json={"fileId": "f1", "fileType": "BANK_TXNS",
                                                    "rows": rows, "rowNumbers": row_numbers})
    assert r.status_code == 200
    flags = r.json()["flags"]
    assert any(f["anomaly_type"] == "HIGH_VALUE_TXN" and f["row_number"] == 1011 for f in flags)
    assert any(f["anomaly_type"] == "NEAR_REPORTING_THRESHOLD" and f["row_number"] == 1012 for f in flags)
    client.post("/anomaly/finish", json={"fileId": "f1"})


def test_velocity_is_found_across_batches():
    rows = make_txns(300, seed=1)
    burst = [dict(rows[0], transaction_id=f"B{k}", account_number="7777777777",
                  transaction_date=f"2025-06-01 10:0{3 * k}:00", amount=f"{1000 + k}.00") for k in range(3)]
    client.post("/anomaly/detect-batch", json={"fileId": "f2", "fileType": "BANK_TRANSACTIONS", "rows": rows + burst[:2]})
    client.post("/anomaly/detect-batch", json={"fileId": "f2", "fileType": "BANK_TRANSACTIONS", "rows": burst[2:]})
    flags = client.post("/anomaly/finish", json={"fileId": "f2"}).json()["flags"]
    assert any(f["anomaly_type"] == "TXN_VELOCITY" for f in flags)
    assert client.post("/anomaly/finish", json={"fileId": "f2"}).json()["count"] == 0  # session freed


def test_bad_file_type_is_422():
    r = client.post("/anomaly/detect-batch", json={"fileId": "f3", "fileType": "NOPE", "rows": make_txns(5)})
    assert r.status_code == 422


def test_file_level_rejection_floor():
    r = client.post("/anomaly/file-level", json={"features": {"file_type": "PAYMENTS", "total_records": 100,
                                                              "rejected_records": 40}})
    assert any(f["anomaly_type"] == "REJECTION_RATE_HIGH" for f in r.json()["flags"])


def test_single_row_contract_still_works():
    row = make_txns(1)[0]
    r = client.post("/anomaly/detect", json={"fileId": "f4", "features": row})
    body = r.json()
    assert r.status_code == 200 and {"isAnomaly", "score", "reason", "explanation"} <= set(body)


def test_coverage_lists_workbook_ids():
    ids = [c["workbook_id"] for c in client.get("/anomaly/coverage").json()]
    assert "T-N14" in ids and "R-N12" in ids


def test_committed_models_match_the_code():
    """If models are committed, each must load and use the feature columns this code produces."""
    import os
    import pandas as pd
    from app.services import anomaly_engine as engine
    from app.services.anomaly_detector import MODEL_DIR
    for ft in ("BANK_TXNS", "PAYMENTS", "ACCOUNTS"):
        ref = engine.load_reference(ft, MODEL_DIR)
        if ref is None:
            continue  # not committed or not trained yet
        row = {c: "" for c in engine.COLUMNS[ft]}
        cols = list(engine.make_features(engine.prepare(pd.DataFrame([row]), ft), ft).columns)
        assert cols == ref["feature_cols"], f"{ft}: model features differ from code features"

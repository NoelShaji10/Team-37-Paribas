"""AI normalisation and suggested-fix tests. Run from ml-service/:  python -m pytest -q tests"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_tier_a_normalises_and_logs_changes():
    rows = [{"payment_id": " P1 ", "account_number": "12 34", "payment_date": "2025-01-02",
             "payment_method": "Bank Transfer", "amount": "100.123456", "currency": " i n r ",
             "payment_status": "Completed", "ifsc_code": "sbin0001111"}]
    r = client.post("/normalize/batch", json={"fileId": "n1", "fileType": "PAYMENTS", "rows": rows,
                                              "rowNumbers": [2]}).json()
    row = r["rows"][0]
    assert row["currency"] == "INR" and row["payment_method"] == "bank transfer"
    assert row["amount"] == "100.1235" and row["ifsc_code"] == "SBIN0001111" and row["account_number"] == "1234"
    assert {c["rule"] for c in r["changes"]} >= {"ACCT-1", "PAY-1", "PAY-7", "PAY-4"}
    assert r["issues"] == []


def test_master_data_issues_for_unknown_currency_and_enum():
    rows = [{"payment_id": "P2", "account_number": "1", "payment_date": "2025-01-03", "payment_method": "wire",
             "amount": "5", "currency": "USX", "payment_status": "done", "ifsc_code": ""}]
    issues = client.post("/normalize/batch", json={"fileId": "n2", "fileType": "PAYMENTS", "rows": rows}).json()["issues"]
    assert {(i["columnName"], i["errorType"]) for i in issues} == {("currency", "INVALID_CURRENCY"),
                                                                  ("payment_status", "INVALID_ENUM")}


def test_bank_transfer_without_ifsc_is_reported():
    rows = [{"payment_id": "P3", "account_number": "1", "payment_date": "2025-01-03",
             "payment_method": "Bank Transfer", "amount": "5", "currency": "INR", "payment_status": "completed",
             "ifsc_code": ""}]
    issues = client.post("/normalize/batch", json={"fileId": "n6", "fileType": "PAYMENTS", "rows": rows}).json()["issues"]
    assert [(i["columnName"], i["errorType"], i["ruleRef"]) for i in issues] == [("ifsc_code", "MISSING_IFSC", "PAY-8")]


def test_suggestions_have_value_confidence_and_explanation():
    issues = [{"rowNumber": 2, "columnName": "currency", "cellValue": "USX"},
              {"rowNumber": 3, "columnName": "ifsc_code", "cellValue": "PNB0006666"},
              {"rowNumber": 4, "columnName": "transaction_type", "cellValue": "Debitt"},
              {"rowNumber": 5, "columnName": "transaction_date", "cellValue": "2026-12-15"}]
    out = client.post("/normalize/suggest", json={"fileId": "n3", "fileType": "BANK_TXNS", "issues": issues}).json()
    by_col = {s["columnName"]: s for s in out["suggestions"]}
    assert by_col["currency"]["suggestion"] == "USD" and 0 < by_col["currency"]["confidence"] < 1
    assert by_col["ifsc_code"]["suggestion"] == "PUNB0006666"
    assert by_col["transaction_type"]["suggestion"] == "debit"
    assert by_col["transaction_date"]["suggestion"] is None  # future date: no guessing
    assert all(s["explanation"] for s in out["suggestions"])


def test_missing_ifsc_uses_same_account_context():
    rows = [{"payment_id": "A", "account_number": "777", "payment_date": "2025-01-01", "payment_method": "wire",
             "amount": "1", "currency": "INR", "payment_status": "completed", "ifsc_code": "HDFC0001111"},
            {"payment_id": "B", "account_number": "777", "payment_date": "2025-01-02",
             "payment_method": "bank transfer", "amount": "2", "currency": "INR", "payment_status": "completed",
             "ifsc_code": ""}]
    client.post("/normalize/batch", json={"fileId": "n4", "fileType": "PAYMENTS", "rows": rows})
    out = client.post("/normalize/suggest", json={"fileId": "n4", "fileType": "PAYMENTS", "issues": [
        {"rowNumber": 3, "columnName": "ifsc_code", "cellValue": "", "row": rows[1]}]}).json()["suggestions"][0]
    assert out["suggestion"] == "HDFC0001111" and out["source"] == "CONTEXT"


def test_learning_raises_confidence():
    before = client.post("/suggestions/suggest-fix", json={"fieldName": "currency", "originalValue": "EUX"}).json()
    for _ in range(3):
        client.post("/normalize/feedback", json={"field": "currency", "original": "EUX", "corrected": "EUR",
                                                 "accepted": True, "suggested": before["suggestedValue"]})
    after = client.post("/suggestions/suggest-fix", json={"fieldName": "currency", "originalValue": "EUX"}).json()
    assert after["suggestedValue"] == "EUR" and after["confidence"] > before["confidence"]


def test_more_than_half_rule_proposal():
    issues = [{"rowNumber": i, "columnName": "transaction_date", "cellValue": "25/08/2025"} for i in range(8)]
    issues.append({"rowNumber": 99, "columnName": "transaction_date", "cellValue": "garbage"})
    client.post("/normalize/suggest", json={"fileId": "n5", "fileType": "BANK_TXNS", "issues": issues})
    proposals = client.post("/normalize/finish", json={"fileId": "n5"}).json()["proposals"]
    assert proposals and proposals[0]["fixKind"] == "DATE_FORMAT:%d/%m/%Y" and proposals[0]["rows"] == 8


def test_reference_counts():
    info = client.get("/normalize/reference").json()
    assert info["currencies"] == 180 and info["ifsc_codes"] > 100

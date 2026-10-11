# Time-anomaly demo (NIGHT_TRANSFER_RETAIL, workbook T-N12 / AI temporal anomaly)

Rule: flag a transaction only when **all** hold: night window 00:00 to 04:59, retail account (savings or checking),
debit, outgoing transfer channel (RTGS payment, Fund transfer, IMPS transfer, UPI transfer), amount at least 2,00,000.

| File | What |
|---|---|
| `accounts_timedemo.csv` | 30 accounts: 12 savings, 6 checking (retail), 6 current, 6 business. Balances 12 to 30 lakh |
| `bank_txns_timedemo.csv` | 200 transactions: 8 should be flagged, 8 tricky look-alikes that must not be, 184 ordinary daytime rows |
| `timedemo_truth.csv` | Expected result per transaction with the reason (`csv_line` matches the row numbers in the UI) |

The 8 look-alikes each break exactly one condition: daytime, 05:00 exactly, business account, current account,
credit, non-transfer description, below 2 lakh, incoming NEFT.

Load the accounts first (the rule needs the account type), then the transactions:

    ./scripts/reset_db.sh
    cp demo/time_anomaly/accounts_timedemo.csv backend/incoming/
    # wait until it shows Completed in the UI
    cp demo/time_anomaly/bank_txns_timedemo.csv backend/incoming/

Expected: exactly 8 NIGHT_TRANSFER_RETAIL flags, the rows marked YES in `timedemo_truth.csv`.

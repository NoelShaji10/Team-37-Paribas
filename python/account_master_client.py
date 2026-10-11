"""
Account Master client for rule_validation.py.

Fetches account_number + account_status from the backend
(POST /api/account-master/lookup, backed by the PostgreSQL "Account" table)
and returns a DataFrame with the same columns the Account Master CSV had, so
validate_transactions() / validate_payments() keep working unchanged.

    from account_master_client import fetch_account_master
    accounts = fetch_account_master(all_account_numbers)

Config (environment variables, all optional):
    ACCOUNT_MASTER_URL       default http://localhost:5000/api/account-master/lookup
    ACCOUNT_MASTER_API_KEY   sent as X-API-Key if set (must match backend .env)
    ACCOUNT_MASTER_BATCH     account numbers per request, default 2000 (max 5000)
    ACCOUNT_MASTER_TIMEOUT   seconds per request, default 30

Only standard library + pandas.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Iterable

import pandas as pd

DEFAULT_URL = "http://localhost:5000/api/account-master/lookup"


class AccountMasterError(RuntimeError):
    """The lookup failed and the result would be incomplete. Do not treat
    accounts as missing when this is raised."""


def _post(url: str, payload: dict, api_key: str | None, timeout: float) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("X-API-Key", api_key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_account_master(
    account_numbers: Iterable[str],
    url: str | None = None,
    api_key: str | None = None,
    batch_size: int | None = None,
    timeout: float | None = None,
    retries: int = 3,
) -> pd.DataFrame:
    """Return DataFrame[account_number, account_status] for the accounts that
    exist in the Account Master. Numbers not returned are missing.

    Raises AccountMasterError if any batch fails after retries, so a backend
    outage is never mistaken for "account not in master".
    """
    url = url or os.getenv("ACCOUNT_MASTER_URL", DEFAULT_URL)
    api_key = api_key if api_key is not None else os.getenv("ACCOUNT_MASTER_API_KEY") or None
    batch_size = min(int(batch_size or os.getenv("ACCOUNT_MASTER_BATCH", 2000)), 5000)
    timeout = float(timeout or os.getenv("ACCOUNT_MASTER_TIMEOUT", 30))

    # Trim, drop blanks/NaN, de-duplicate (upper-case, as rule_validation.py does).
    unique = sorted({
        str(v).strip().upper()
        for v in account_numbers
        if v is not None and str(v).strip() and str(v).strip().lower() != "nan"
    })

    rows: list[dict] = []
    for start in range(0, len(unique), batch_size):
        batch = unique[start:start + batch_size]

        for attempt in range(1, retries + 1):
            try:
                data = _post(url, {"account_numbers": batch}, api_key, timeout)
                rows.extend(data.get("accounts", []))
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")
                # 503 = database temporarily unavailable: retry. 4xx = our request is wrong: stop.
                if e.code == 503 and attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                raise AccountMasterError(f"Account Master HTTP {e.code}: {detail}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                raise AccountMasterError(f"Account Master unreachable at {url}: {e}") from e

    df = pd.DataFrame(rows, columns=["account_number", "account_status"]).astype(str)
    return df.drop_duplicates(subset=["account_number"]).reset_index(drop=True)


if __name__ == "__main__":  # quick manual check: python account_master_client.py 1234567890 ...
    import sys
    print(fetch_account_master(sys.argv[1:]).to_string(index=False))

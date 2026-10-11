import { Router, Request, Response } from 'express';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Account Master lookup for the Python validation layer (rule_validation.py).
 *
 *   POST /api/account-master/lookup
 *   Body:     { "account_numbers": ["1234567890", ...] }
 *   Response: { "accounts": [{ "account_number": "...", "account_status": "active" }],
 *               "meta": { requested, unique, found, missing } }
 *
 * Source table: "Account" (Prisma model Account)
 *   account_number -> "accountNumber" (primary key)
 *   account_status -> "accountStatus"
 *
 * Only matching accounts are returned; anything not returned is missing
 * from the Account Master. The query is parameterized by Prisma and only
 * selects the two required columns.
 */

const router = Router();

/** Max account numbers per request (after trimming, before de-duplication). */
const MAX_BATCH = Number(process.env.ACCOUNT_LOOKUP_MAX_BATCH ?? 5000);

/**
 * Optional shared key. When ACCOUNT_MASTER_API_KEY is set in backend/.env,
 * callers must send header  X-API-Key: <value>.  Unset = no auth (local dev).
 */
const API_KEY = process.env.ACCOUNT_MASTER_API_KEY?.trim() || null;

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.status(status).json({ error: { code, message } });
}

router.post('/lookup', async (req: Request, res: Response) => {
  /* ---------- auth ---------- */
  if (API_KEY && req.get('x-api-key') !== API_KEY) {
    sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid X-API-Key header');
    return;
  }

  /* ---------- validate body ---------- */
  const raw = req.body?.account_numbers;

  if (!Array.isArray(raw)) {
    sendError(
      res,
      400,
      'INVALID_BODY',
      'Body must be JSON: { "account_numbers": ["1234567890", ...] }'
    );
    return;
  }

  if (raw.length > MAX_BATCH) {
    sendError(
      res,
      413,
      'BATCH_TOO_LARGE',
      `At most ${MAX_BATCH} account numbers per request (got ${raw.length}). Split into smaller batches.`
    );
    return;
  }

  const invalid = raw.findIndex(
    (v: unknown) => typeof v !== 'string' && typeof v !== 'number'
  );
  if (invalid !== -1) {
    sendError(
      res,
      400,
      'INVALID_ACCOUNT_NUMBER',
      `account_numbers[${invalid}] must be a string (got ${raw[invalid] === null ? 'null' : typeof raw[invalid]})`
    );
    return;
  }

  /* ---------- normalize + de-duplicate ---------- */
  // Trim, drop empties, de-duplicate. Match both as-given and upper-case,
  // because rule_validation.py upper-cases account numbers.
  const unique = [...new Set(raw.map((v: string | number) => String(v).trim()).filter(Boolean))];
  const candidates = [...new Set(unique.flatMap((v) => [v, v.toUpperCase()]))];

  if (unique.length === 0) {
    res.json({ accounts: [], meta: { requested: raw.length, unique: 0, found: 0, missing: 0 } });
    return;
  }

  /* ---------- query (parameterized, 2 columns only) ---------- */
  try {
    const rows = await prisma.account.findMany({
      where: { accountNumber: { in: candidates } },
      select: { accountNumber: true, accountStatus: true },
    });

    const accounts = rows.map((r: { accountNumber: string; accountStatus: string }) => ({
      account_number: r.accountNumber,
      account_status: String(r.accountStatus ?? '').trim().toLowerCase(),
    }));

    const foundUpper = new Set(accounts.map((a: { account_number: string }) => a.account_number.toUpperCase()));
    const missing = unique.filter((v) => !foundUpper.has(v.toUpperCase())).length;

    logger.debug(
      `[AccountMaster] lookup | requested=${raw.length} | unique=${unique.length} | ` +
        `found=${accounts.length} | missing=${missing}`
    );

    res.json({
      accounts,
      meta: {
        requested: raw.length,
        unique: unique.length,
        found: accounts.length,
        missing,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[AccountMaster] lookup failed: ${message}`, error);
    sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Account Master lookup failed. Retry later.');
  }
});

export default router;

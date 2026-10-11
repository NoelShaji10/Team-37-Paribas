import fs from 'fs';

import { logger } from '../utils/logger';
import { INCOMING_DIR } from '../utils/fileUtils';

/**
 * Accounts before transactions, automatically.
 *
 * Bank transactions and payments must reference accounts that already exist (TXN-2 / PAY-2).
 * When several files are dropped into incoming/ at once, or the transactions arrive first,
 * a transactions file could be checked while its accounts are still being loaded, and every
 * row would be rejected as "account not in master". This gate holds a transactions or payments
 * file back (it stays QUEUED on the dashboard) until:
 *   1. no other file is still being ingested (its type may not be known yet), and
 *   2. no accounts file accepted by this backend is still queued or processing, and
 *   3. no accounts_*.csv is sitting in incoming/ (e.g. still being copied over a slow network
 *      share, so it has not been picked up yet; finished files are moved out of incoming/).
 * Tracking is in memory, so a record left over from an earlier, interrupted run never blocks.
 * It waits outside the worker pool, so waiting files never block an accounts file from starting.
 */

const LINKED_TYPES = new Set(['BANK_TRANSACTIONS', 'PAYMENTS']);
const POLL_MS = 1000;
const MAX_WAIT_MS = Number(process.env.ACCOUNTS_MAX_WAIT_MS ?? 15 * 60 * 1000);

let ingestionsInFlight = 0;
const pendingAccountsFiles = new Set<string>();

/** An accounts file was accepted and queued. */
export function registerAccountsFile(fileId: string): void {
  pendingAccountsFiles.add(fileId);
}

/** Called by the processor when any file finishes (completed or failed). */
export function fileFinished(fileId: string): void {
  pendingAccountsFiles.delete(fileId);
}

/** Call around ingestionService.ingestFile so the gate knows a file is still being registered. */
export function beginIngestion(): void {
  ingestionsInFlight++;
}

export function endIngestion(): void {
  ingestionsInFlight = Math.max(0, ingestionsInFlight - 1);
}

function accountsFileInIncoming(): boolean {
  try {
    return fs.readdirSync(INCOMING_DIR).some((name) => /^accounts_.*\.csv$/i.test(name));
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForAccountsFiles(fileType: string, fileName: string): Promise<void> {
  if (!LINKED_TYPES.has(fileType)) return;

  const started = Date.now();
  let announced = false;

  while (Date.now() - started < MAX_WAIT_MS) {
    // Another file still being registered may turn out to be an accounts file
    if (ingestionsInFlight === 0 && pendingAccountsFiles.size === 0 && !accountsFileInIncoming()) {
      if (announced) {
        logger.info(`[DependencyGate] Accounts loaded; starting ${fileName}`);
      }
      return;
    }

    if (!announced) {
      logger.info(`[DependencyGate] ${fileName} waits until the accounts files have finished loading`);
      announced = true;
    }
    await sleep(POLL_MS);
  }

  logger.warn(`[DependencyGate] Waited ${MAX_WAIT_MS / 1000}s for accounts; processing ${fileName} anyway`);
}

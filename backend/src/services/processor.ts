import fs from 'fs';
import csv from 'csv-parser';

import { Prisma, FileType } from '@prisma/client';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { emitFileProgress } from '../sockets/socket';
import { validatorService } from './validator';
import { loaderService } from './loader';
import { archiveFile, type ArchiveStage } from '../utils/fileUtils';
import {
  mlClient,
  type AnomalyFlag,
  type FileAnomalyFeatures,
} from './mlClient';

/* =========================================================
   CONFIG
   ========================================================= */

/**
 * What to do when the ML service is down or errors:
 *
 *   review (default) -> keep loading valid rows, finish the file as
 *                       NEEDS_REVIEW with the ML error in errorMessage
 *   fail             -> fail the whole file (original behaviour)
 */
const ML_FAIL_MODE =
  (process.env.ML_FAIL_MODE ?? 'review').toLowerCase() === 'fail'
    ? 'fail'
    : 'review';

const ML_SERVICE_URL = (
  process.env.ML_SERVICE_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

/** Timeout for the optional suggestion call (ms). */
const ML_SUGGEST_TIMEOUT_MS = Number(
  process.env.ML_SUGGEST_TIMEOUT_MS ?? 15000
);

/** File types whose rows must reference an existing Account. */
const ACCOUNT_LINKED_TYPES = new Set<string>([
  'BANK_TRANSACTIONS',
  'PAYMENTS',
]);

/**
 * Files currently being processed by this backend.
 * Sent to /prediction/predict-time as `concurrency`.
 * (Kept here instead of importing fileWorker to avoid a circular import.)
 */
let activeFiles = 0;

/* =========================================================
   TYPES
   ========================================================= */

type CsvRecord = Record<string, string>;

interface ProcessingStats {
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  anomalyCount: number;
  /** Data rows in the file (counted up front), used for an accurate progress %. */
  totalRows: number;
  /** Set once any ML call fails in 'review' mode; later ML calls are skipped. */
  mlError: string | null;
}

interface SuggestionItem {
  rowNumber?: number | null;
  columnName?: string;
  suggestion?: string | null;
  confidence?: number | null;
  explanation?: string | null;
  source?: string | null;
}

/* =========================================================
   PROCESSOR
   ========================================================= */

export class ProcessorService {
  private readonly batchSize = 500;

  /** Last 10% step logged per file, so large files print ~10 progress lines. */
  private readonly loggedStep = new Map<string, number>();

  /** Files for which the suggestion service already failed (warn once, then skip). */
  private readonly suggestionsDown = new Set<string>();

  /* =======================================================
     MAIN FILE PROCESSOR
     ======================================================= */

  async processFile(
    fileId: string,
    filePath: string,
    _totalRows?: number
  ): Promise<void> {
    const startedAt = new Date();
    activeFiles++;

    const stats: ProcessingStats = {
      processedRows: 0,
      validRows: 0,
      rejectedRows: 0,
      anomalyCount: 0,
      totalRows: 0,
      mlError: null,
    };

    logger.info(
      `[ProcessorService] Starting processing | file=${fileId} | activeFiles=${activeFiles}`
    );

    try {
      /* ---------------------------------------------------
         File + metadata
         --------------------------------------------------- */

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileRecord = await prisma.processingFile.findUnique({
        where: { id: fileId },
        select: { fileType: true, predictedDurationMs: true },
      });

      if (!fileRecord) {
        throw new Error(`Processing file not found: ${fileId}`);
      }

      const fileType = fileRecord.fileType;
      const fileSizeBytes = (await fs.promises.stat(filePath)).size;
      const dataRows = await this.countDataRows(filePath);
      stats.totalRows = dataRows;

      logger.info(
        `[ProcessorService] File metadata | file=${fileId} | type=${fileType} | ` +
          `size=${fileSizeBytes} | rows=${dataRows}`
      );

      /* ---------------------------------------------------
         ML: predicted processing time (never blocks the file)
         --------------------------------------------------- */

      const predictedDurationMs = await this.predictDurationMs(
        fileId,
        fileType,
        dataRows,
        fileSizeBytes
      );

      /* ---------------------------------------------------
         Mark PROCESSING
         --------------------------------------------------- */

      await prisma.processingFile.update({
        where: { id: fileId },
        data: {
          status: 'PROCESSING',
          startedAt,
          progress: 0,
          totalRows: dataRows,
          processedRows: 0,
          successfulRows: 0,
          failedRows: 0,
          errorMessage: null,
          ...(predictedDurationMs != null ? { predictedDurationMs } : {}),
        },
      });

      emitFileProgress(fileId, 0, 'PROCESSING', {
        processedRows: 0,
        validRows: 0,
        rejectedRows: 0,
        anomalyCount: 0,
        totalRows: dataRows,
        predictedDurationMs:
          predictedDurationMs ?? fileRecord.predictedDurationMs ?? null,
      });

      /* ---------------------------------------------------
         Stream + process batches (Layer 1, Layer 2, load)
         --------------------------------------------------- */

      await this.streamAndProcessFile(
        fileId,
        fileType,
        filePath,
        fileSizeBytes,
        stats
      );

      logger.info(
        `[ProcessorService] CSV stream complete | file=${fileId} | ` +
          `processed=${stats.processedRows} | valid=${stats.validRows} | ` +
          `rejected=${stats.rejectedRows} | batchAnomalies=${stats.anomalyCount}`
      );

      /* ---------------------------------------------------
         ML: file-wide checks (velocity, near-duplicates,
         rate jumps, stale rates ...). Also closes the
         per-file session in the Python service.
         --------------------------------------------------- */

      const finishResult = await this.runMl(stats, 'anomaly/finish', () =>
        mlClient.finishAnomalyFile(fileId)
      );

      if (finishResult) {
        await this.saveAnomalyFlags(fileId, finishResult.flags, stats);
      }

      /* ---------------------------------------------------
         Duration
         --------------------------------------------------- */

      const completedAt = new Date();
      const actualDurationMs = completedAt.getTime() - startedAt.getTime();

      /* ---------------------------------------------------
         ML: file-level anomalies (size, record count,
         rejection rate, processing time vs history)
         --------------------------------------------------- */

      const previousFiles = await prisma.processingFile.findMany({
        where: {
          id: { not: fileId },
          fileType,
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        take: 50,
        select: {
          fileType: true,
          sizeBytes: true,
          totalRows: true,
          failedRows: true,
          actualDurationMs: true,
          predictedDurationMs: true,
        },
      });

      const history: FileAnomalyFeatures[] = previousFiles.map((p) => ({
        file_type: p.fileType,
        size_bytes: Number(p.sizeBytes),
        total_records: p.totalRows,
        rejected_records: p.failedRows,
        actual_seconds:
          p.actualDurationMs != null ? p.actualDurationMs / 1000 : undefined,
        predicted_seconds:
          p.predictedDurationMs != null
            ? p.predictedDurationMs / 1000
            : undefined,
      }));

      const effectivePredictedMs =
        predictedDurationMs ?? fileRecord.predictedDurationMs;

      const currentFileFeatures: FileAnomalyFeatures = {
        file_type: fileType,
        size_bytes: fileSizeBytes,
        total_records: stats.processedRows,
        rejected_records: stats.rejectedRows,
        actual_seconds: actualDurationMs / 1000,
        predicted_seconds:
          effectivePredictedMs != null
            ? effectivePredictedMs / 1000
            : undefined,
      };

      const fileLevelResult = await this.runMl(
        stats,
        'anomaly/file-level',
        () => mlClient.detectFileAnomalies(currentFileFeatures, history)
      );

      if (fileLevelResult) {
        await this.saveAnomalyFlags(fileId, fileLevelResult.flags, stats);
      }

      /* ---------------------------------------------------
         Final status
         Layer 2 anomalies never reject a file. Layer 1
         rejections or an ML outage send it to review.
         --------------------------------------------------- */

      const finalStatus =
        stats.rejectedRows > 0 || stats.mlError
          ? 'NEEDS_REVIEW'
          : 'COMPLETED';

      const errorMessage = stats.mlError
        ? `ML anomaly detection unavailable (${stats.mlError}). ` +
          `Valid rows were loaded without anomaly checks.`
        : null;

      await prisma.processingFile.update({
        where: { id: fileId },
        data: {
          status: finalStatus,
          progress: 100,
          recordCount: stats.processedRows,
          totalRows: stats.processedRows,
          processedRows: stats.processedRows,
          successfulRows: stats.validRows,
          failedRows: stats.rejectedRows,
          completedAt,
          actualDurationMs,
          errorMessage,
        },
      });

      emitFileProgress(fileId, 100, finalStatus, {
        processedRows: stats.processedRows,
        validRows: stats.validRows,
        rejectedRows: stats.rejectedRows,
        anomalyCount: stats.anomalyCount,
        actualDurationMs,
        predictedDurationMs: effectivePredictedMs ?? null,
        mlError: stats.mlError,
      });

      logger.info(
        `[ProcessorService] Completed | file=${fileId} | status=${finalStatus} | ` +
          `processed=${stats.processedRows} | valid=${stats.validRows} | ` +
          `rejected=${stats.rejectedRows} | anomalies=${stats.anomalyCount} | ` +
          `durationMs=${actualDurationMs} | predictedMs=${effectivePredictedMs ?? 'n/a'}` +
          (stats.mlError ? ` | mlError=${stats.mlError}` : '')
      );

      /* ---------------------------------------------------
         Move the source file: incoming/ (or uploads/) -> processed/
         Done last, so a file only leaves incoming/ once its
         result is safely in the database.
         --------------------------------------------------- */

      await this.archiveSource(fileId, filePath, 'processed');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';

      const completedAt = new Date();
      const actualDurationMs = completedAt.getTime() - startedAt.getTime();

      logger.error(
        `[ProcessorService] FAILED | file=${fileId} | error=${message}`,
        error
      );

      // Best-effort: close the per-file ML session so Python frees memory.
      if (!stats.mlError) {
        try {
          await mlClient.finishAnomalyFile(fileId);
        } catch (mlCleanupError) {
          logger.warn(
            `[ProcessorService] ML cleanup failed | file=${fileId}`,
            mlCleanupError
          );
        }
      }

      try {
        await prisma.processingFile.update({
          where: { id: fileId },
          data: {
            status: 'FAILED',
            completedAt,
            actualDurationMs,
            processedRows: stats.processedRows,
            successfulRows: stats.validRows,
            failedRows: stats.rejectedRows,
            errorMessage: message,
          },
        });
      } catch (databaseError) {
        logger.error(
          `[ProcessorService] Failed updating FAILED status | file=${fileId}`,
          databaseError
        );
      }

      emitFileProgress(fileId, 0, 'FAILED', { error: message });

      // Failed files go to quarantine/ so they can be inspected and re-dropped.
      await this.archiveSource(fileId, filePath, 'quarantine');

      throw error;
    } finally {
      activeFiles = Math.max(0, activeFiles - 1);
    }
  }

  /* =======================================================
     STREAM CSV
     ======================================================= */

  private streamAndProcessFile(
    fileId: string,
    fileType: FileType,
    filePath: string,
    fileSizeBytes: number,
    stats: ProcessingStats
  ): Promise<ProcessingStats> {
    return new Promise((resolve, reject) => {
      let batch: CsvRecord[] = [];
      let settled = false;

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      /**
       * Batches for one file run strictly in order: the Python
       * anomaly service keeps one stateful detector per file.
       */
      let processing: Promise<void> = Promise.resolve();

      const fileStream = fs.createReadStream(filePath);

      const csvStream = fileStream.pipe(
        csv({
          mapHeaders: ({ header }) =>
            header
              .replace(/^﻿/, '') // strip UTF-8 BOM from first header
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_'),
        })
      );

      csvStream.on('data', (record: CsvRecord) => {
        batch.push(record);

        if (batch.length < this.batchSize) return;

        csvStream.pause();

        const currentBatch = batch;
        batch = [];

        processing = processing
          .then(() =>
            this.processBatch(fileId, fileType, currentBatch, stats)
          )
          .then(() =>
            this.updateProgress(
              fileId,
              fileStream.bytesRead,
              fileSizeBytes,
              stats
            )
          )
          .then(() => {
            csvStream.resume();
          })
          .catch((err) => {
            csvStream.destroy();
            fileStream.destroy();
            fail(err);
          });
      });

      csvStream.on('end', () => {
        processing
          .then(async () => {
            if (settled) return;

            if (batch.length > 0) {
              await this.processBatch(fileId, fileType, batch, stats);
              batch = [];
            }

            await this.updateProgress(
              fileId,
              fileSizeBytes,
              fileSizeBytes,
              stats
            );

            settled = true;
            resolve(stats);
          })
          .catch(fail);
      });

      csvStream.on('error', fail);
      fileStream.on('error', fail);
    });
  }

  /* =======================================================
     PROCESS ONE BATCH
     ======================================================= */

  private async processBatch(
    fileId: string,
    fileType: FileType,
    records: CsvRecord[],
    stats: ProcessingStats
  ): Promise<void> {
    const validRecords: Array<Record<string, unknown>> = [];

    /** Parallel to validRecords: the real CSV row number of each. */
    const validRowNumbers: number[] = [];

    const faultLogs: Prisma.FaultLogCreateManyInput[] = [];

    logger.debug(
      `[ProcessorService] Processing batch | file=${fileId} | type=${fileType} | ` +
        `batchRows=${records.length}`
    );

    /* -----------------------------------------------------
       LAYER 1: rule validation
       ----------------------------------------------------- */

    for (const record of records) {
      stats.processedRows++;

      // Line 1 is the header, so the first record is CSV row 2.
      const rowNumber = stats.processedRows + 1;

      const validation = await validatorService.validateRecord(record);

      if (!validation.isValid) {
        stats.rejectedRows++;

        logger.debug(
          `[ProcessorService] Validation rejected | file=${fileId} | ` +
            `row=${rowNumber} | errors=${validation.errors.join(', ')}`
        );

        for (const issue of validation.issues) {
          faultLogs.push({
            fileId,
            rowNumber,
            columnName: issue.columnName,
            cellValue: issue.cellValue ?? null,
            errorMessage: issue.errorMessage,
            errorType: issue.errorType,
            rawRowData: record as Prisma.InputJsonValue,
            status: 'PENDING',
          });
        }

        continue; // invalid rows never reach Layer 2
      }

      stats.validRows++;
      validRecords.push(record);
      validRowNumbers.push(rowNumber);
    }

    /* -----------------------------------------------------
       MASTER-DATA CHECK: transactions / payments must point
       at an existing Account (FK in schema.prisma). Without
       this, one unknown account fails the whole batch.
       ----------------------------------------------------- */

    let knownAccounts: Record<string, { account_type: string; balance: string; currency: string }> = {};
    if (ACCOUNT_LINKED_TYPES.has(fileType) && validRecords.length > 0) {
      knownAccounts = await this.rejectUnknownAccounts(
        fileId,
        validRecords,
        validRowNumbers,
        faultLogs,
        stats
      );
    }

    logger.debug(
      `[ProcessorService] Batch validated | file=${fileId} | ` +
        `valid=${validRecords.length} | invalid=${records.length - validRecords.length}`
    );

    /* -----------------------------------------------------
       Save Layer 1 faults, with AI fix suggestions attached
       ----------------------------------------------------- */

    if (faultLogs.length > 0) {
      await this.attachSuggestions(fileId, fileType, faultLogs);

      await prisma.faultLog.createMany({ data: faultLogs });

      logger.debug(
        `[ProcessorService] Saved ${faultLogs.length} validation faults | file=${fileId}`
      );
    }

    if (validRecords.length === 0) {
      logger.debug(
        `[ProcessorService] No valid rows for Layer 2 | file=${fileId}`
      );
      return;
    }

    /* -----------------------------------------------------
       LAYER 2: ML anomaly detection (before loading, so a
       DB problem can never hide rows from the ML service)
       ----------------------------------------------------- */

    const anomalyResult = await this.runMl(stats, 'anomaly/detect-batch', () =>
      mlClient.detectAnomalyBatch(
        fileId,
        fileType,
        validRecords,
        validRowNumbers,
        knownAccounts
      )
    );

    if (anomalyResult) {
      logger.debug(
        `[ProcessorService] ML batch response | file=${fileId} | ` +
          `rows=${validRowNumbers[0]}-${validRowNumbers[validRowNumbers.length - 1]} | ` +
          `flags=${anomalyResult.flags.length}`
      );

      await this.saveAnomalyFlags(fileId, anomalyResult.flags, stats);
    }

    /* -----------------------------------------------------
       LOAD valid rows into the domain tables
       ----------------------------------------------------- */

    await this.loadWithFallback(fileId, validRecords, validRowNumbers, stats);
  }

  /* =======================================================
     MASTER DATA: UNKNOWN ACCOUNTS -> FAULT LOG
     ======================================================= */

  private async rejectUnknownAccounts(
    fileId: string,
    validRecords: Array<Record<string, unknown>>,
    validRowNumbers: number[],
    faultLogs: Prisma.FaultLogCreateManyInput[],
    stats: ProcessingStats
  ): Promise<Record<string, { account_type: string; balance: string; currency: string }>> {
    const accountOf = (r: Record<string, unknown>) =>
      String(r.account_number ?? '').trim();

    const wanted = [...new Set(validRecords.map(accountOf).filter(Boolean))];

    // One read of the Account table: existence for this check, plus type, balance and
    // currency for Layer 2 (T-N11 overdraft, T-N12 night transfer from a retail account)
    const found = (await prisma.account.findMany({
      where: { accountNumber: { in: wanted } },
      select: { accountNumber: true, accountType: true, balance: true, currency: true },
    })) as Array<{ accountNumber: string; accountType: string; balance: unknown; currency: string }>;
    const existing = new Set(found.map((a) => a.accountNumber));
    const known: Record<string, { account_type: string; balance: string; currency: string }> = {};
    for (const a of found) {
      known[a.accountNumber] = { account_type: a.accountType, balance: String(a.balance), currency: a.currency };
    }

    let moved = 0;

    // Walk backwards so splice() keeps the two arrays aligned.
    for (let i = validRecords.length - 1; i >= 0; i--) {
      const account = accountOf(validRecords[i]);
      if (account && existing.has(account)) continue;

      faultLogs.push({
        fileId,
        rowNumber: validRowNumbers[i],
        columnName: 'account_number',
        cellValue: account || null,
        errorMessage: account
          ? `Account ${account} does not exist in master data. Load the accounts file first.`
          : 'account_number is empty',
        errorType: 'ACCOUNT_NOT_FOUND',
        rawRowData: validRecords[i] as Prisma.InputJsonValue,
        status: 'PENDING',
      });

      validRecords.splice(i, 1);
      validRowNumbers.splice(i, 1);
      stats.validRows--;
      stats.rejectedRows++;
      moved++;
    }

    if (moved > 0) {
      logger.warn(
        `[ProcessorService] ${moved} rows reference unknown accounts | file=${fileId}`
      );
    }

    return known;
  }

  /* =======================================================
     LOAD WITH PER-ROW FALLBACK
     ======================================================= */

  /**
   * Fast path: one createMany for the batch.
   * If that fails (bad date, value too long, FK ...), retry row by row
   * so only the bad rows go to the Resolution Centre instead of the
   * whole file failing. If *every* row fails, the problem is systemic
   * (DB down, schema mismatch), so the original error is re-thrown.
   */
  private async loadWithFallback(
    fileId: string,
    validRecords: Array<Record<string, unknown>>,
    validRowNumbers: number[],
    stats: ProcessingStats
  ): Promise<void> {
    try {
      await loaderService.loadValidRecords(fileId, validRecords);
      logger.debug(
        `[ProcessorService] Batch load complete | file=${fileId} | rows=${validRecords.length}`
      );
      return;
    } catch (batchError) {
      const batchMessage =
        batchError instanceof Error ? batchError.message : String(batchError);

      logger.warn(
        `[ProcessorService] Batch load failed, retrying row by row | ` +
          `file=${fileId} | error=${batchMessage}`
      );

      if (validRecords.length === 1) {
        await this.recordLoadFailure(
          fileId,
          validRecords[0],
          validRowNumbers[0],
          batchMessage,
          stats
        );
        return;
      }

      let loaded = 0;
      const failures: Prisma.FaultLogCreateManyInput[] = [];

      for (let i = 0; i < validRecords.length; i++) {
        try {
          await loaderService.loadValidRecords(fileId, [validRecords[i]]);
          loaded++;
        } catch (rowError) {
          failures.push(
            this.loadFault(
              fileId,
              validRecords[i],
              validRowNumbers[i],
              rowError instanceof Error ? rowError.message : String(rowError)
            )
          );
        }
      }

      if (loaded === 0) {
        throw batchError; // systemic: let the file fail with the real reason
      }

      if (failures.length > 0) {
        await prisma.faultLog.createMany({ data: failures });
        stats.validRows -= failures.length;
        stats.rejectedRows += failures.length;
      }

      logger.info(
        `[ProcessorService] Row-by-row load | file=${fileId} | ` +
          `loaded=${loaded} | failed=${failures.length}`
      );
    }
  }

  private async recordLoadFailure(
    fileId: string,
    record: Record<string, unknown>,
    rowNumber: number,
    message: string,
    stats: ProcessingStats
  ): Promise<void> {
    await prisma.faultLog.create({
      data: this.loadFault(fileId, record, rowNumber, message),
    });
    stats.validRows--;
    stats.rejectedRows++;
  }

  private loadFault(
    fileId: string,
    record: Record<string, unknown>,
    rowNumber: number,
    message: string
  ): Prisma.FaultLogCreateManyInput {
    return {
      fileId,
      rowNumber,
      columnName: '_row',
      cellValue: null,
      errorMessage: `Could not be saved: ${message}`.slice(0, 2000),
      errorType: 'LOAD_ERROR',
      rawRowData: record as Prisma.InputJsonValue,
      status: 'PENDING',
    };
  }

  /* =======================================================
     ML: AI FIX SUGGESTIONS FOR FAULTS (optional)
     ======================================================= */

  /**
   * One /normalize/suggest call per batch. Fills aiSuggestion,
   * aiConfidence and aiExplanation, which the Resolution Centre shows.
   * Never throws: faults are saved even if the ML service is down.
   */
  private async attachSuggestions(
    fileId: string,
    fileType: FileType,
    faultLogs: Prisma.FaultLogCreateManyInput[]
  ): Promise<void> {
    if (this.suggestionsDown.has(fileId)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ML_SUGGEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${ML_SERVICE_URL}/normalize/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fileId,
          fileType,
          issues: faultLogs.map((f) => ({
            rowNumber: f.rowNumber,
            columnName: f.columnName,
            cellValue: f.cellValue ?? null,
            errorType: f.errorType ?? null,
            errorMessage: f.errorMessage,
            row: f.rawRowData ?? null,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as { suggestions?: SuggestionItem[] };
      const suggestions = body.suggestions ?? [];

      // The service returns one suggestion per issue, in the same order.
      let attached = 0;
      faultLogs.forEach((fault, i) => {
        const s = suggestions[i];
        if (!s) return;
        fault.aiSuggestion = s.suggestion ?? null;
        fault.aiConfidence =
          typeof s.confidence === 'number' ? s.confidence : null;
        fault.aiExplanation = s.explanation ?? null;
        if (s.suggestion != null) attached++;
      });

      logger.debug(
        `[ProcessorService] AI suggestions | file=${fileId} | ` +
          `faults=${faultLogs.length} | withFix=${attached}`
      );
    } catch (error) {
      this.suggestionsDown.add(fileId);
      logger.warn(
        `[ProcessorService] AI suggestions unavailable for the rest of this file | file=${fileId} | ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /* =======================================================
     ML: PREDICTED PROCESSING TIME (optional)
     ======================================================= */

  private async predictDurationMs(
    fileId: string,
    fileType: FileType,
    rowCount: number,
    sizeBytes: number
  ): Promise<number | null> {
    try {
      const seconds = await mlClient.predictProcessingTime(
        sizeBytes / 1e6,
        Math.max(rowCount, 1),
        fileType,
        sizeBytes,
        Math.max(activeFiles, 1)
      );

      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`Invalid prediction: ${seconds}`);
      }

      const ms = Math.round(seconds * 1000);

      logger.info(
        `[ProcessorService] Predicted duration | file=${fileId} | ` +
          `seconds=${seconds.toFixed(1)} | concurrency=${activeFiles}`
      );

      return ms;
    } catch (error) {
      logger.warn(
        `[ProcessorService] Duration prediction unavailable | file=${fileId}`,
        error
      );
      return null;
    }
  }

  /* =======================================================
     ML CALL WRAPPER
     ======================================================= */

  /**
   * Runs an ML call. In 'review' mode a failure is recorded on
   * stats.mlError, later ML calls for this file are skipped, and
   * processing continues. In 'fail' mode the error propagates.
   */
  private async runMl<T>(
    stats: ProcessingStats,
    label: string,
    call: () => Promise<T>
  ): Promise<T | null> {
    if (stats.mlError) return null;

    try {
      return await call();
    } catch (error) {
      if (ML_FAIL_MODE === 'fail') throw error;

      const message = error instanceof Error ? error.message : String(error);
      stats.mlError = `${label}: ${message}`;

      logger.error(
        `[ProcessorService] ML call failed, continuing without anomaly checks | ${stats.mlError}`
      );

      return null;
    }
  }

  /* =======================================================
     STORE ANOMALY FLAGS
     ======================================================= */

  private async saveAnomalyFlags(
    fileId: string,
    flags: AnomalyFlag[],
    stats: ProcessingStats
  ): Promise<void> {
    if (!flags || flags.length === 0) return;

    await prisma.anomaly.createMany({
      data: flags.map((flag) => ({
        fileId,
        rowNumber: flag.row_number ?? null,
        anomalyType: flag.anomaly_type,
        description: flag.explanation,
        score: flag.score,
        details: {
          rule_ref: flag.rule_ref,
          method: flag.method,
          level: flag.level,
        } as Prisma.InputJsonValue,
      })),
    });

    stats.anomalyCount += flags.length;

    logger.debug(
      `[ProcessorService] Saved ML anomalies | file=${fileId} | ` +
        `count=${flags.length} | total=${stats.anomalyCount}`
    );
  }

  /* =======================================================
     PROGRESS
     ======================================================= */

  private async updateProgress(
    fileId: string,
    bytesRead: number,
    totalBytes: number,
    stats: ProcessingStats
  ): Promise<void> {
    // 100% is reserved for the final status update.
    // Rows processed / rows in file (bytes read from disk run ahead of the rows
    // actually processed, so they are only a fallback). 100% is set at the end.
    const fraction =
      stats.totalRows > 0
        ? stats.processedRows / stats.totalRows
        : totalBytes > 0
          ? bytesRead / totalBytes
          : 0;
    const progress = Math.min(Math.floor(fraction * 100), 99);

    await prisma.processingFile.update({
      where: { id: fileId },
      data: {
        progress,
        processedRows: stats.processedRows,
        successfulRows: stats.validRows,
        failedRows: stats.rejectedRows,
      },
    });

    emitFileProgress(fileId, progress, 'PROCESSING', {
      processedRows: stats.processedRows,
      validRows: stats.validRows,
      rejectedRows: stats.rejectedRows,
      anomalyCount: stats.anomalyCount,
    });

    // One INFO line per 10% (per-batch detail is at LOG_LEVEL=debug).
    const step = Math.floor(progress / 10);
    if (step > (this.loggedStep.get(fileId) ?? 0)) {
      this.loggedStep.set(fileId, step);
      logger.info(
        `[ProcessorService] Progress ${step * 10}% | file=${fileId} | ` +
          `rows=${stats.processedRows} | valid=${stats.validRows} | ` +
          `rejected=${stats.rejectedRows} | anomalies=${stats.anomalyCount}`
      );
    }
  }

  /* =======================================================
     HELPERS
     ======================================================= */

  /**
   * Moves the processed CSV out of incoming/ and records the new
   * location in ProcessingFile.storedPath. Never throws: a file that
   * cannot be moved stays where it is and the reason is logged.
   */
  private async archiveSource(
    fileId: string,
    filePath: string,
    stage: ArchiveStage
  ): Promise<void> {
    this.loggedStep.delete(fileId);
    this.suggestionsDown.delete(fileId);

    const newPath = await archiveFile(filePath, stage);
    if (!newPath || newPath === filePath) return;

    try {
      await prisma.processingFile.update({
        where: { id: fileId },
        data: { storedPath: newPath },
      });
    } catch (error) {
      logger.warn(
        `[ProcessorService] File moved but storedPath not updated | file=${fileId} | path=${newPath}`,
        error
      );
    }
  }

  /** Counts data rows (lines minus header) by streaming, so large files are fine. */
  private countDataRows(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let lines = 0;
      let lastByte = -1;
      let sawAny = false;

      fs.createReadStream(filePath)
        .on('data', (chunk: Buffer | string) => {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          if (buf.length === 0) return;
          sawAny = true;
          for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 10) lines++;
          }
          lastByte = buf[buf.length - 1];
        })
        .on('end', () => {
          if (!sawAny) return resolve(0);
          if (lastByte !== 10) lines++; // last line without trailing newline
          resolve(Math.max(lines - 1, 0)); // minus header
        })
        .on('error', reject);
    });
  }
}

export const processorService = new ProcessorService();
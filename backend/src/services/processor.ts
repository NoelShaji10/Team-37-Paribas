import fs from 'fs';
import csv from 'csv-parser';
import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { emitDashboardAlert, emitFileProgress } from '../sockets/socket';

import { validatorService } from './validator';
import { loaderService } from './loader';
import { mlClient, AnomalyFlag } from './mlClient';

type CsvRecord = Record<string, string>;

interface ProcessingStats {
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  anomalyCount: number;
}

export class ProcessorService {
  private readonly batchSize = 500;

  /** File type per file id, for Layer 2 (ACCOUNTS | BANK_TRANSACTIONS | PAYMENTS | RATES). */
  private readonly fileTypes = new Map<string, string>();

  /** Rows already counted as anomalous, per file (one row can get several flags). */
  private readonly anomalyRows = new Map<string, Set<number>>();

  /**
   * Main processing entry point.
   *
   * QUEUED
   *   ↓
   * PROCESSING
   *   ↓
   * COMPLETED / NEEDS_REVIEW / FAILED
   */
  async processFile(
    fileId: string,
    filePath: string,
    _totalRows?: number
  ): Promise<void> {
    const startedAt = new Date();

    logger.info(
      `[ProcessorService] Starting processing | fileId=${fileId}`
    );

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileStats =
        await fs.promises.stat(filePath);

      const fileSizeBytes =
        fileStats.size;

      // ------------------------------------------------
      // Mark as PROCESSING
      // ------------------------------------------------

      const processingFile = await prisma.processingFile.update({
        where: {
          id: fileId,
        },
        data: {
          status: 'PROCESSING',
          startedAt,
          progress: 0,
          processedRows: 0,
          successfulRows: 0,
          failedRows: 0,
          errorMessage: null,
        },
      });

      // Layer 2 needs the file type to pick the right checks and model
      this.fileTypes.set(fileId, processingFile.fileType);
      this.anomalyRows.set(fileId, new Set());

      emitFileProgress(
        fileId,
        0,
        'PROCESSING',
        {
          processedRows: 0,
          validRows: 0,
          rejectedRows: 0,
          anomalyCount: 0,
        }
      );

      // ------------------------------------------------
      // Process CSV
      // ------------------------------------------------

      const stats =
        await this.streamAndProcessFile(
          fileId,
          filePath,
          fileSizeBytes
        );

      // Layer 2 file-wide checks: velocity, near-duplicates, rates series
      const fileFlags = await mlClient.finishAnomalies(fileId);
      await this.recordAnomalies(fileId, fileFlags, stats);

      // AI normalisation summary + ">50% rule" proposals (one fix for most of a column's errors)
      const normalization = await mlClient.finishNormalization(fileId);
      if (normalization) {
        logger.info(
          `[ProcessorService] Normalisation summary | file=${fileId} | ${JSON.stringify(normalization.summary)}`
        );
        for (const proposal of normalization.proposals) {
          emitDashboardAlert('NORMALIZATION_PROPOSAL', proposal.message, { fileId, ...proposal });
        }
      }

      const completedAt =
        new Date();

      const actualDurationMs =
        completedAt.getTime() -
        startedAt.getTime();

      /**
       * If rejected rows exist,
       * send file to Resolution Centre.
       */
      const finalStatus =
        stats.rejectedRows > 0
          ? 'NEEDS_REVIEW'
          : 'COMPLETED';

      // ------------------------------------------------
      // Save final result
      // ------------------------------------------------

      await prisma.processingFile.update({
        where: {
          id: fileId,
        },
        data: {
          status: finalStatus,

          progress: 100,

          recordCount:
            stats.processedRows,

          totalRows:
            stats.processedRows,

          processedRows:
            stats.processedRows,

          successfulRows:
            stats.validRows,

          failedRows:
            stats.rejectedRows,

          completedAt,

          actualDurationMs,

          errorMessage: null,
        },
      });

      emitFileProgress(
        fileId,
        100,
        finalStatus,
        {
          processedRows:
            stats.processedRows,

          validRows:
            stats.validRows,

          rejectedRows:
            stats.rejectedRows,

          anomalyCount:
            stats.anomalyCount,

          actualDurationMs,
        }
      );

      this.fileTypes.delete(fileId);
      this.anomalyRows.delete(fileId);

      logger.info(
        `[ProcessorService] Completed | ` +
          `file=${fileId} | ` +
          `status=${finalStatus} | ` +
          `processed=${stats.processedRows} | ` +
          `valid=${stats.validRows} | ` +
          `rejected=${stats.rejectedRows} | ` +
          `anomalies=${stats.anomalyCount}`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown processing error';

      const completedAt =
        new Date();

      const actualDurationMs =
        completedAt.getTime() -
        startedAt.getTime();

      logger.error(
        `[ProcessorService] Failed | file=${fileId} | ${message}`
      );

      this.fileTypes.delete(fileId);
      this.anomalyRows.delete(fileId);
      await mlClient.finishAnomalies(fileId); // free the ML-side sessions
      await mlClient.finishNormalization(fileId);

      try {
        await prisma.processingFile.update({
          where: {
            id: fileId,
          },
          data: {
            status: 'FAILED',
            completedAt,
            actualDurationMs,
            errorMessage: message,
          },
        });
      } catch (databaseError) {
        logger.error(
          `[ProcessorService] Failed updating FAILED status | file=${fileId}`,
          databaseError
        );
      }

      emitFileProgress(
        fileId,
        0,
        'FAILED',
        {
          error: message,
        }
      );

      throw error;
    }
  }

  /**
   * Streams CSV instead of loading the whole file into RAM.
   */
  private async streamAndProcessFile(
    fileId: string,
    filePath: string,
    fileSizeBytes: number
  ): Promise<ProcessingStats> {
    return new Promise(
      (resolve, reject) => {
        const stats: ProcessingStats = {
          processedRows: 0,
          validRows: 0,
          rejectedRows: 0,
          anomalyCount: 0,
        };

        let batch: CsvRecord[] = [];

        /**
         * Makes sure batches from the same
         * file are processed sequentially.
         */
        let processing =
          Promise.resolve();

        const fileStream =
          fs.createReadStream(
            filePath
          );

        const csvStream =
          fileStream.pipe(
            csv({
              mapHeaders: ({
                header,
              }) =>
                header
                  .trim()
                  .toLowerCase()
                  .replace(
                    /\s+/g,
                    '_'
                  ),
            })
          );

        csvStream.on(
          'data',
          (
            record: CsvRecord
          ) => {
            csvStream.pause();

            batch.push(record);

            if (
              batch.length >=
              this.batchSize
            ) {
              const currentBatch =
                batch;

              batch = [];

              processing =
                processing
                  .then(() =>
                    this.processBatch(
                      fileId,
                      currentBatch,
                      stats
                    )
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
                  .catch(
                    (error) => {
                      csvStream.destroy(
                        error
                      );
                    }
                  );
            } else {
              csvStream.resume();
            }
          }
        );

        csvStream.on(
          'end',
          () => {
            processing
              .then(async () => {
                if (
                  batch.length >
                  0
                ) {
                  await this.processBatch(
                    fileId,
                    batch,
                    stats
                  );

                  await this.updateProgress(
                    fileId,
                    fileSizeBytes,
                    fileSizeBytes,
                    stats
                  );
                }

                resolve(stats);
              })
              .catch(reject);
          }
        );

        csvStream.on(
          'error',
          reject
        );

        fileStream.on(
          'error',
          reject
        );
      }
    );
  }

  /**
   * Process one batch of CSV records.
   */
  private async processBatch(
    fileId: string,
    records: CsvRecord[],
    stats: ProcessingStats
  ): Promise<void> {
    const validRecords: Array<
      Record<string, unknown>
    > = [];
    const validRowNumbers: number[] = [];

    /**
     * Collect fault logs first,
     * then insert them in one DB call.
     */
    const faultLogs: Prisma.FaultLogCreateManyInput[] =
      [];

    // Original row per fault, for AI suggestions that need context (same order as faultLogs)
    const faultRows: Array<Record<string, unknown>> = [];

    // ------------------------------------------------
    // AI normalisation (Tier A): workbook transformation rules applied before
    // validation; every change is logged by the ML service. Falls back to the
    // raw rows if the ML service is unavailable.
    // ------------------------------------------------
    const fileType = this.fileTypes.get(fileId) ?? '';
    const firstRowNumber = stats.processedRows + 2; // CSV line 1 is the header
    const normalized = await mlClient.normalizeBatch(
      fileId,
      fileType,
      records,
      records.map((_, i) => firstRowNumber + i)
    );
    const workingRows = (normalized?.rows ?? records) as CsvRecord[];
    const masterIssues = new Map<number, NonNullable<typeof normalized>['issues']>();
    for (const issue of normalized?.issues ?? []) {
      const list = masterIssues.get(issue.rowNumber) ?? [];
      list.push(issue);
      masterIssues.set(issue.rowNumber, list);
    }
    if (normalized && normalized.changes.length > 0) {
      logger.info(
        `[ProcessorService] Normalised ${normalized.changes.length} values | file=${fileId}`
      );
    }

    for (const [index, record] of workingRows.entries()) {
      stats.processedRows++;

      /**
       * +1 because CSV line 1 is header.
       *
       * First data row = CSV line 2.
       */
      const rowNumber =
        stats.processedRows + 1;

      // ----------------------------------------------
      // Validate row
      // ----------------------------------------------

      const validation =
        await validatorService.validateRecord(
          record
        );

      // Master-data issues from normalisation (ISO currency list, workbook enums),
      // skipping columns the validator already reported
      const reported = new Set(validation.issues.map((i) => i.columnName));
      for (const issue of masterIssues.get(rowNumber) ?? []) {
        if (reported.has(issue.columnName)) continue;
        validation.issues.push({
          columnName: issue.columnName,
          cellValue: issue.cellValue,
          errorMessage: `${issue.errorMessage} (rule ${issue.ruleRef})`,
          errorType: issue.errorType,
        });
        validation.errors.push(issue.errorMessage);
        validation.isValid = false;
      }

      // ----------------------------------------------
      // Invalid row
      // ----------------------------------------------

      if (!validation.isValid) {
        stats.rejectedRows++;

        logger.debug(
          `[ProcessorService] Rejected | ` +
            `file=${fileId} | ` +
            `row=${rowNumber} | ` +
            `errors=${validation.errors.join(
              ', '
            )}`
        );

        /**
         * One row may contain multiple problems.
         *
         * Example:
         * bad IFSC + invalid currency
         *
         * Therefore we create one FaultLog
         * per validation issue.
         */
        for (
          const issue of
          validation.issues
        ) {
          faultLogs.push({
            fileId,

            rowNumber,

            columnName:
              issue.columnName,

            cellValue:
              issue.cellValue ??
              null,

            errorMessage:
              issue.errorMessage,

            errorType:
              issue.errorType,

            rawRowData:
              records[index] as Prisma.InputJsonValue, // original row, before normalisation

            status:
              'PENDING',
          });
          faultRows.push(record);
        }

        continue;
      }

      // ----------------------------------------------
      // Valid row
      // ----------------------------------------------

      stats.validRows++;

      validRowNumbers.push(rowNumber);

      validRecords.push(
        record
      );
    }

    // ------------------------------------------------
    // Save rejected rows
    // ------------------------------------------------

    // ------------------------------------------------
    // AI-suggested fixes (Tier B): stored on each FaultLog for the Resolution
    // Centre. Suggestions are never applied automatically.
    // ------------------------------------------------
    if (faultLogs.length > 0) {
      const suggestions = await mlClient.suggestFixes(
        fileId,
        fileType,
        faultLogs.map((f, i) => ({
          rowNumber: f.rowNumber,
          columnName: f.columnName,
          cellValue: f.cellValue,
          errorType: f.errorType,
          errorMessage: f.errorMessage,
          row: faultRows[i],
        }))
      );
      suggestions.forEach((s, i) => {
        if (!faultLogs[i]) return;
        faultLogs[i].aiSuggestion = s.suggestion;
        faultLogs[i].aiConfidence = s.suggestion ? s.confidence : null;
        faultLogs[i].aiExplanation = s.explanation;
      });
    }

    if (
      faultLogs.length >
      0
    ) {
      await prisma.faultLog.createMany({
        data: faultLogs,
      });

      logger.info(
        `[ProcessorService] Saved ${faultLogs.length} fault logs | file=${fileId}`
      );
    }

    // ------------------------------------------------
    // Layer 2 anomaly detection: every valid row, one call per batch
    // ------------------------------------------------

    if (fileType && validRecords.length > 0) {
      const flags = await mlClient.detectAnomalyBatch(
        fileId,
        fileType,
        validRecords,
        validRowNumbers
      );
      await this.recordAnomalies(fileId, flags, stats);
    }

    // ------------------------------------------------
    // Referential check (workbook TXN-2 / PAY-2): a transaction or payment
    // must reference an account that exists in the Account table. The shared
    // schema enforces this with a foreign key; checking here first means a
    // missing account rejects only that row (with a reason), instead of the
    // database refusing the whole batch.
    // ------------------------------------------------

    let loadable = validRecords;
    if (
      (fileType === 'BANK_TRANSACTIONS' || fileType === 'PAYMENTS') &&
      validRecords.length > 0
    ) {
      const accountOf = (r: Record<string, unknown>) =>
        String(r.account_number ?? '').trim();
      const wanted = [...new Set(validRecords.map(accountOf).filter(Boolean))];
      const existing = new Set(
        (
          await prisma.account.findMany({
            where: { accountNumber: { in: wanted } },
            select: { accountNumber: true },
          })
        ).map((a: { accountNumber: string }) => a.accountNumber)
      );
      const rule = fileType === 'PAYMENTS' ? 'PAY-2' : 'TXN-2';
      const orphanLogs: Prisma.FaultLogCreateManyInput[] = [];
      loadable = [];
      validRecords.forEach((record, i) => {
        const account = accountOf(record);
        if (existing.has(account)) {
          loadable.push(record);
          return;
        }
        orphanLogs.push({
          fileId,
          rowNumber: validRowNumbers[i],
          columnName: 'account_number',
          cellValue: account || null,
          errorMessage: `Account ${account} not found in Accounts master (rule ${rule})`,
          errorType: 'ACCOUNT_NOT_FOUND',
          rawRowData: record as Prisma.InputJsonValue,
          status: 'PENDING',
          aiSuggestion: null,
          aiConfidence: null,
          aiExplanation:
            'No safe automatic fix: load the Accounts file that contains this account first, or confirm the account number with the source system',
        });
      });
      if (orphanLogs.length > 0) {
        await prisma.faultLog.createMany({ data: orphanLogs });
        stats.validRows -= orphanLogs.length;
        stats.rejectedRows += orphanLogs.length;
        logger.info(
          `[ProcessorService] ${orphanLogs.length} rows rejected: account not in Accounts (${rule}) | file=${fileId}`
        );
      }
    }

    // ------------------------------------------------
    // Save valid records
    // ------------------------------------------------

    if (
      loadable.length >
      0
    ) {
      await loaderService.loadValidRecords(
        fileId,
        loadable
      );
    }
  }

  /**
   * Counts flagged rows and saves Layer 2 flags to the Anomaly table.
   * A database problem never stops file processing.
   */
  private async recordAnomalies(
    fileId: string,
    flags: AnomalyFlag[],
    stats: ProcessingStats
  ): Promise<void> {
    if (flags.length === 0) return;

    const seen = this.anomalyRows.get(fileId) ?? new Set<number>();
    for (const flag of flags) {
      if (flag.row_number !== null && !seen.has(flag.row_number)) {
        seen.add(flag.row_number);
        stats.anomalyCount++;
      }
    }
    this.anomalyRows.set(fileId, seen);

    try {
      await prisma.anomaly.createMany({
        data: flags.map((flag) => ({
          fileId,
          rowNumber: flag.row_number,
          anomalyType: flag.anomaly_type,
          description: flag.explanation,
          score: flag.score,
          details: {
            ruleRef: flag.rule_ref,
            method: flag.method,
            level: flag.level,
          },
        })),
      });
    } catch (error) {
      logger.warn(
        `[ProcessorService] Could not save ${flags.length} anomaly flags | file=${fileId}`,
        error
      );
    }
  }

  /**
   * Save progress to DB and push it through Socket.IO.
   */
  private async updateProgress(
    fileId: string,
    bytesRead: number,
    totalBytes: number,
    stats: ProcessingStats
  ): Promise<void> {
    let progress = 0;

    if (totalBytes > 0) {
      progress =
        Math.floor(
          (bytesRead /
            totalBytes) *
            100
        );
    }

    /**
     * 100% is reserved for
     * successful final completion.
     */
    progress =
      Math.min(
        progress,
        99
      );

    await prisma.processingFile.update({
      where: {
        id: fileId,
      },
      data: {
        progress,

        processedRows:
          stats.processedRows,

        successfulRows:
          stats.validRows,

        failedRows:
          stats.rejectedRows,
      },
    });

    emitFileProgress(
      fileId,
      progress,
      'PROCESSING',
      {
        processedRows:
          stats.processedRows,

        validRows:
          stats.validRows,

        rejectedRows:
          stats.rejectedRows,

        anomalyCount:
          stats.anomalyCount,
      }
    );
  }
}

export const processorService =
  new ProcessorService();
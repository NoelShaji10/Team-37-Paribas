import fs from 'fs';
import csv from 'csv-parser';
import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { emitFileProgress } from '../sockets/socket';

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
      await mlClient.finishAnomalies(fileId); // free the ML-side session

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

    for (const record of records) {
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
              record as Prisma.InputJsonValue,

            status:
              'PENDING',
          });
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

    const fileType = this.fileTypes.get(fileId);

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
    // Save valid records
    // ------------------------------------------------

    if (
      validRecords.length >
      0
    ) {
      await loaderService.loadValidRecords(
        fileId,
        validRecords
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
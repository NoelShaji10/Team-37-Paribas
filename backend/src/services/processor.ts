import fs from 'fs';
import csv from 'csv-parser';

import { logger } from '../utils/logger';
import { emitFileProgress } from '../sockets/socket';
import { validatorService } from './validator';
import { loaderService } from './loader';
import { mlClient } from './mlClient';

type CsvRecord = Record<string, string>;

interface ProcessingStats {
  processedRows: number;
  validRows: number;
  rejectedRows: number;
  anomalyCount: number;
}

export class ProcessorService {
  private readonly batchSize = 500;

  /**
   * Main entry point for processing one file.
   *
   * Multiple calls to this method can run concurrently
   * through fileWorker.ts.
   */
  async processFile(
    fileId: string,
    filePath: string,
    _totalRows?: number
  ): Promise<void> {
    logger.info(
      `[ProcessorService] Starting processing | fileId=${fileId}`
    );

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileStats = await fs.promises.stat(filePath);
      const fileSizeBytes = fileStats.size;

      emitFileProgress(fileId, 0, 'PROCESSING', {
        processedRows: 0,
        validRows: 0,
        rejectedRows: 0,
        anomalyCount: 0,
      });

      const stats = await this.streamAndProcessFile(
        fileId,
        filePath,
        fileSizeBytes
      );

      emitFileProgress(fileId, 100, 'COMPLETED', {
        ...stats,
      });

      logger.info(
        `[ProcessorService] Completed file ${fileId} | ` +
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

      logger.error(
        `[ProcessorService] Processing failed for ${fileId}: ${message}`
      );

      emitFileProgress(fileId, 0, 'FAILED', {
        error: message,
      });

      throw error;
    }
  }

  /**
   * Streams the CSV instead of loading the entire file into RAM.
   */
  private async streamAndProcessFile(
    fileId: string,
    filePath: string,
    fileSizeBytes: number
  ): Promise<ProcessingStats> {
    return new Promise((resolve, reject) => {
      const stats: ProcessingStats = {
        processedRows: 0,
        validRows: 0,
        rejectedRows: 0,
        anomalyCount: 0,
      };

      let batch: CsvRecord[] = [];
      let processing = Promise.resolve();

      const fileStream = fs.createReadStream(filePath);

      const csvStream = fileStream.pipe(
        csv({
          mapHeaders: ({ header }) =>
            header.trim().toLowerCase().replace(/\s+/g, '_'),
        })
      );

      csvStream.on('data', (record: CsvRecord) => {
        // Stop the stream temporarily while processing a batch.
        csvStream.pause();

        batch.push(record);

        if (batch.length >= this.batchSize) {
          const currentBatch = batch;
          batch = [];

          processing = processing
            .then(() =>
              this.processBatch(
                fileId,
                currentBatch,
                stats
              )
            )
            .then(() => {
              this.emitProgress(
                fileId,
                fileStream.bytesRead,
                fileSizeBytes,
                stats
              );

              csvStream.resume();
            })
            .catch((error) => {
              csvStream.destroy(error);
            });
        } else {
          csvStream.resume();
        }
      });

      csvStream.on('end', () => {
        processing
          .then(async () => {
            // Process final partial batch
            if (batch.length > 0) {
              await this.processBatch(
                fileId,
                batch,
                stats
              );
            }

            resolve(stats);
          })
          .catch(reject);
      });

      csvStream.on('error', (error) => {
        reject(error);
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Processes a batch of rows.
   */
  private async processBatch(
    fileId: string,
    records: CsvRecord[],
    stats: ProcessingStats
  ): Promise<void> {
    const validRecords: Array<Record<string, unknown>> = [];

    for (const record of records) {
      stats.processedRows++;

      const validation =
        await validatorService.validateRecord(record);

      if (!validation.isValid) {
        stats.rejectedRows++;

        logger.debug(
          `[ProcessorService] Rejected row in ${fileId}: ${validation.errors.join(
            ', '
          )}`
        );

        /*
         * Once Prisma is connected:
         *
         * save rejected record + validation errors here.
         */

        continue;
      }

      stats.validRows++;

      /*
       * For MVP we perform anomaly checking on a sample instead
       * of making an HTTP ML request for every single row.
       *
       * Every 100th valid record is checked.
       */
      if (stats.validRows % 100 === 0) {
        const anomaly = await mlClient.checkAnomaly(
          fileId,
          record
        );

        if (anomaly.isAnomaly) {
          stats.anomalyCount++;

          /*
           * Later:
           * persist anomaly in database.
           */
        }
      }

      validRecords.push(record);
    }

    /*
     * Send valid records to loader in one batch instead
     * of doing a DB insert for every row.
     */
    if (validRecords.length > 0) {
      await loaderService.loadValidRecords(
        fileId,
        validRecords
      );
    }
  }

  /**
   * Calculates progress using bytes read.
   *
   * This means we don't need to scan the entire file first
   * just to count how many rows it contains.
   */
  private emitProgress(
    fileId: string,
    bytesRead: number,
    totalBytes: number,
    stats: ProcessingStats
  ): void {
    let progress = 0;

    if (totalBytes > 0) {
      progress = Math.floor(
        (bytesRead / totalBytes) * 100
      );
    }

    // Do not send 100 until everything has actually finished.
    progress = Math.min(progress, 99);

    emitFileProgress(
      fileId,
      progress,
      'PROCESSING',
      {
        processedRows: stats.processedRows,
        validRows: stats.validRows,
        rejectedRows: stats.rejectedRows,
        anomalyCount: stats.anomalyCount,
      }
    );
  }
}

export const processorService = new ProcessorService();
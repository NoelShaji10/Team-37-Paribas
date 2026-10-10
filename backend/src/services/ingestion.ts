import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

import {
  classifierService,
  FileCategory,
} from './classifier';
import { mlClient } from './mlClient';
import { fileWorker } from '../workers/fileWorker';

export interface IngestionResult {
  fileId: string;
  status: 'QUEUED' | 'QUARANTINED';
  quarantineReason?: string;
  originalName: string;
  filePath: string;
  fileSizeBytes: number;
  fileHash: string;
  fileType: Exclude<FileCategory, 'UNKNOWN'>;
}

export class IngestionService {
  async ingestFile(
    filePath: string,
    originalName: string
  ): Promise<IngestionResult> {
    logger.info(
      `[IngestionService] Ingesting file: ${originalName}`
    );

    // 1. Make sure uploaded file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Uploaded file not found: ${filePath}`
      );
    }

    // 2. Only CSV for current MVP
    const extension =
      path.extname(originalName).toLowerCase();

    if (extension !== '.csv') {
      throw new Error(
        `Unsupported file format: ${
          extension || 'unknown'
        }`
      );
    }

    // 3. File metadata
    const stats = await fs.promises.stat(filePath);

    if (stats.size === 0) {
      throw new Error('Uploaded file is empty');
    }

    // 4. Generate checksum without loading whole file in memory
    const fileHash =
      await this.calculateFileHash(filePath);

    // 5. Prevent same file from being processed twice
    const duplicate =
      await prisma.processingFile.findFirst({
        where: {
          checksum: fileHash,
        },
        select: {
          id: true,
          fileName: true,
          status: true,
        },
      });

    if (duplicate) {
      throw new Error(
        `Duplicate file detected. File already exists with id=${duplicate.id}`
      );
    }

    // 6. Read CSV headers
    const headers =
      await this.readCsvHeaders(filePath);

    if (headers.length === 0) {
      throw new Error(
        'CSV file does not contain headers'
      );
    }

    // 7. Determine banking file type
    const detectedType =
      await classifierService.classifyFileType(
        headers,
        originalName
      );

    // Prisma FileType does not contain UNKNOWN
    if (detectedType === 'UNKNOWN') {
      throw new Error(
        `Unable to determine file type for ${originalName}`
      );
    }

    const fileType = detectedType;

    // Keep same ID through DB → worker → processor → sockets
    const fileId = crypto.randomUUID();

    // 7b. File-level validation (python/file_level_validation.py via the ML service):
    // file name, header, encoding, record length, trailer. A failed file is
    // quarantined with its reason and recorded as FAILED, so it shows on the dashboard.
    const fileCheck = await mlClient.validateFile(filePath, originalName);
    if (fileCheck && !fileCheck.passed) {
      const reason = `Quarantined [${fileCheck.errorCode}]: ${fileCheck.reason}`;
      const quarantineDir = path.join(__dirname, '../../quarantine');
      await fs.promises.mkdir(quarantineDir, { recursive: true });
      const quarantinedPath = path.join(quarantineDir, `${fileId}_${path.basename(originalName)}`);
      await fs.promises.rename(filePath, quarantinedPath).catch(async () => {
        await fs.promises.copyFile(filePath, quarantinedPath);
        await fs.promises.unlink(filePath);
      });
      await prisma.processingFile.create({
        data: {
          id: fileId,
          fileName: originalName,
          originalName,
          storedPath: quarantinedPath,
          fileType,
          status: 'FAILED',
          sizeBytes: BigInt(stats.size),
          checksum: fileHash,
          progress: 0,
          processedRows: 0,
          successfulRows: 0,
          failedRows: 0,
          totalRows: 0,
          errorMessage: reason,
          completedAt: new Date(),
        },
      });
      logger.warn(`[IngestionService] ${originalName} ${reason}`);
      return {
        fileId,
        status: 'QUARANTINED',
        quarantineReason: reason,
        originalName,
        filePath: quarantinedPath,
        fileSizeBytes: stats.size,
        fileHash,
        fileType,
      };
    }

    // 8. Create persistent ProcessingFile record
    const processingFile =
      await prisma.processingFile.create({
        data: {
          id: fileId,
          fileName: originalName,
          originalName,
          storedPath: filePath,
          fileType,
          status: 'QUEUED',

          // Prisma schema uses BigInt
          sizeBytes: BigInt(stats.size),

          checksum: fileHash,
          progress: 0,
          processedRows: 0,
          successfulRows: 0,
          failedRows: 0,
          totalRows: 0,
        },
      });

    logger.info(
      `[IngestionService] File registered | ` +
        `fileId=${processingFile.id} | ` +
        `type=${processingFile.fileType} | ` +
        `size=${stats.size} bytes`
    );

    // 9. Predicted processing time, before the file starts (spec: ETA for queued files).
    // Uses the trained time model in the ML service, or its heuristic if none is trained.
    try {
      const rows = fileCheck?.totalRows || (await this.countDataRows(filePath));
      const worker = fileWorker.getStats();
      const concurrency = Math.min(
        worker.activeJobs + worker.queuedJobs + 1,
        worker.maxConcurrentJobs
      );
      const seconds = await mlClient.predictProcessingTime(fileType, rows, stats.size, concurrency);
      await prisma.processingFile.update({
        where: { id: fileId },
        data: { totalRows: rows, predictedDurationMs: Math.round(seconds * 1000) },
      });
    } catch (error) {
      logger.warn(`[IngestionService] Could not predict processing time for ${originalName}`, error);
    }

    return {
      fileId: processingFile.id,
      status: 'QUEUED',
      originalName,
      filePath,
      fileSizeBytes: stats.size,
      fileHash,
      fileType,
    };
  }

  /**
   * Counts data rows (lines minus the header) without loading the file.
   */
  private async countDataRows(filePath: string): Promise<number> {
    let lines = 0;
    let last = 10;
    for await (const chunk of fs.createReadStream(filePath) as AsyncIterable<Buffer>) {
      for (const byte of chunk) if (byte === 10) lines++;
      last = chunk[chunk.length - 1];
    }
    if (last !== 10) lines++;
    return Math.max(lines - 1, 0);
  }

  /**
   * SHA-256 checksum using streaming.
   *
   * Safe for large files because the complete
   * file is never loaded into RAM.
   */
  private calculateFileHash(
    filePath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash =
        crypto.createHash('sha256');

      const stream =
        fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', reject);
    });
  }

  /**
   * Reads only the CSV header.
   */
  private async readCsvHeaders(
    filePath: string
  ): Promise<string[]> {
    const stream =
      fs.createReadStream(filePath);

    const reader =
      readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

    try {
      for await (const line of reader) {
        return line
          .split(',')
          .map((header) =>
            header
              .trim()
              .replace(/^["']|["']$/g, '')
              .toLowerCase()
              .replace(/\s+/g, '_')
          );
      }

      return [];
    } finally {
      reader.close();
      stream.destroy();
    }
  }
}

export const ingestionService =
  new IngestionService();
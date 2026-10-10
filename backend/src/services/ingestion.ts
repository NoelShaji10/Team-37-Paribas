import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

import { logger } from '../utils/logger';
import {
  classifierService,
  FileCategory,
} from './classifier';

export interface IngestionResult {
  fileId: string;
  status: 'QUEUED';
  originalName: string;
  filePath: string;
  fileSizeBytes: number;
  fileHash: string;
  fileType: FileCategory;
}

export class IngestionService {
  /**
   * Register a newly uploaded file before it is sent to the worker pool.
   *
   * This does NOT process the whole file.
   * It only:
   * - validates basic file information
   * - gets file size
   * - calculates SHA-256 hash
   * - reads the CSV header
   * - classifies the file
   */
  async ingestFile(
    filePath: string,
    originalName: string
  ): Promise<IngestionResult> {
    logger.info(
      `[IngestionService] Ingesting file: ${originalName}`
    );

    // Make sure the file actually exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Uploaded file not found: ${filePath}`);
    }

    // For MVP we are processing CSV files
    const extension = path.extname(originalName).toLowerCase();

    if (extension !== '.csv') {
      throw new Error(
        `Unsupported file format: ${extension || 'unknown'}`
      );
    }

    // Get metadata without reading entire file
    const stats = await fs.promises.stat(filePath);

    if (stats.size === 0) {
      throw new Error('Uploaded file is empty');
    }

    // Calculate hash using a stream so large files stay memory-safe
    const fileHash = await this.calculateFileHash(filePath);

    // Read only the first line/header
    const headers = await this.readCsvHeaders(filePath);

    if (headers.length === 0) {
      throw new Error('CSV file does not contain headers');
    }

    // Determine what kind of banking file this is
    const fileType =
    await classifierService.classifyFileType(
    headers,
    originalName
    );
    const fileId = crypto.randomUUID();

    logger.info(
      `[IngestionService] File accepted | ` +
        `fileId=${fileId} | ` +
        `type=${fileType} | ` +
        `size=${stats.size} bytes`
    );

    /*
     * Later, once Prisma schema is ready:
     *
     * await prisma.file.create({
     *   data: {
     *     id: fileId,
     *     fileName: originalName,
     *     storagePath: filePath,
     *     fileSizeBytes: stats.size,
     *     fileHash,
     *     status: 'QUEUED',
     *     ...
     *   }
     * });
     */

    return {
      fileId,
      status: 'QUEUED',
      originalName,
      filePath,
      fileSizeBytes: stats.size,
      fileHash,
      fileType,
    };
  }

  /**
   * SHA-256 hash of the file.
   *
   * Uses streaming instead of fs.readFile(),
   * so even multi-GB files are not loaded into memory.
   */
  private calculateFileHash(
    filePath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');

      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Reads only the first line of the CSV.
   * We only need the header during ingestion/classification.
   */
  private async readCsvHeaders(
    filePath: string
  ): Promise<string[]> {
    const stream = fs.createReadStream(filePath);

    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of reader) {
        const headers = line
          .split(',')
          .map((header) =>
            header
              .trim()
              .replace(/^["']|["']$/g, '')
              .toLowerCase()
          );

        return headers;
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
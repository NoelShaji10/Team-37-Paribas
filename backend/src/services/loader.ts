import fs from 'fs';
import path from 'path';

import { logger } from '../utils/logger';

export class LoaderService {
  private readonly processedDirectory: string;

  constructor() {
    this.processedDirectory = path.join(
      __dirname,
      '../../processed'
    );
  }

  /**
   * Loads a batch of valid records.
   *
   * Temporary implementation:
   * stores valid rows in a JSONL file.
   *
   * Later this method will use Prisma/database bulk insert.
   */
  async loadValidRecords(
    fileId: string,
    records: Array<Record<string, unknown>>
  ): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    try {
      await fs.promises.mkdir(
        this.processedDirectory,
        { recursive: true }
      );

      const safeFileId = fileId.replace(
        /[^a-zA-Z0-9-_]/g,
        '_'
      );

      const outputPath = path.join(
        this.processedDirectory,
        `${safeFileId}.jsonl`
      );

      /**
       * JSONL format:
       *
       * {"transaction_id":"1","amount":"500"}
       * {"transaction_id":"2","amount":"900"}
       *
       * One record per line.
       */
      const data =
        records
          .map((record) => JSON.stringify(record))
          .join('\n') + '\n';

      await fs.promises.appendFile(
        outputPath,
        data,
        'utf8'
      );

      logger.info(
        `[LoaderService] Loaded ${records.length} valid records for file=${fileId}`
      );

      return records.length;
    } catch (error) {
      logger.error(
        `[LoaderService] Failed loading records for file=${fileId}`,
        error
      );

      throw error;
    }
  }
}

export const loaderService =
  new LoaderService();
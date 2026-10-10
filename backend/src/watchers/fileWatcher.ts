import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

import { ingestionService } from '../services/ingestion';
import { fileWorker } from '../workers/fileWorker';
import { logger } from '../utils/logger';

const incomingFolder = path.join(
  __dirname,
  '../../incoming'
);

export function startFileWatcher(): void {
  // Make sure incoming folder exists
  fs.mkdirSync(incomingFolder, {
    recursive: true,
  });

  logger.info(
    `[FileWatcher] Watching folder: ${incomingFolder}`
  );

  const watcher = chokidar.watch(incomingFolder, {
    ignoreInitial: true,

    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcher.on('add', async (filePath) => {
    try {
      const fileName =
        path.basename(filePath);

      logger.info(
        `[FileWatcher] New file detected: ${fileName}`
      );

      const result =
        await ingestionService.ingestFile(
          filePath,
          fileName
        );

      const jobId =
        `folder_${Date.now()}`;

      fileWorker.enqueue({
        jobId,
        fileId: result.fileId,
        filePath,
      });

      logger.info(
        `[FileWatcher] File queued: ${fileName}`
      );
    } catch (error) {
      logger.error(
        '[FileWatcher] Failed to ingest file:',
        error
      );
    }
  });

  watcher.on('error', (error) => {
    logger.error(
      '[FileWatcher] Watcher error:',
      error
    );
  });
}
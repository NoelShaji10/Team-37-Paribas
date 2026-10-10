import path from 'path';
import chokidar from 'chokidar';

import { ingestionService } from '../services/ingestion';
import { fileWorker } from '../workers/fileWorker';
import { logger } from '../utils/logger';
import {
  INCOMING_DIR,
  archiveFile,
  ensureDirectories,
} from '../utils/fileUtils';

/**
 * Watches backend/incoming.
 *
 * Lifecycle of a file dropped here:
 *   incoming/  -> ingested + queued -> processed by processor.ts
 *              -> processed/   when it finishes (COMPLETED / NEEDS_REVIEW)
 *              -> quarantine/  when processing FAILS, or when ingestion
 *                              rejects it here (duplicate, not CSV, empty,
 *                              unknown type)
 *
 * So incoming/ only ever holds files that are waiting or in progress.
 */
export function startFileWatcher(): void {
  ensureDirectories();

  logger.info(`[FileWatcher] Watching folder: ${INCOMING_DIR}`);

  const watcher = chokidar.watch(INCOMING_DIR, {
    // Also pick up files that were already sitting in incoming/
    // when the server started (they used to be ignored forever).
    ignoreInitial: false,

    // Only the folder itself, and skip hidden/temp files (.gitkeep, ~$x.csv).
    depth: 0,
    ignored: (p: string) => {
      const base = path.basename(p);
      return p !== INCOMING_DIR && (base.startsWith('.') || base.startsWith('~$'));
    },

    // Wait until the file has finished copying before reading it.
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcher.on('add', async (filePath) => {
    const fileName = path.basename(filePath);

    try {
      logger.info(`[FileWatcher] New file detected: ${fileName}`);

      const result = await ingestionService.ingestFile(filePath, fileName);

      fileWorker.enqueue({
        jobId: `folder_${Date.now()}`,
        fileId: result.fileId,
        filePath,
      });

      // processor.ts moves the file to processed/ or quarantine/ when done.
      logger.info(`[FileWatcher] File queued: ${fileName} | file=${result.fileId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(
        `[FileWatcher] Ingestion rejected ${fileName}: ${message}`
      );

      // Rejected before processing (duplicate, wrong format, empty,
      // unknown type): move it out so incoming/ does not fill up.
      await archiveFile(filePath, 'quarantine');
    }
  });

  watcher.on('error', (error) => {
    logger.error('[FileWatcher] Watcher error:', error);
  });
}
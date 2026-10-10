import fs from 'fs';
import path from 'path';

import { logger } from './logger';

const BACKEND_ROOT = path.join(__dirname, '../..');

export const INCOMING_DIR = path.join(BACKEND_ROOT, 'incoming');
export const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');
export const PROCESSED_DIR = path.join(BACKEND_ROOT, 'processed');
export const QUARANTINE_DIR = path.join(BACKEND_ROOT, 'quarantine');

export type ArchiveStage = 'processed' | 'quarantine';

export function ensureDirectories(): void {
  [INCOMING_DIR, UPLOADS_DIR, PROCESSED_DIR, QUARANTINE_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

export function moveFile(sourcePath: string, destinationPath: string): void {
  const targetDir = path.dirname(destinationPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.copyFileSync(sourcePath, destinationPath);
    fs.unlinkSync(sourcePath);
  }
}

function archiveDestination(sourcePath: string, stage: ArchiveStage): string {
  const dir = stage === 'processed' ? PROCESSED_DIR : QUARANTINE_DIR;
  const stamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').replace(/\..+$/, '');
  const name = path.basename(sourcePath);

  let candidate = path.join(dir, `${stamp}_${name}`);
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${stamp}_${n}_${name}`);
  }
  return candidate;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Moves a finished file to processed/ or quarantine/. Never throws. */
export async function archiveFile(
  sourcePath: string,
  stage: ArchiveStage
): Promise<string | null> {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    logger.warn(`[FileUtils] Nothing to archive, file not found: ${sourcePath}`);
    return null;
  }

  const resolved = path.resolve(sourcePath);
  if (
    resolved.startsWith(path.resolve(PROCESSED_DIR) + path.sep) ||
    resolved.startsWith(path.resolve(QUARANTINE_DIR) + path.sep)
  ) {
    return sourcePath;
  }

  const destination = archiveDestination(sourcePath, stage);

  // Windows can briefly lock a file after reading it, so retry.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      moveFile(sourcePath, destination);
      logger.info(`[FileUtils] Moved to ${stage}: ${sourcePath} -> ${destination}`);
      return destination;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!retryable || attempt === 5) {
        logger.error(`[FileUtils] Could not move ${sourcePath} to ${stage} (${code ?? 'error'})`, error);
        return null;
      }
      await sleep(300 * attempt);
    }
  }
  return null;
}
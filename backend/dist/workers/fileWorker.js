import fs from 'fs';
import path from 'path';

import { logger } from '../utils/logger';
import { processorService } from '../services/processor';

export interface FileJob {
  jobId: string;
  fileId: string;
  filePath: string;
  totalRows?: number;
}

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 20;

// Saved choice from the Settings page (survives restarts)
const SETTINGS_FILE = path.join(__dirname, '../../config/runtime-settings.json');

function clampConcurrency(value: number): number {
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.floor(value)));
}

function readSavedConcurrency(): number | null {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const value = Number(saved?.maxConcurrentFiles);
    return Number.isFinite(value) ? clampConcurrency(value) : null;
  } catch (error) {
    logger.warn(`[FileWorker] Could not read ${SETTINGS_FILE}, using defaults`, error);
    return null;
  }
}

function saveConcurrency(value: number): void {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    let current: Record<string, unknown> = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try { current = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { current = {}; }
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, maxConcurrentFiles: value }, null, 2));
  } catch (error) {
    logger.error('[FileWorker] Could not save concurrency setting', error);
  }
}

export class FileWorker {
  private maxConcurrentJobs: number;
  private activeJobs = 0;
  private queue: FileJob[] = [];
  private isRunning = false;

  constructor(maxConcurrentJobs: number = 3) {
    this.maxConcurrentJobs = clampConcurrency(maxConcurrentJobs);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`[FileWorker] Worker pool started with concurrency=${this.maxConcurrentJobs}`);
    this.processQueue();
  }

  stop(): void {
    this.isRunning = false;
    logger.info('[FileWorker] Worker pool stopped.');
  }

  enqueue(job: FileJob): void {
    this.queue.push(job);
    logger.info(`[FileWorker] Job queued: ${job.jobId} | file=${job.fileId} | queueSize=${this.queue.length}`);
    this.processQueue();
  }

  /** Change concurrency live. Running files are never interrupted. */
  setConcurrency(value: number): number {
    const next = clampConcurrency(value);
    const previous = this.maxConcurrentJobs;
    this.maxConcurrentJobs = next;
    saveConcurrency(next);

    logger.info(
      `[FileWorker] Concurrency changed ${previous} -> ${next} | active=${this.activeJobs} | queued=${this.queue.length}`
    );

    if (next > previous) this.processQueue();
    return next;
  }

  private processQueue(): void {
    if (!this.isRunning) return;

    while (this.activeJobs < this.maxConcurrentJobs && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;

      this.activeJobs++;
      logger.info(`[FileWorker] Starting job ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`);

      this.processJob(job)
        .catch((error) => logger.error(`[FileWorker] Job failed: ${job.jobId}`, error))
        .finally(() => {
          this.activeJobs--;
          logger.info(`[FileWorker] Job finished: ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`);
          this.processQueue();
        });
    }
  }

  private async processJob(job: FileJob): Promise<void> {
    logger.info(`[FileWorker] Processing file ${job.fileId} from ${job.filePath}`);
    await processorService.processFile(job.fileId, job.filePath, job.totalRows);
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs,
      queuedJobs: this.queue.length,
      maxConcurrentJobs: this.maxConcurrentJobs,
      minConcurrency: MIN_CONCURRENCY,
      maxConcurrency: MAX_CONCURRENCY,
    };
  }
}

const initialConcurrency =
  readSavedConcurrency() ?? (Number(process.env.MAX_CONCURRENT_FILES) || 3);

export const fileWorker = new FileWorker(initialConcurrency);
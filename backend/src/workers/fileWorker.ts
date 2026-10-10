import { logger } from '../utils/logger';
import { processorService } from '../services/processor';

export interface FileJob {
  jobId: string;
  fileId: string;
  filePath: string;
  totalRows?: number;
}

export class FileWorker {
  private readonly maxConcurrentJobs: number;
  private activeJobs = 0;
  private queue: FileJob[] = [];
  private isRunning = false;

  constructor(maxConcurrentJobs: number = 3) {
    this.maxConcurrentJobs = maxConcurrentJobs;
  }

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    logger.info(
      `[FileWorker] Worker pool started with concurrency=${this.maxConcurrentJobs}`
    );

    this.processQueue();
  }

  stop(): void {
    this.isRunning = false;
    logger.info('[FileWorker] Worker pool stopped.');
  }

  enqueue(job: FileJob): void {
    this.queue.push(job);

    logger.info(
      `[FileWorker] Job queued: ${job.jobId} | file=${job.fileId} | queueSize=${this.queue.length}`
    );

    this.processQueue();
  }

  private processQueue(): void {
    if (!this.isRunning) return;

    while (
      this.activeJobs < this.maxConcurrentJobs &&
      this.queue.length > 0
    ) {
      const job = this.queue.shift();

      if (!job) return;

      this.activeJobs++;

      logger.info(
        `[FileWorker] Starting job ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`
      );

      this.processJob(job)
        .catch((error) => {
          logger.error(
            `[FileWorker] Job failed: ${job.jobId}`,
            error
          );
        })
        .finally(() => {
          this.activeJobs--;

          logger.info(
            `[FileWorker] Job finished: ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`
          );

          this.processQueue();
        });
    }
  }

  private async processJob(job: FileJob): Promise<void> {
    logger.info(
      `[FileWorker] Processing file ${job.fileId} from ${job.filePath}`
    );

    await processorService.processFile(
      job.fileId,
      job.filePath,
      job.totalRows
    );
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs,
      queuedJobs: this.queue.length,
      maxConcurrentJobs: this.maxConcurrentJobs,
    };
  }
}

const maxConcurrentFiles =
  Number(process.env.MAX_CONCURRENT_FILES) || 3;

export const fileWorker = new FileWorker(maxConcurrentFiles);
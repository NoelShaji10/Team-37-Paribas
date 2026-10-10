"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileWorker = exports.FileWorker = void 0;
const logger_1 = require("../utils/logger");
const processor_1 = require("../services/processor");
class FileWorker {
    maxConcurrentJobs;
    activeJobs = 0;
    queue = [];
    isRunning = false;
    constructor(maxConcurrentJobs = 3) {
        this.maxConcurrentJobs = maxConcurrentJobs;
    }
    start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.logger.info(`[FileWorker] Worker pool started with concurrency=${this.maxConcurrentJobs}`);
        this.processQueue();
    }
    stop() {
        this.isRunning = false;
        logger_1.logger.info('[FileWorker] Worker pool stopped.');
    }
    enqueue(job) {
        this.queue.push(job);
        logger_1.logger.info(`[FileWorker] Job queued: ${job.jobId} | file=${job.fileId} | queueSize=${this.queue.length}`);
        this.processQueue();
    }
    processQueue() {
        if (!this.isRunning)
            return;
        while (this.activeJobs < this.maxConcurrentJobs &&
            this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job)
                return;
            this.activeJobs++;
            logger_1.logger.info(`[FileWorker] Starting job ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`);
            this.processJob(job)
                .catch((error) => {
                logger_1.logger.error(`[FileWorker] Job failed: ${job.jobId}`, error);
            })
                .finally(() => {
                this.activeJobs--;
                logger_1.logger.info(`[FileWorker] Job finished: ${job.jobId}. Active jobs: ${this.activeJobs}/${this.maxConcurrentJobs}`);
                this.processQueue();
            });
        }
    }
    async processJob(job) {
        logger_1.logger.info(`[FileWorker] Processing file ${job.fileId} from ${job.filePath}`);
        await processor_1.processorService.processFile(job.fileId, job.filePath, job.totalRows);
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
exports.FileWorker = FileWorker;
const maxConcurrentFiles = Number(process.env.MAX_CONCURRENT_FILES) || 3;
exports.fileWorker = new FileWorker(maxConcurrentFiles);

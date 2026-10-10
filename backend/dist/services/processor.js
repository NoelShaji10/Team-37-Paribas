"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processorService = exports.ProcessorService = void 0;
const fs_1 = __importDefault(require("fs"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const prisma_1 = require("../db/prisma");
const logger_1 = require("../utils/logger");
const socket_1 = require("../sockets/socket");
const validator_1 = require("./validator");
const loader_1 = require("./loader");
const mlClient_1 = require("./mlClient");
class ProcessorService {
    batchSize = 500;
    /**
     * Main processing entry point.
     *
     * QUEUED
     *   ↓
     * PROCESSING
     *   ↓
     * COMPLETED / NEEDS_REVIEW / FAILED
     */
    async processFile(fileId, filePath, _totalRows) {
        const startedAt = new Date();
        logger_1.logger.info(`[ProcessorService] Starting processing | fileId=${fileId}`);
        try {
            if (!fs_1.default.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }
            const fileStats = await fs_1.default.promises.stat(filePath);
            const fileSizeBytes = fileStats.size;
            // ------------------------------------------------
            // Mark as PROCESSING
            // ------------------------------------------------
            await prisma_1.prisma.processingFile.update({
                where: {
                    id: fileId,
                },
                data: {
                    status: 'PROCESSING',
                    startedAt,
                    progress: 0,
                    processedRows: 0,
                    successfulRows: 0,
                    failedRows: 0,
                    errorMessage: null,
                },
            });
            (0, socket_1.emitFileProgress)(fileId, 0, 'PROCESSING', {
                processedRows: 0,
                validRows: 0,
                rejectedRows: 0,
                anomalyCount: 0,
            });
            // ------------------------------------------------
            // Process CSV
            // ------------------------------------------------
            const stats = await this.streamAndProcessFile(fileId, filePath, fileSizeBytes);
            const completedAt = new Date();
            const actualDurationMs = completedAt.getTime() -
                startedAt.getTime();
            /**
             * If rejected rows exist,
             * send file to Resolution Centre.
             */
            const finalStatus = stats.rejectedRows > 0
                ? 'NEEDS_REVIEW'
                : 'COMPLETED';
            // ------------------------------------------------
            // Save final result
            // ------------------------------------------------
            await prisma_1.prisma.processingFile.update({
                where: {
                    id: fileId,
                },
                data: {
                    status: finalStatus,
                    progress: 100,
                    recordCount: stats.processedRows,
                    totalRows: stats.processedRows,
                    processedRows: stats.processedRows,
                    successfulRows: stats.validRows,
                    failedRows: stats.rejectedRows,
                    completedAt,
                    actualDurationMs,
                    errorMessage: null,
                },
            });
            (0, socket_1.emitFileProgress)(fileId, 100, finalStatus, {
                processedRows: stats.processedRows,
                validRows: stats.validRows,
                rejectedRows: stats.rejectedRows,
                anomalyCount: stats.anomalyCount,
                actualDurationMs,
            });
            logger_1.logger.info(`[ProcessorService] Completed | ` +
                `file=${fileId} | ` +
                `status=${finalStatus} | ` +
                `processed=${stats.processedRows} | ` +
                `valid=${stats.validRows} | ` +
                `rejected=${stats.rejectedRows} | ` +
                `anomalies=${stats.anomalyCount}`);
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Unknown processing error';
            const completedAt = new Date();
            const actualDurationMs = completedAt.getTime() -
                startedAt.getTime();
            logger_1.logger.error(`[ProcessorService] Failed | file=${fileId} | ${message}`);
            try {
                await prisma_1.prisma.processingFile.update({
                    where: {
                        id: fileId,
                    },
                    data: {
                        status: 'FAILED',
                        completedAt,
                        actualDurationMs,
                        errorMessage: message,
                    },
                });
            }
            catch (databaseError) {
                logger_1.logger.error(`[ProcessorService] Failed updating FAILED status | file=${fileId}`, databaseError);
            }
            (0, socket_1.emitFileProgress)(fileId, 0, 'FAILED', {
                error: message,
            });
            throw error;
        }
    }
    /**
     * Streams CSV instead of loading the whole file into RAM.
     */
    async streamAndProcessFile(fileId, filePath, fileSizeBytes) {
        return new Promise((resolve, reject) => {
            const stats = {
                processedRows: 0,
                validRows: 0,
                rejectedRows: 0,
                anomalyCount: 0,
            };
            let batch = [];
            /**
             * Makes sure batches from the same
             * file are processed sequentially.
             */
            let processing = Promise.resolve();
            const fileStream = fs_1.default.createReadStream(filePath);
            const csvStream = fileStream.pipe((0, csv_parser_1.default)({
                mapHeaders: ({ header, }) => header
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, '_'),
            }));
            csvStream.on('data', (record) => {
                csvStream.pause();
                batch.push(record);
                if (batch.length >=
                    this.batchSize) {
                    const currentBatch = batch;
                    batch = [];
                    processing =
                        processing
                            .then(() => this.processBatch(fileId, currentBatch, stats))
                            .then(() => this.updateProgress(fileId, fileStream.bytesRead, fileSizeBytes, stats))
                            .then(() => {
                            csvStream.resume();
                        })
                            .catch((error) => {
                            csvStream.destroy(error);
                        });
                }
                else {
                    csvStream.resume();
                }
            });
            csvStream.on('end', () => {
                processing
                    .then(async () => {
                    if (batch.length >
                        0) {
                        await this.processBatch(fileId, batch, stats);
                        await this.updateProgress(fileId, fileSizeBytes, fileSizeBytes, stats);
                    }
                    resolve(stats);
                })
                    .catch(reject);
            });
            csvStream.on('error', reject);
            fileStream.on('error', reject);
        });
    }
    /**
     * Process one batch of CSV records.
     */
    async processBatch(fileId, records, stats) {
        const validRecords = [];
        /**
         * Collect fault logs first,
         * then insert them in one DB call.
         */
        const faultLogs = [];
        for (const record of records) {
            stats.processedRows++;
            /**
             * +1 because CSV line 1 is header.
             *
             * First data row = CSV line 2.
             */
            const rowNumber = stats.processedRows + 1;
            // ----------------------------------------------
            // Validate row
            // ----------------------------------------------
            const validation = await validator_1.validatorService.validateRecord(record);
            // ----------------------------------------------
            // Invalid row
            // ----------------------------------------------
            if (!validation.isValid) {
                stats.rejectedRows++;
                logger_1.logger.debug(`[ProcessorService] Rejected | ` +
                    `file=${fileId} | ` +
                    `row=${rowNumber} | ` +
                    `errors=${validation.errors.join(', ')}`);
                /**
                 * One row may contain multiple problems.
                 *
                 * Example:
                 * bad IFSC + invalid currency
                 *
                 * Therefore we create one FaultLog
                 * per validation issue.
                 */
                for (const issue of validation.issues) {
                    faultLogs.push({
                        fileId,
                        rowNumber,
                        columnName: issue.columnName,
                        cellValue: issue.cellValue ??
                            null,
                        errorMessage: issue.errorMessage,
                        errorType: issue.errorType,
                        rawRowData: record,
                        status: 'PENDING',
                    });
                }
                continue;
            }
            // ----------------------------------------------
            // Valid row
            // ----------------------------------------------
            stats.validRows++;
            /**
             * Sample every 100th valid row for
             * ML anomaly checking.
             */
            if (stats.validRows %
                100 ===
                0) {
                try {
                    const anomaly = await mlClient_1.mlClient.checkAnomaly(fileId, record);
                    if (anomaly.isAnomaly) {
                        stats.anomalyCount++;
                        await prisma_1.prisma.anomaly.create({
                            data: {
                                fileId,
                                rowNumber,
                                anomalyType: 'ML_DETECTED',
                                description: 'Potential anomaly detected by ML service',
                                details: record,
                            },
                        });
                        logger_1.logger.info(`[ProcessorService] Anomaly detected | file=${fileId} | row=${rowNumber}`);
                    }
                }
                catch (error) {
                    /**
                     * ML failure should NOT stop
                     * core file processing.
                     */
                    logger_1.logger.warn(`[ProcessorService] ML anomaly check failed | file=${fileId} | row=${rowNumber}`);
                }
            }
            validRecords.push(record);
        }
        // ------------------------------------------------
        // Save rejected rows
        // ------------------------------------------------
        if (faultLogs.length >
            0) {
            await prisma_1.prisma.faultLog.createMany({
                data: faultLogs,
            });
            logger_1.logger.info(`[ProcessorService] Saved ${faultLogs.length} fault logs | file=${fileId}`);
        }
        // ------------------------------------------------
        // Save valid records
        // ------------------------------------------------
        if (validRecords.length >
            0) {
            await loader_1.loaderService.loadValidRecords(fileId, validRecords);
        }
    }
    /**
     * Save progress to DB and push it through Socket.IO.
     */
    async updateProgress(fileId, bytesRead, totalBytes, stats) {
        let progress = 0;
        if (totalBytes > 0) {
            progress =
                Math.floor((bytesRead /
                    totalBytes) *
                    100);
        }
        /**
         * 100% is reserved for
         * successful final completion.
         */
        progress =
            Math.min(progress, 99);
        await prisma_1.prisma.processingFile.update({
            where: {
                id: fileId,
            },
            data: {
                progress,
                processedRows: stats.processedRows,
                successfulRows: stats.validRows,
                failedRows: stats.rejectedRows,
            },
        });
        (0, socket_1.emitFileProgress)(fileId, progress, 'PROCESSING', {
            processedRows: stats.processedRows,
            validRows: stats.validRows,
            rejectedRows: stats.rejectedRows,
            anomalyCount: stats.anomalyCount,
        });
    }
}
exports.ProcessorService = ProcessorService;
exports.processorService = new ProcessorService();

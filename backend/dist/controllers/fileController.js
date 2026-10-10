"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileById = exports.getFiles = exports.uploadFile = void 0;
const prisma_1 = require("../db/prisma");
const logger_1 = require("../utils/logger");
const ingestion_1 = require("../services/ingestion");
const fileWorker_1 = require("../workers/fileWorker");
const socket_1 = require("../sockets/socket");
/**
 * Helper because Prisma BigInt cannot be JSON-stringified directly.
 */
function serializeFile(file) {
    return {
        ...file,
        sizeBytes: file.sizeBytes.toString(),
    };
}
/**
 * POST /api/files/upload
 */
const uploadFile = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({
                success: false,
                message: 'No file uploaded',
            });
            return;
        }
        logger_1.logger.info(`[FileController] Received file: ${file.originalname}`);
        const ingestionResult = await ingestion_1.ingestionService.ingestFile(file.path, file.originalname);
        const jobId = `job_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 8)}`;
        fileWorker_1.fileWorker.enqueue({
            jobId,
            fileId: ingestionResult.fileId,
            filePath: file.path,
        });
        (0, socket_1.emitFileProgress)(ingestionResult.fileId, 0, 'QUEUED', {
            fileName: file.originalname,
            jobId,
        });
        logger_1.logger.info(`[FileController] File queued | fileId=${ingestionResult.fileId} | jobId=${jobId}`);
        res.status(202).json({
            success: true,
            message: 'File accepted and queued for processing',
            data: {
                fileId: ingestionResult.fileId,
                jobId,
                fileName: file.originalname,
                fileType: ingestionResult.fileType,
                status: 'QUEUED',
            },
        });
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : 'Failed to ingest file';
        logger_1.logger.error('[FileController] uploadFile error:', error);
        /**
         * Duplicate / invalid file errors are client-side problems,
         * not backend crashes.
         */
        if (message.includes('Duplicate file') ||
            message.includes('Unsupported file format') ||
            message.includes('Unable to determine file type') ||
            message.includes('empty')) {
            res.status(400).json({
                success: false,
                message,
            });
            return;
        }
        res.status(500).json({
            success: false,
            message,
        });
    }
};
exports.uploadFile = uploadFile;
/**
 * GET /api/files
 *
 * Returns all processing files for dashboard.
 */
const getFiles = async (_req, res) => {
    try {
        const files = await prisma_1.prisma.processingFile.findMany({
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                _count: {
                    select: {
                        faultLogs: true,
                        anomalies: true,
                    },
                },
            },
        });
        const serializedFiles = files.map((file) => serializeFile(file));
        res.status(200).json({
            success: true,
            data: serializedFiles,
        });
    }
    catch (error) {
        logger_1.logger.error('[FileController] getFiles error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch files',
        });
    }
};
exports.getFiles = getFiles;
/**
 * GET /api/files/:id
 *
 * Returns one file with rejection + anomaly details.
 */
const getFileById = async (req, res) => {
    try {
        const { id } = req.params;
        const file = await prisma_1.prisma.processingFile.findUnique({
            where: {
                id,
            },
            include: {
                faultLogs: {
                    orderBy: {
                        rowNumber: 'asc',
                    },
                },
                anomalies: {
                    orderBy: {
                        createdAt: 'desc',
                    },
                },
                _count: {
                    select: {
                        accounts: true,
                        bankTransactions: true,
                        payments: true,
                        rates: true,
                    },
                },
            },
        });
        if (!file) {
            res.status(404).json({
                success: false,
                message: 'File not found',
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: serializeFile(file),
        });
    }
    catch (error) {
        logger_1.logger.error('[FileController] getFileById error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch file',
        });
    }
};
exports.getFileById = getFileById;

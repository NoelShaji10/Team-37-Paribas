import { Request, Response } from 'express';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { ingestionService } from '../services/ingestion';
import { fileWorker } from '../workers/fileWorker';
import { emitFileProgress } from '../sockets/socket';

/**
 * Helper because Prisma BigInt cannot be JSON-stringified directly.
 */
function serializeFile<T extends { sizeBytes: bigint }>(file: T) {
  return {
    ...file,
    sizeBytes: file.sizeBytes.toString(),
  };
}

/**
 * POST /api/files/upload
 */
export const uploadFile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
      return;
    }

    logger.info(
      `[FileController] Received file: ${file.originalname}`
    );

    const ingestionResult =
      await ingestionService.ingestFile(
        file.path,
        file.originalname
      );

    const jobId = `job_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 8)}`;

    fileWorker.enqueue({
      jobId,
      fileId: ingestionResult.fileId,
      filePath: file.path,
    });

    emitFileProgress(
      ingestionResult.fileId,
      0,
      'QUEUED',
      {
        fileName: file.originalname,
        jobId,
      }
    );

    logger.info(
      `[FileController] File queued | fileId=${ingestionResult.fileId} | jobId=${jobId}`
    );

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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to ingest file';

    logger.error(
      '[FileController] uploadFile error:',
      error
    );

    /**
     * Duplicate / invalid file errors are client-side problems,
     * not backend crashes.
     */
    if (
      message.includes('Duplicate file') ||
      message.includes('Unsupported file format') ||
      message.includes('Unable to determine file type') ||
      message.includes('empty')
    ) {
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

/**
 * GET /api/files
 *
 * Returns all processing files for dashboard.
 */
export const getFiles = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const files =
      await prisma.processingFile.findMany({
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

    const serializedFiles =
      files.map((file) => serializeFile(file));

    res.status(200).json({
      success: true,
      data: serializedFiles,
    });
  } catch (error) {
    logger.error(
      '[FileController] getFiles error:',
      error
    );

    res.status(500).json({
      success: false,
      message: 'Failed to fetch files',
    });
  }
};

/**
 * GET /api/files/:id
 *
 * Returns one file with rejection + anomaly details.
 */
export const getFileById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const file =
      await prisma.processingFile.findUnique({
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
  } catch (error) {
    logger.error(
      '[FileController] getFileById error:',
      error
    );

    res.status(500).json({
      success: false,
      message: 'Failed to fetch file',
    });
  }
};
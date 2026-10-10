import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ingestionService } from '../services/ingestion';
import { fileWorker } from '../workers/fileWorker';
import { emitFileProgress } from '../sockets/socket';

/**
 * POST /api/files/upload
 *
 * Receives a file from Multer, registers it through the ingestion service,
 * and places it into the concurrent worker queue.
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

    // Ingestion layer creates the initial file/job information.
    const ingestionResult = await ingestionService.ingestFile(
      file.path,
      file.originalname
    );

    const jobId = `job_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 8)}`;

    // Put file into worker pool.
    fileWorker.enqueue({
      jobId,
      fileId: ingestionResult.fileId,
      filePath: file.path,
    });

    // Notify connected dashboard clients.
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

    // Return immediately.
    // Actual processing continues in the background worker pool.
    res.status(202).json({
      success: true,
      message: 'File accepted and queued for processing',
      data: {
        fileId: ingestionResult.fileId,
        jobId,
        fileName: file.originalname,
        status: 'QUEUED',
      },
    });
  } catch (error) {
    logger.error(
      '[FileController] uploadFile error:',
      error
    );

    res.status(500).json({
      success: false,
      message: 'Failed to ingest file',
    });
  }
};


/**
 * GET /api/files
 *
 * Temporary response until Prisma/database integration is ready.
 */
export const getFiles = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    /**
     * This will later become something like:
     *
     * const files = await prisma.file.findMany({
     *   orderBy: { createdAt: 'desc' }
     * });
     */

    res.status(200).json({
      success: true,
      data: [],
      message: 'Database integration pending',
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
 * Temporary response until Prisma/database integration is ready.
 */
export const getFileById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    /**
     * Later:
     *
     * const file = await prisma.file.findUnique({
     *   where: { id },
     *   include: {
     *     processingRuns: true,
     *     validationIssues: true,
     *     anomalies: true,
     *   }
     * });
     */

    res.status(200).json({
      success: true,
      data: {
        id,
      },
      message: 'Database integration pending',
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
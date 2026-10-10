import { Request, Response } from 'express';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { fileWorker } from '../workers/fileWorker';

/**
 * GET /api/dashboard/summary
 *
 * Returns live dashboard statistics from PostgreSQL.
 */
export const getDashboardSummary = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const [
      totalFiles,
      queuedFiles,
      activeProcessing,
      completedFiles,
      failedFiles,
      needsReviewFiles,
      totalRejections,
      pendingRejections,
      totalAnomalies,
      processingStats,
    ] = await Promise.all([
      // Total uploaded files
      prisma.processingFile.count(),

      // Queued
      prisma.processingFile.count({
        where: {
          status: 'QUEUED',
        },
      }),

      // Currently processing
      prisma.processingFile.count({
        where: {
          status: 'PROCESSING',
        },
      }),

      // Completed
      prisma.processingFile.count({
        where: {
          status: 'COMPLETED',
        },
      }),

      // Failed
      prisma.processingFile.count({
        where: {
          status: 'FAILED',
        },
      }),

      // Needs manual review
      prisma.processingFile.count({
        where: {
          status: 'NEEDS_REVIEW',
        },
      }),

      // All validation/rejection issues
      prisma.faultLog.count(),

      // Issues waiting for manual resolution
      prisma.faultLog.count({
        where: {
          status: 'PENDING',
        },
      }),

      // Total anomalies detected
      prisma.anomaly.count(),

      // Used to calculate approximate throughput
      prisma.processingFile.aggregate({
        where: {
          status: {
            in: [
              'COMPLETED',
              'NEEDS_REVIEW',
            ],
          },
        },

        _sum: {
          successfulRows: true,
          actualDurationMs: true,
        },

        _avg: {
          actualDurationMs: true,
        },
      }),
    ]);

    // ------------------------------------------------
    // Approximate processing throughput
    // ------------------------------------------------

    const successfulRows =
      processingStats._sum.successfulRows ?? 0;

    const totalDurationMs =
      processingStats._sum.actualDurationMs ?? 0;

    let systemThroughput = 0;

    if (totalDurationMs > 0) {
      systemThroughput = Math.round(
        successfulRows /
          (totalDurationMs / 1000)
      );
    }

    const averageProcessingTimeMs =
      Math.round(
        processingStats._avg
          .actualDurationMs ?? 0
      );

    // Current in-memory worker status
    const workerStats =
      fileWorker.getStats();

    const summary = {
      totalFiles,

      queuedFiles,

      activeProcessing,

      completedFiles,

      failedFiles,

      needsReviewFiles,

      totalRejections,

      pendingRejections,

      totalAnomalies,

      systemThroughput,

      averageProcessingTimeMs,

      worker: {
        activeJobs:
          workerStats.activeJobs,

        queuedJobs:
          workerStats.queuedJobs,

        maxConcurrentJobs:
          workerStats.maxConcurrentJobs,

        isRunning:
          workerStats.isRunning,
      },
    };

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error(
      '[DashboardController] getDashboardSummary error:',
      error
    );

    res.status(500).json({
      success: false,
      message:
        'Failed to fetch dashboard summary',
    });
  }
};
import { Router, Request, Response } from 'express';

import { fileWorker } from '../workers/fileWorker';
import { logger } from '../utils/logger';

const MIN = 1;
const MAX = 20;

const router = Router();

router.get('/worker', (_req: Request, res: Response) => {
  res.json({ success: true, data: fileWorker.getStats() });
});

router.put('/worker', (req: Request, res: Response) => {
  const value = Number(req.body?.maxConcurrentFiles);

  if (!Number.isInteger(value) || value < MIN || value > MAX) {
    res.status(400).json({
      success: false,
      message: `maxConcurrentFiles must be a whole number from ${MIN} to ${MAX}`,
    });
    return;
  }

  // Old fileWorker.ts has no setConcurrency(): say so clearly instead of a bare 500
  if (typeof (fileWorker as any).setConcurrency !== 'function') {
    const message =
      'backend/src/workers/fileWorker.ts is the old version (no setConcurrency). Replace it with the new file and restart the backend.';
    logger.error(`[Settings] ${message}`);
    res.status(500).json({ success: false, message });
    return;
  }

  try {
    fileWorker.setConcurrency(value);
    res.json({ success: true, data: fileWorker.getStats() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Settings] Failed to update concurrency: ${message}`, error);
    res.status(500).json({ success: false, message });
  }
});

export default router;
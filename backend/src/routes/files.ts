import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';

import {
  uploadFile,
  getFiles,
  getFileById,
} from '../controllers/fileController';

const router = Router();

const uploadDirectory = path.join(
  __dirname,
  '../../uploads'
);

// Default: 2 GB
// Can be changed from .env
const MAX_UPLOAD_SIZE_MB =
  Number(process.env.MAX_UPLOAD_SIZE_MB) || 2048;

const upload = multer({
  dest: uploadDirectory,

  limits: {
    fileSize:
      MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
});

/**
 * Multer upload middleware with proper error handling.
 */
const handleUpload = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          message: `File exceeds maximum upload size of ${MAX_UPLOAD_SIZE_MB} MB`,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }

    if (error) {
      res.status(500).json({
        success: false,
        message: 'File upload failed',
      });
      return;
    }

    next();
  });
};

// External file-ingestion endpoint
router.post(
  '/upload',
  handleUpload,
  uploadFile
);

// Monitoring endpoints
router.get('/', getFiles);
router.get('/:id', getFileById);

export default router;
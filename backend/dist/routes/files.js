"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fileController_1 = require("../controllers/fileController");
const router = (0, express_1.Router)();
const uploadDirectory = path_1.default.join(__dirname, '../../uploads');
// Default: 2 GB
// Can be changed from .env
const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 2048;
const upload = (0, multer_1.default)({
    dest: uploadDirectory,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        files: 1,
    },
});
/**
 * Multer upload middleware with proper error handling.
 */
const handleUpload = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (error instanceof multer_1.default.MulterError) {
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
router.post('/upload', handleUpload, fileController_1.uploadFile);
// Monitoring endpoints
router.get('/', fileController_1.getFiles);
router.get('/:id', fileController_1.getFileById);
exports.default = router;

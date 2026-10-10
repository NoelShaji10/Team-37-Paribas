"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = __importDefault(require("http"));
const files_1 = __importDefault(require("./routes/files"));
const socket_1 = require("./sockets/socket");
const logger_1 = require("./utils/logger");
const fileWorker_1 = require("./workers/fileWorker");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// Middleware
app.use((0, cors_1.default)({
    origin: [
        CLIENT_ORIGIN,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ],
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Socket.IO
(0, socket_1.initSocket)(server);
// Start file worker pool
fileWorker_1.fileWorker.start();
// Health check
app.get('/health', (_req, res) => {
    res.status(200).json({
        success: true,
        message: 'Backend is running',
        timestamp: new Date().toISOString(),
    });
});
// API routes
app.use('/api/files', files_1.default);
// 404
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
    });
});
// Global error handler
app.use((error, _req, res, _next) => {
    logger_1.logger.error('[Server] Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
    });
});
server.listen(PORT, () => {
    logger_1.logger.info(`[Server] Backend running on http://localhost:${PORT}`);
});

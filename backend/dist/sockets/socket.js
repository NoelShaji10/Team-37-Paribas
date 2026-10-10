"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.getIO = getIO;
exports.emitFileProgress = emitFileProgress;
exports.emitDashboardAlert = emitDashboardAlert;
const socket_io_1 = require("socket.io");
const logger_1 = require("../utils/logger");
let io = null;
function initSocket(server) {
    const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    io = new socket_io_1.Server(server, {
        cors: {
            origin: [allowedOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'],
            methods: ['GET', 'POST'],
            credentials: true
        }
    });
    io.on('connection', (socket) => {
        logger_1.logger.info(`[Socket.IO] Client connected: ${socket.id}`);
        socket.on('subscribe_file', (fileId) => {
            socket.join(`file:${fileId}`);
            logger_1.logger.info(`[Socket.IO] Client ${socket.id} subscribed to file:${fileId}`);
        });
        socket.on('disconnect', () => {
            logger_1.logger.info(`[Socket.IO] Client disconnected: ${socket.id}`);
        });
    });
    return io;
}
function getIO() {
    if (!io) {
        throw new Error('Socket.IO has not been initialized. Call initSocket(server) first.');
    }
    return io;
}
function emitFileProgress(fileId, progress, status, extra = {}) {
    if (io) {
        io.emit('file_progress', { fileId, progress, status, ...extra });
        io.to(`file:${fileId}`).emit('file_detail_update', { fileId, progress, status, ...extra });
    }
}
function emitDashboardAlert(type, message, payload = {}) {
    if (io) {
        io.emit('dashboard_alert', { type, message, payload, timestamp: new Date().toISOString() });
    }
}

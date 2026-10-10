import dashboardRoutes from './routes/dashboard';
import resolutionRoutes from './routes/resolutions';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';

import fileRoutes from './routes/files';
import { initSocket } from './sockets/socket';
import { logger } from './utils/logger';
import { fileWorker } from './workers/fileWorker';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Middleware
app.use(
  cors({
    origin: [
      CLIENT_ORIGIN,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Socket.IO
initSocket(server);

// Start file worker pool
fileWorker.start();

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Backend is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/files', fileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/resolutions', resolutionRoutes);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Global error handler
app.use(
  (
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    logger.error('[Server] Unhandled error:', error);

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
);

server.listen(PORT, () => {
  logger.info(`[Server] Backend running on http://localhost:${PORT}`);
});
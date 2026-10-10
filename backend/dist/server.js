import express from "express";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";

import fileRoutes from "./routes/files";
import dashboardRoutes from "./routes/dashboard";
import resolutionRoutes from "./routes/resolutions";
import analyticsRoutes from "./routes/analytics";
import { initializeSocket } from "./sockets/socket";

dotenv.config();

const app = express();
const server = http.createServer(app);
initializeSocket(server, FRONTEND_URL);

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is running",
  });
});

// Routes
app.use("/api/files", fileRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/resolutions", resolutionRoutes);
app.use("/api/analytics", analyticsRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
);

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
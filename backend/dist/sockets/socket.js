import { Server } from "socket.io";
import http from "http";

let io: Server | null = null;

export const initializeSocket = (
  server: http.Server,
  frontendUrl: string
): Server => {
  io = new Server(server, {
    cors: {
      origin: frontendUrl,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized");
  }

  return io;
};

export const emitFileQueued = (fileId: string) => {
  getIO().emit("file:queued", {
    fileId,
    status: "QUEUED",
  });
};

export const emitFileProgress = (
  fileId: string,
  progress: number,
  status: string = "PROCESSING"
) => {
  getIO().emit("file:progress", {
    fileId,
    progress,
    status,
  });
};

export const emitFileCompleted = (fileId: string) => {
  getIO().emit("file:completed", {
    fileId,
    progress: 100,
    status: "SUCCESS",
  });
};

export const emitFileFailed = (
  fileId: string,
  error: string
) => {
  getIO().emit("file:failed", {
    fileId,
    status: "FAILED",
    error,
  });
};

export const emitAnomalyDetected = (
  fileId: string,
  anomalyCount: number
) => {
  getIO().emit("file:anomaly", {
    fileId,
    anomalyCount,
  });
};
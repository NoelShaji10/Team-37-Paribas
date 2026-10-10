export type FileStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEEDS_REVIEW';

export type FileType =
  | 'PAYMENTS'
  | 'BANK_TRANSACTIONS'
  | 'ACCOUNTS'
  | 'RATES';

export interface DashboardWorkerStats {
  activeJobs: number;
  queuedJobs: number;
  maxConcurrentJobs: number;
  isRunning: boolean;
}

export interface FileTypeStat {
  type: string;
  files: number;
}

export interface ProcessingTimePoint {
  time: string;
  actual: number | null;
  predicted: number | null;
}

export interface DashboardRecentFile {
  fileName: string;
  originalName: string;
  fileType: FileType;
  status: FileStatus;
  sizeBytes: number;
  progress: number;
  predictedDurationMs: number | null;
  actualDurationMs: number | null;
  receivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  successfulRows: number;
  failedRows: number;
  anomaliesCount: number;
  faultLogsCount: number;
}

export interface DashboardSummary {
  totalFiles: number;
  queuedFiles: number;
  activeProcessing: number;
  completedFiles: number;
  failedFiles: number;
  needsReviewFiles: number;
  totalRejections: number;
  pendingRejections: number;
  totalAnomalies: number;
  systemThroughput: number;
  averageProcessingTimeMs: number;
  worker: DashboardWorkerStats;
  fileTypeStats: FileTypeStat[];
  recentFiles: DashboardRecentFile[];
  processingTimeHistory: ProcessingTimePoint[];
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

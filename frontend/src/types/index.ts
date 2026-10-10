// Shapes returned by the backend (backend/src/controllers) and the ML service.

export type FileStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW";
export type FileType = "PAYMENTS" | "BANK_TRANSACTIONS" | "ACCOUNTS" | "RATES";

export interface ProcessingFile {
  id: string;
  fileName: string;
  originalName: string | null;
  fileType: FileType;
  status: FileStatus;
  sizeBytes: string; // BigInt serialised as a string
  progress: number;
  recordCount: number | null;
  totalRows: number;
  processedRows: number;
  successfulRows: number;
  failedRows: number;
  predictedDurationMs: number | null;
  actualDurationMs: number | null;
  errorMessage: string | null;
  receivedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  _count?: { faultLogs?: number; anomalies?: number };
}

export interface AnomalyDetails {
  ruleRef?: string; // workbook ID, e.g. T-N14
  method?: string; // RULE | ROBUST_Z | SIGMA_Z | IFOREST
  level?: "RECORD" | "FILE";
}

export interface Anomaly {
  id: string;
  fileId: string;
  rowNumber: number | null;
  anomalyType: string;
  description: string | null;
  score: number | null;
  details: AnomalyDetails | null;
  reviewed: boolean;
  createdAt: string;
}

export interface FaultLog {
  id: string;
  rowNumber: number;
  columnName: string | null;
  cellValue: string | null;
  errorMessage: string;
  errorType: string | null;
  status: string;
  aiSuggestion?: string | null;
  aiConfidence?: number | null;
}

export interface FileDetail extends ProcessingFile {
  anomalies: Anomaly[];
  faultLogs: FaultLog[];
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
  systemThroughput?: number;
  averageProcessingTimeMs: number;
  worker?: { activeJobs: number; queuedJobs: number; maxConcurrentJobs: number; isRunning: boolean };
}

export interface ModelStatus {
  rows: number;
  fitted_at: string;
  version: string;
  sklearn_trained?: string | null;
  sklearn_runtime?: string;
  sklearn_mismatch?: boolean;
}

// Display helpers shared by the pages
export const TYPE_LABEL: Record<FileType, string> = {
  PAYMENTS: "Payments",
  BANK_TRANSACTIONS: "Bank Transactions",
  ACCOUNTS: "Accounts",
  RATES: "Rates",
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  NEEDS_REVIEW: "Needs Review",
};

export function statusClass(status: FileStatus): string {
  return STATUS_LABEL[status].toLowerCase().replace(" ", "-");
}

export function formatBytes(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

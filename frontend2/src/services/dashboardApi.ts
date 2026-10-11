const API_BASE =
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000/api";

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

  worker: {
    activeJobs: number;
    queuedJobs: number;
    maxConcurrentJobs: number;
    isRunning: boolean;
  };
}

export interface DashboardFile {
  id: string;

  fileName: string;
  originalName?: string | null;

  fileType:
    | "PAYMENTS"
    | "BANK_TRANSACTIONS"
    | "ACCOUNTS"
    | "RATES";

  status:
    | "QUEUED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "NEEDS_REVIEW";

  sizeBytes: string;

  progress: number;

  recordCount?: number | null;
  totalRows: number;
  processedRows: number;
  successfulRows: number;
  failedRows: number;

  predictedDurationMs?: number | null;
  actualDurationMs?: number | null;

  receivedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;

  _count: {
    faultLogs: number;
    anomalies: number;
  };
}

async function readResponse(response: Response) {
  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.message || "Backend request failed"
    );
  }

  return result.data;
}

export async function getDashboardSummary():
  Promise<DashboardSummary> {
  const response = await fetch(
    `${API_BASE}/dashboard/summary`
  );

  return readResponse(response);
}

export function subscribeDashboardSummary(
  onUpdate: (data: DashboardSummary) => void
): () => void {
  const eventSource = new EventSource(
    `${API_BASE}/dashboard/summarySSE`
  );

  eventSource.addEventListener('dashboard-summary', (event) => {
    try {
      const response = JSON.parse(
        (event as MessageEvent).data
      );

      if (response.success && response.data) {
        onUpdate(response.data as DashboardSummary);
      }
    } catch (error) {
      console.error('Failed to parse dashboard SSE:', error);
    }
  });

  eventSource.onerror = (error) => {
    console.error('Dashboard SSE connection error:', error);
  };

  return () => {
    eventSource.close();
  };
}

export async function getDashboardFiles():
  Promise<DashboardFile[]> {
  const response = await fetch(
    `${API_BASE}/files`
  );

  return readResponse(response);
}

export async function getDashboardData() {
  const [summary, files] =
    await Promise.all([
      getDashboardSummary(),
      getDashboardFiles(),
    ]);

  return {
    summary,
    files,
  };
}
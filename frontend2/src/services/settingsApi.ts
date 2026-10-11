const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export interface WorkerStats {
  isRunning: boolean;
  activeJobs: number;
  queuedJobs: number;
  maxConcurrentJobs: number;
  minConcurrency: number;
  maxConcurrency: number;
}

async function parse(response: Response): Promise<WorkerStats> {
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(
      body?.message || `Request failed with status ${response.status}`
    );
  }

  return body.data as WorkerStats;
}

export async function getWorkerSettings(): Promise<WorkerStats> {
  return parse(await fetch(`${API_BASE}/settings/worker`));
}

export async function updateWorkerConcurrency(
  maxConcurrentFiles: number
): Promise<WorkerStats> {
  return parse(
    await fetch(`${API_BASE}/settings/worker`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrentFiles }),
    })
  );
}
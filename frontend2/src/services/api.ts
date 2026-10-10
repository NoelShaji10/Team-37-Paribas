// All calls from the UI to the backend (port 5000) and the ML service (port 8000).
import type { DashboardSummary, FileDetail, ModelStatus, PendingRejection, PredictionStatus, ProcessingFile } from "../types";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:5000";
export const ML_URL: string = import.meta.env.VITE_ML_URL ?? "http://localhost:8000";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return (body.data ?? body) as T;
}

export const api = {
  files: () => getJson<ProcessingFile[]>(`${API_URL}/api/files`),

  file: (id: string) => getJson<FileDetail>(`${API_URL}/api/files/${id}`),

  summary: () => getJson<DashboardSummary>(`${API_URL}/api/dashboard/summary`),

  modelStatus: () => getJson<Record<string, ModelStatus | null>>(`${ML_URL}/anomaly/status`),

  predictionStatus: () => getJson<PredictionStatus>(`${ML_URL}/prediction/status`),

  pendingRejections: () => getJson<PendingRejection[]>(`${API_URL}/api/resolutions/pending`),

  async resolve(id: string, action: "APPROVE" | "EDIT" | "REJECT", correctedValue?: string) {
    const response = await fetch(`${API_URL}/api/resolutions/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, correctedValue, reviewedBy: "operator" }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) throw new Error(body.message ?? `Resolve failed (${response.status})`);
    return body.data;
  },

  async upload(file: File): Promise<{ fileId: string; fileName: string; fileType: string }> {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_URL}/api/files/upload`, { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      throw new Error(body.message ?? `Upload failed (${response.status})`);
    }
    return body.data;
  },
};

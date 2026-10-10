import type { ApiResponse, DashboardSummary, DashboardRecentFile } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetch(`${API_BASE_URL}/dashboard/summary`);
  if (!response.ok) {
    throw new Error(`Dashboard API error: ${response.status} ${response.statusText}`);
  }
  const result: ApiResponse<DashboardSummary> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.message || 'Invalid response from dashboard summary endpoint');
  }
  return result.data;
}

export async function fetchFiles(): Promise<DashboardRecentFile[]> {
  const response = await fetch(`${API_BASE_URL}/files`);
  if (!response.ok) {
    throw new Error(`Files API error: ${response.status} ${response.statusText}`);
  }
  const result: ApiResponse<DashboardRecentFile[]> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.message || 'Invalid response from files endpoint');
  }
  return result.data;
}

export async function uploadFile(file: File): Promise<{ fileId: string; jobId: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/files/upload`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || 'File upload failed');
  }
  return result.data;
}

export { API_BASE_URL };

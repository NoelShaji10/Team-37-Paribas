// Keeps the file list and dashboard summary fresh. Polls every 2 s while anything is
// queued or processing, every 8 s when idle (no extra libraries needed).
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../services/api";
import type { DashboardSummary, ProcessingFile } from "../types";

export function useRealtimeFiles() {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const [fileList, dashboard] = await Promise.all([api.files(), api.summary()]);
      setFiles(fileList);
      setSummary(dashboard);
      setError(null);
      return fileList.some((f) => f.status === "QUEUED" || f.status === "PROCESSING");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend not reachable");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      const busy = await refresh();
      if (!cancelled) timer.current = window.setTimeout(loop, busy ? 2000 : 8000);
    };
    loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, [refresh]);

  return { files, summary, error, loading, refresh };
}

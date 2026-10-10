import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Database,
} from "lucide-react";

import AnomalyPanel from "../components/AnomalyPanel";
import { api } from "../services/api";
import type { FileDetail } from "../types";
import { STATUS_LABEL, TYPE_LABEL, formatBytes, formatMs, statusClass } from "../types";

interface FileDetailsProps {
  onBack: () => void;
  fileId?: string | null;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function FileDetails({ onBack, fileId }: FileDetailsProps) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const detail = await api.file(fileId);
        if (cancelled) return;
        setFile(detail);
        setError(null);
        if (detail.status === "QUEUED" || detail.status === "PROCESSING") {
          timer = window.setTimeout(load, 2000); // keep refreshing until finished
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load file");
      }
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileId]);

  const heading = (
    <div className="page-heading">
      <button className="secondary-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to Dashboard
      </button>
      <h1>File Details</h1>
      <p>Processing information, Layer 1 rejections and Layer 2 anomalies.</p>
    </div>
  );

  if (!fileId) {
    return (
      <div className="file-details-page">
        {heading}
        <section className="details-panel">
          <p>Select a file in Recent Files on the Dashboard to see its details.</p>
        </section>
      </div>
    );
  }
  if (error) {
    return (
      <div className="file-details-page">
        {heading}
        <section className="details-panel"><p>{error}</p></section>
      </div>
    );
  }
  if (!file) {
    return (
      <div className="file-details-page">
        {heading}
        <section className="details-panel"><p>Loading…</p></section>
      </div>
    );
  }

  const rejectionsByType = new Map<string, number>();
  for (const f of file.faultLogs) {
    const k = f.errorType ?? f.columnName ?? "Other";
    rejectionsByType.set(k, (rejectionsByType.get(k) ?? 0) + 1);
  }

  return (
    <div className="file-details-page">
      {heading}

      <section className="details-file-card">
        <div className="details-file-icon">
          <FileText size={26} />
        </div>
        <div className="details-file-name">
          <h2>{file.originalName ?? file.fileName}</h2>
          <p>{file.id}</p>
        </div>
        <span className={`status-badge ${statusClass(file.status)}`}>
          <CheckCircle2 size={14} />
          {STATUS_LABEL[file.status]}
        </span>
      </section>

      <section className="details-grid">
        <div className="details-card">
          <span>File Size</span>
          <strong>{formatBytes(file.sizeBytes)}</strong>
        </div>
        <div className="details-card">
          <span>Processed Records</span>
          <strong>{file.processedRows.toLocaleString()}</strong>
        </div>
        <div className="details-card">
          <span>Rejected Records (Layer 1)</span>
          <strong>{file.failedRows.toLocaleString()}</strong>
        </div>
        <div className="details-card">
          <span>Anomaly Flags (Layer 2)</span>
          <strong>{file.anomalies.length.toLocaleString()}</strong>
        </div>
      </section>

      <section className="details-panel">
        <h2>Processing Progress</h2>
        <div className="details-progress-label">
          <span>{Math.round(file.progress)}% complete</span>
          <span>
            Actual {formatMs(file.actualDurationMs)} · Predicted {formatMs(file.predictedDurationMs)}
          </span>
        </div>
        <div className="details-progress-track">
          <div className="details-progress-fill" style={{ width: `${file.progress}%` }} />
        </div>
      </section>

      <AnomalyPanel anomalies={file.anomalies} />

      <section className="details-panel">
        <div className="details-section-heading">
          <h2>Layer 1: Rejections ({file.faultLogs.length.toLocaleString()} issues)</h2>
          <AlertTriangle size={20} />
        </div>
        {file.faultLogs.length === 0 ? (
          <p>No rejected records.</p>
        ) : (
          <div className="table-wrapper">
            <table className="file-table">
              <thead>
                <tr><th>Error type</th><th>Count</th></tr>
              </thead>
              <tbody>
                {[...rejectionsByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="details-panel">
        <h2>File Information</h2>
        <div className="details-info-grid">
          <div>
            <span>File Type</span>
            <strong>{TYPE_LABEL[file.fileType]}</strong>
          </div>
          <div>
            <span><Clock size={14} /> Uploaded At</span>
            <strong>{formatDate(file.receivedAt)}</strong>
          </div>
          <div>
            <span><Database size={14} /> Processing Started</span>
            <strong>{formatDate(file.startedAt)}</strong>
          </div>
          <div>
            <span><CheckCircle2 size={14} /> Processing Completed</span>
            <strong>{formatDate(file.completedAt)}</strong>
          </div>
        </div>
        {file.errorMessage && <div className="details-note">{file.errorMessage}</div>}
      </section>
    </div>
  );
}

export default FileDetails;

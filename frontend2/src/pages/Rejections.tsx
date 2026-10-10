import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Download,
  Search,
  ShieldAlert,
} from "lucide-react";

import { api } from "../services/api";
import type { PendingRejection } from "../types";

interface RejectionsProps {
  onBack: () => void;
}

const PAGE = 100;

export default function Rejections({ onBack }: RejectionsProps) {
  const [records, setRecords] = useState<PendingRejection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [errorType, setErrorType] = useState("All Error Types");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    api
      .pendingRejections()
      .then(setRecords)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load rejections"));
  }, []);

  const errorTypes = useMemo(
    () => [...new Set(records.map((r) => r.errorType ?? "OTHER"))].sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const text = `${r.file?.originalName ?? ""} ${r.columnName ?? ""} ${r.cellValue ?? ""} ${r.errorMessage}`.toLowerCase();
      return (!q || text.includes(q)) && (errorType === "All Error Types" || (r.errorType ?? "OTHER") === errorType);
    });
  }, [records, search, errorType]);

  const filesAffected = new Set(records.map((r) => r.fileId)).size;
  const withSuggestion = records.filter((r) => r.aiSuggestion).length;
  const topType = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of records) c.set(r.errorType ?? "OTHER", (c.get(r.errorType ?? "OTHER") ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [records]);

  const exportCsv = () => {
    const rows = [
      ["File", "Row", "Field", "Value", "Error type", "Reason", "AI suggestion", "AI confidence"],
      ...filtered.map((r) => [
        r.file?.originalName ?? r.fileId, r.rowNumber, r.columnName ?? "", r.cellValue ?? "", r.errorType ?? "",
        r.errorMessage, r.aiSuggestion ?? "", r.aiConfidence ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rejected-records.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rejections-page">
      <div className="page-heading">
        <button className="secondary-button" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>
        <h1>Rejected Records</h1>
        <p>Rows that failed validation, with the reason and the AI-suggested fix where one is safe.</p>
      </div>

      {error && <div className="live-banner error">{error}</div>}

      <div className="rejection-summary">
        <article className="rejection-stat">
          <div className="rejection-stat-icon red"><CircleX size={21} /></div>
          <div><span>Pending rejections</span><strong>{records.length.toLocaleString()}</strong></div>
        </article>
        <article className="rejection-stat">
          <div className="rejection-stat-icon orange"><AlertTriangle size={21} /></div>
          <div><span>Top error type</span><strong>{topType ? `${topType[0]} (${topType[1].toLocaleString()})` : "—"}</strong></div>
        </article>
        <article className="rejection-stat">
          <div className="rejection-stat-icon blue"><ShieldAlert size={21} /></div>
          <div><span>Files affected</span><strong>{filesAffected}</strong></div>
        </article>
        <article className="rejection-stat">
          <div className="rejection-stat-icon green"><CheckCircle2 size={21} /></div>
          <div><span>With AI suggestion</span><strong>{withSuggestion.toLocaleString()}</strong></div>
        </article>
      </div>

      <section className="panel rejection-panel">
        <div className="panel-heading">
          <div>
            <h2>Validation Failures</h2>
            <p>Search by file, field, value or reason. Resolve them in the Resolution Centre.</p>
          </div>
          <button className="secondary-button" type="button" onClick={exportCsv}>
            <Download size={16} />
            Export CSV
          </button>
        </div>

        <div className="file-filters">
          <label className="search-box">
            <Search size={17} />
            <input type="search" placeholder="Search rejected records..." value={search}
              onChange={(event) => setSearch(event.target.value)} aria-label="Search rejected records" />
          </label>
          <select aria-label="Filter by error type" value={errorType} onChange={(event) => setErrorType(event.target.value)}>
            <option>All Error Types</option>
            {errorTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        <p className="results-count">Showing {Math.min(limit, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} records</p>

        <div className="table-wrapper">
          <table className="file-table rejection-table">
            <thead>
              <tr>
                <th>Source File</th><th>Row</th><th>Field</th><th>Rejected Value</th><th>Reason</th><th>AI Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r) => (
                <tr key={r.id}>
                  <td>{r.file?.originalName ?? r.fileId}</td>
                  <td className="rejection-id">{r.rowNumber}</td>
                  <td>{r.columnName}</td>
                  <td>{r.cellValue || "Empty"}</td>
                  <td>{r.errorMessage}</td>
                  <td>{r.aiSuggestion ? `${r.aiSuggestion} (${Math.round((r.aiConfidence ?? 0) * 100)}%)` : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-state">No rejected records match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <button className="secondary-button" type="button" onClick={() => setLimit(limit + PAGE)}>Show more</button>
        )}
      </section>
    </div>
  );
}

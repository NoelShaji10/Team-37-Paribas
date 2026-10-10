import { useMemo, useRef, useState } from "react";
import { useRealtimeFiles } from "../hooks/useRealtimeFiles";
import { api } from "../services/api";
import {
  Activity, AlertCircle, AlertTriangle, CalendarDays, CheckCircle2, Clock3,
  FileText, PauseCircle, RefreshCw, Search, ShieldCheck, Upload,
  X, XCircle, FileUp, Filter, ChevronDown, Download,
} from "lucide-react";

const today = new Date();
const dateInputValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
// Live files from the backend, mapped to this page's row shape
const TYPE_NAME = { PAYMENTS: "Payments", BANK_TRANSACTIONS: "Bank-Txns", ACCOUNTS: "Accounts", RATES: "Rates" };
const STATUS_NAME = { QUEUED: "Queued", PROCESSING: "Processing", COMPLETED: "Success", FAILED: "Failed", NEEDS_REVIEW: "Needs Review" };
const STAGE = { QUEUED: "Waiting in queue", PROCESSING: "Validating, normalising, scoring", COMPLETED: "Completed successfully",
  FAILED: "Failed", NEEDS_REVIEW: "Loaded; rejected rows need review" };
const fmtSeconds = (ms) => (ms == null ? "—" : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const toRow = (f) => ({
  id: f.id, name: f.originalName || f.fileName, type: TYPE_NAME[f.fileType] || "Unknown",
  status: STATUS_NAME[f.status] || f.status, progress: Math.round(f.progress || 0),
  stage: f.status === "FAILED" && f.errorMessage ? f.errorMessage : STAGE[f.status] || "",
  records: f.totalRows || f.processedRows || 0, processed: f.processedRows || 0,
  started: f.startedAt ? new Date(f.startedAt).toLocaleTimeString() : "—",
  date: dateInputValue(new Date(f.receivedAt || f.createdAt)), size: Number(f.sizeBytes || 0) / (1024 * 1024),
  predicted: fmtSeconds(f.predictedDurationMs), actual: fmtSeconds(f.actualDurationMs),
  anomaly: (f._count && f._count.anomalies) || 0, error: f.errorMessage,
});
const statusClass = { Processing: "fm-processing", Success: "fm-completed", Failed: "fm-failed", Queued: "fm-queued", "Anomalies Detected": "fm-anomalies", "Needs Review": "fm-anomalies" };
const fileTypeFromName = (name) => {
  const n = name.toLowerCase();
  if (n.includes("payment")) return "Payments";
  if (n.includes("rate") || n.includes("market")) return "Rates";
  if (n.includes("account") || n.includes("customer")) return "Accounts";
  if (n.includes("txn") || n.includes("transaction")) return "Bank-Txns";
  return "Unknown";
};
const formatSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function FileMonitoring({ onOpenFile }) {
  const { files: liveFiles, refresh } = useRealtimeFiles();
  const files = useMemo(() => liveFiles.map(toRow), [liveFiles]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [range, setRange] = useState("Today");
  const [customFrom, setCustomFrom] = useState(dateInputValue(today));
  const [customTo, setCustomTo] = useState(dateInputValue(today));
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    if (range === "This Week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (range === "This Month") start.setDate(1);
    if (range === "Last 7 Days") start.setDate(start.getDate() - 6);
    if (range === "Last 30 Days") start.setDate(start.getDate() - 29);
    const from = range === "Custom Range" ? customFrom : dateInputValue(start);
    const to = range === "Custom Range" ? customTo : dateInputValue(now);
    return files.filter((file) => {
      const matchesSearch = file.name.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "All" || (statusFilter === "Anomalies Detected" ? file.anomaly > 0 : file.status === statusFilter);
      const matchesType = typeFilter === "All Types" || file.type === typeFilter;
      const matchesDate = file.date >= from && file.date <= to;
      return matchesSearch && matchesStatus && matchesType && matchesDate;
    });
  }, [files, search, statusFilter, typeFilter, range, customFrom, customTo]);

  const stats = useMemo(() => ({
    total: filteredFiles.length,
    processing: filteredFiles.filter((f) => f.status === "Processing").length,
    completed: filteredFiles.filter((f) => f.status === "Success").length,
    failed: filteredFiles.filter((f) => f.status === "Failed").length,
    queued: filteredFiles.filter((f) => f.status === "Queued").length,
  }), [filteredFiles]);

  async function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setNotice(`Uploading ${incoming.length} file${incoming.length === 1 ? "" : "s"}…`);
    const results = await Promise.allSettled(incoming.map((file) => api.upload(file)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.map((r, i) => (r.status === "rejected" ? `${incoming[i].name}: ${r.reason.message}` : null)).filter(Boolean);
    setNotice(`${ok} file${ok === 1 ? "" : "s"} queued for processing${failed.length ? `. Not queued: ${failed.join("; ")}` : ""}.`);
    if (inputRef.current) inputRef.current.value = "";
    refresh();
  }
  function clearFilters() { setSearch(""); setStatusFilter("All"); setTypeFilter("All Types"); setRange("Today"); setCustomFrom(dateInputValue(today)); setCustomTo(dateInputValue(today)); }
  function exportCsv() {
    const rows = [["File Name", "Type", "Size (MB)", "Submitted Date", "Status", "Progress", "Predicted Time", "Anomaly Count"], ...filteredFiles.map((f) => [f.name, f.type, f.size.toFixed(2), f.date, f.status, `${f.progress}%`, f.predicted, f.anomaly])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "file-monitoring-filtered.csv"; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="fm-page">
    <div className="fm-heading"><div><div className="fm-eyebrow"><Activity size={15} /> OPERATIONS / INGESTION</div><h1>File Monitoring</h1><p>Track concurrent ingestion, validation outcomes, predicted duration, and anomalies.</p></div>
      <div className="fm-heading-actions"><button className="fm-refresh" type="button" onClick={() => { refresh(); setNotice("Monitoring view refreshed."); }}><RefreshCw size={16} /> Refresh view</button><button className="fm-upload-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload files</button><input ref={inputRef} className="fm-hidden-input" type="file" multiple accept=".csv" onChange={(event) => handleFiles(event.target.files)} /></div>
    </div>

    <section className={`fm-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer.files); }}>
      <div className="fm-drop-icon"><FileUp size={23} /></div><div className="fm-drop-copy"><strong>Drop files here to add them to the queue</strong><span>Only CSV files supported</span></div><button type="button" className="fm-browse-button" onClick={() => inputRef.current?.click()}>Browse files</button>
    </section>

    <div className="fm-stats"><div className="fm-stat-card"><span>Files in view</span><div><FileText /><strong>{stats.total}</strong></div><small>Matching current filters</small></div><div className="fm-stat-card"><span>Processing</span><div><Activity /><strong>{stats.processing}</strong></div><small>Currently running</small></div><div className="fm-stat-card"><span>Successful</span><div><CheckCircle2 /><strong>{stats.completed}</strong></div><small>Validated and loaded</small></div><div className="fm-stat-card"><span>Failed</span><div><XCircle /><strong>{stats.failed}</strong></div><small>Require attention</small></div><div className="fm-stat-card"><span>Queued</span><div><Clock3 /><strong>{stats.queued}</strong></div><small>Awaiting processing</small></div></div>

    <div className="fm-panel"><div className="fm-panel-heading"><div><h2>File processing queue</h2><p>Filter by date, file type, status, or filename. Select a row to open its details: rejections, AI suggestions and anomalies.</p></div><div className="fm-panel-tools"><span className="fm-count">{filteredFiles.length} of {files.length} files</span><button className="fm-export" type="button" onClick={exportCsv}><Download size={14} /> Export CSV</button></div></div>
      <div className="fm-filter-area"><div className="fm-filter-title"><span><Filter size={15} /> Filters</span><button type="button" onClick={clearFilters}>Reset filters <X size={13} /></button></div>
        <div className="fm-date-pills">{["Today", "This Week", "This Month", "Last 7 Days", "Last 30 Days", "Custom Range"].map((item) => <button type="button" key={item} className={`fm-date-pill ${range === item ? "active" : ""}`} onClick={() => setRange(item)}>{item === "Custom Range" && <CalendarDays size={13} />}{item}</button>)}</div>
        {range === "Custom Range" && <div className="fm-custom-dates"><label>From <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
        <div className="fm-filters"><div className="fm-search"><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by filename…" aria-label="Search by filename" /></div>
          <label className="fm-select-wrap"><span>File type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter files by type"><option>All Types</option><option>Payments</option><option>Bank-Txns</option><option>Accounts</option><option>Rates</option><option>Unknown</option></select><ChevronDown size={14} /></label>
          <label className="fm-select-wrap"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter files by status"><option value="All">All statuses</option><option value="Success">Success</option><option value="Failed">Failed</option><option value="Anomalies Detected">Anomalies detected</option><option value="Processing">In progress</option><option value="Queued">Queued</option></select><ChevronDown size={14} /></label>
        </div>
      </div>
      <div className="fm-table-wrap"><table className="fm-table"><thead><tr><th>File name / type</th><th>Size</th><th>Status</th><th>Progress</th><th>Predicted time</th><th>Anomalies</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>
        {filteredFiles.map((file) => <tr key={file.id}><td><div className="fm-file-name"><span className="fm-file-icon"><FileText size={17} /></span><div><strong>{file.name}</strong><small>{file.type}</small></div></div></td><td>{file.size < 0.01 ? "—" : `${file.size.toFixed(1)} MB`}</td><td><span className={`fm-status ${statusClass[file.status] || "fm-queued"}`}>{file.status === "Processing" ? <Activity size={13} /> : file.status === "Success" ? <CheckCircle2 size={13} /> : file.status === "Failed" ? <XCircle size={13} /> : file.anomaly > 0 ? <AlertTriangle size={13} /> : <PauseCircle size={13} />}{file.status}</span></td><td><div className="fm-progress-label"><span>{file.progress}%</span></div><div className="fm-progress-track" role="progressbar" aria-valuenow={file.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${file.name} progress`}><div className={`fm-progress-fill ${statusClass[file.status] || "fm-queued"}`} style={{ width: `${file.progress}%` }} /></div><small className="fm-record-detail">{file.processed.toLocaleString()} / {file.records.toLocaleString()} records</small></td><td><span className="fm-predicted"><Clock3 size={13} />{file.predicted}</span></td><td>{file.anomaly > 0 ? <span className="fm-anomaly-count"><AlertTriangle size={13} />{file.anomaly}</span> : <span className="fm-no-anomaly">—</span>}</td><td><span className="fm-submitted-date">{file.date}</span><small className="fm-record-detail">{file.started}</small></td><td>{file.status === "Failed" ? <span className="fm-waiting" title={file.error || ""}><XCircle size={14} /> {file.error ? "Quarantined / failed" : "Failed"}</span> : file.status === "Queued" ? <span className="fm-waiting"><Clock3 size={14} /> Waiting</span> : file.status === "Processing" ? <span className="fm-waiting"><Activity size={14} /> In progress</span> : <button className="fm-action" type="button" onClick={() => onOpenFile && onOpenFile(file.id)}><ShieldCheck size={14} /> View details</button>}</td></tr>)}
        {filteredFiles.length === 0 && <tr><td colSpan={8} className="fm-empty"><Search size={22} /><strong>No files match these filters</strong><span>Try changing the date range or clearing one of the filters.</span><button type="button" onClick={clearFilters}>Clear all filters</button></td></tr>}
      </tbody></table></div>
    </div>
    {notice && <div className="fm-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
    <div className="fm-footer"><Activity size={16} /><span>File Monitoring</span><span>•</span><span>Live data from the backend · refreshes every 2 seconds while files are processing</span></div>
  </div>;
}

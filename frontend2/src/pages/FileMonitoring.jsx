import { useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, AlertTriangle, CalendarDays, CheckCircle2, Clock3,
  FileText, PauseCircle, PlayCircle, RefreshCw, Search, ShieldCheck, Upload,
  X, XCircle, FileUp, Filter, ChevronDown, Download,
} from "lucide-react";

const today = new Date();
const dateInputValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const initialFiles = [
  { id: 1, name: "Bank-Txns_001.csv", type: "Bank-Txns", status: "Processing", progress: 60, stage: "Validating records", records: 12000, processed: 7200, started: "10:14:22", date: dateInputValue(today), size: 12.4, predicted: "2m 40s", anomaly: 2 },
  { id: 2, name: "Payments_20261010.csv", type: "Payments", status: "Success", progress: 100, stage: "Completed successfully", records: 8500, processed: 8500, started: "10:08:10", date: dateInputValue(today), size: 8.1, predicted: "1m 48s", anomaly: 0 },
  { id: 3, name: "Customer_Update.csv", type: "Accounts", status: "Failed", progress: 35, stage: "Validation failed", records: 4200, processed: 1470, started: "10:05:41", date: dateInputValue(today), size: 5.6, predicted: "3m 10s", anomaly: 15 },
  { id: 4, name: "MarketFeed.csv", type: "Rates", status: "Queued", progress: 0, stage: "Waiting in queue", records: 15000, processed: 0, started: "—", date: dateInputValue(today), size: 22.3, predicted: "4m 20s", anomaly: 0 },
  { id: 5, name: "Bank-Txns_002.csv", type: "Bank-Txns", status: "Processing", progress: 25, stage: "Reading file", records: 6000, processed: 1500, started: "10:15:03", date: dateInputValue(today), size: 7.8, predicted: "1m 55s", anomaly: 0 },
];
const statusClass = { Processing: "fm-processing", Success: "fm-completed", Failed: "fm-failed", Queued: "fm-queued", "Anomalies Detected": "fm-anomalies" };
const fileTypeFromName = (name) => {
  const n = name.toLowerCase();
  if (n.includes("payment")) return "Payments";
  if (n.includes("rate") || n.includes("market")) return "Rates";
  if (n.includes("account") || n.includes("customer")) return "Accounts";
  if (n.includes("txn") || n.includes("transaction")) return "Bank-Txns";
  return "Unknown";
};
const formatSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function FileMonitoring() {
  const [files, setFiles] = useState(initialFiles);
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

  function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const invalid = incoming.filter((file) => !/\.(csv|xlsx?|json|txt|parquet)$/i.test(file.name));
    const accepted = incoming.filter((file) => /\.(csv|xlsx?|json|txt|parquet)$/i.test(file.name));
    const mapped = accepted.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`, name: file.name, type: fileTypeFromName(file.name),
      status: "Queued", progress: 0, stage: "Uploaded · waiting for processing", records: 0, processed: 0,
      started: "—", date: dateInputValue(new Date()), size: file.size / (1024 * 1024), predicted: "Estimating…", anomaly: 0,
    }));
    if (mapped.length) setFiles((current) => [...mapped, ...current]);
    setNotice(`${mapped.length} file${mapped.length === 1 ? "" : "s"} added to the monitoring queue${invalid.length ? `; ${invalid.length} unsupported file${invalid.length === 1 ? " was" : "s were"} skipped` : ""}. This prototype queues files in the UI; connect the ingestion API for actual processing.`);
    if (inputRef.current) inputRef.current.value = "";
  }
  function retryFile(id) {
    setFiles((current) => current.map((file) => file.id === id ? { ...file, status: "Queued", progress: 0, processed: 0, stage: "Waiting to retry" } : file));
    setNotice("File returned to the retry queue in this prototype. Backend integration is required for actual reprocessing.");
  }
  function startQueuedFile(id) {
    setFiles((current) => current.map((file) => file.id === id ? { ...file, status: "Processing", progress: 5, stage: "Processing started (demo)", started: new Date().toLocaleTimeString() } : file));
    setNotice("Demo status updated. No real file processing has started.");
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
      <div className="fm-heading-actions"><button className="fm-refresh" type="button" onClick={() => setNotice("Monitoring view refreshed. Displayed sample data is local to this prototype.")}><RefreshCw size={16} /> Refresh view</button><button className="fm-upload-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload files</button><input ref={inputRef} className="fm-hidden-input" type="file" multiple accept=".csv,.xls,.xlsx,.json,.txt,.parquet" onChange={(event) => handleFiles(event.target.files)} /></div>
    </div>

    <div className="fm-demo-note"><AlertCircle size={17} /><span><strong>Prototype mode:</strong> uploads are added to this monitoring queue locally. Connect the ingestion API to validate, process, and track real files.</span></div>

    <section className={`fm-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer.files); }}>
      <div className="fm-drop-icon"><FileUp size={23} /></div><div className="fm-drop-copy"><strong>Drop files here to add them to the queue</strong><span>Only CSV files supported</span></div><button type="button" className="fm-browse-button" onClick={() => inputRef.current?.click()}>Browse files</button>
    </section>

    <div className="fm-stats"><div className="fm-stat-card"><span>Files in view</span><div><FileText /><strong>{stats.total}</strong></div><small>Matching current filters</small></div><div className="fm-stat-card"><span>Processing</span><div><Activity /><strong>{stats.processing}</strong></div><small>Currently running</small></div><div className="fm-stat-card"><span>Successful</span><div><CheckCircle2 /><strong>{stats.completed}</strong></div><small>Validated and loaded</small></div><div className="fm-stat-card"><span>Failed</span><div><XCircle /><strong>{stats.failed}</strong></div><small>Require attention</small></div><div className="fm-stat-card"><span>Queued</span><div><Clock3 /><strong>{stats.queued}</strong></div><small>Awaiting processing</small></div></div>

    <div className="fm-panel"><div className="fm-panel-heading"><div><h2>File processing queue</h2><p>Filter by date, file type, status, or filename. Select a row action to retry or start a demo job.</p></div><div className="fm-panel-tools"><span className="fm-count">{filteredFiles.length} of {files.length} files</span><button className="fm-export" type="button" onClick={exportCsv}><Download size={14} /> Export CSV</button></div></div>
      <div className="fm-filter-area"><div className="fm-filter-title"><span><Filter size={15} /> Filters</span><button type="button" onClick={clearFilters}>Reset filters <X size={13} /></button></div>
        <div className="fm-date-pills">{["Today", "This Week", "This Month", "Last 7 Days", "Last 30 Days", "Custom Range"].map((item) => <button type="button" key={item} className={`fm-date-pill ${range === item ? "active" : ""}`} onClick={() => setRange(item)}>{item === "Custom Range" && <CalendarDays size={13} />}{item}</button>)}</div>
        {range === "Custom Range" && <div className="fm-custom-dates"><label>From <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
        <div className="fm-filters"><div className="fm-search"><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by filename…" aria-label="Search by filename" /></div>
          <label className="fm-select-wrap"><span>File type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter files by type"><option>All Types</option><option>Payments</option><option>Bank-Txns</option><option>Accounts</option><option>Rates</option><option>Unknown</option></select><ChevronDown size={14} /></label>
          <label className="fm-select-wrap"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter files by status"><option value="All">All statuses</option><option value="Success">Success</option><option value="Failed">Failed</option><option value="Anomalies Detected">Anomalies detected</option><option value="Processing">In progress</option><option value="Queued">Queued</option></select><ChevronDown size={14} /></label>
        </div>
      </div>
      <div className="fm-table-wrap"><table className="fm-table"><thead><tr><th>File name / type</th><th>Size</th><th>Status</th><th>Progress</th><th>Predicted time</th><th>Anomalies</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>
        {filteredFiles.map((file) => <tr key={file.id}><td><div className="fm-file-name"><span className="fm-file-icon"><FileText size={17} /></span><div><strong>{file.name}</strong><small>{file.type}</small></div></div></td><td>{file.size < 0.01 ? "—" : `${file.size.toFixed(1)} MB`}</td><td><span className={`fm-status ${statusClass[file.status] || "fm-queued"}`}>{file.status === "Processing" ? <Activity size={13} /> : file.status === "Success" ? <CheckCircle2 size={13} /> : file.status === "Failed" ? <XCircle size={13} /> : file.anomaly > 0 ? <AlertTriangle size={13} /> : <PauseCircle size={13} />}{file.status}</span></td><td><div className="fm-progress-label"><span>{file.progress}%</span></div><div className="fm-progress-track" role="progressbar" aria-valuenow={file.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${file.name} progress`}><div className={`fm-progress-fill ${statusClass[file.status] || "fm-queued"}`} style={{ width: `${file.progress}%` }} /></div><small className="fm-record-detail">{file.processed.toLocaleString()} / {file.records.toLocaleString()} records</small></td><td><span className="fm-predicted"><Clock3 size={13} />{file.predicted}</span></td><td>{file.anomaly > 0 ? <span className="fm-anomaly-count"><AlertTriangle size={13} />{file.anomaly}</span> : <span className="fm-no-anomaly">—</span>}</td><td><span className="fm-submitted-date">{file.date}</span><small className="fm-record-detail">{file.started}</small></td><td>{file.status === "Failed" ? <button className="fm-action fm-retry" type="button" onClick={() => retryFile(file.id)}><RefreshCw size={14} /> Retry</button> : file.status === "Queued" ? <button className="fm-action" type="button" onClick={() => startQueuedFile(file.id)}><PlayCircle size={14} /> Start demo</button> : file.status === "Processing" ? <span className="fm-waiting"><Activity size={14} /> In progress</span> : <span className="fm-success"><ShieldCheck size={15} /> Verified</span>}</td></tr>)}
        {filteredFiles.length === 0 && <tr><td colSpan={8} className="fm-empty"><Search size={22} /><strong>No files match these filters</strong><span>Try changing the date range or clearing one of the filters.</span><button type="button" onClick={clearFilters}>Clear all filters</button></td></tr>}
      </tbody></table></div>
    </div>
    {notice && <div className="fm-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
    <div className="fm-footer"><Activity size={16} /><span>File Monitoring</span><span>•</span><span>Demo UI · live validation, concurrent processing, and AI predictions require backend services</span></div>
  </div>;
}

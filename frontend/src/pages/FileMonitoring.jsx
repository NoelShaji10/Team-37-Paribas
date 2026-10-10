
import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const initialFiles = [
  {
    id: 1,
    name: "Bank-Txns_001.csv",
    type: "Transactions",
    status: "Processing",
    progress: 60,
    stage: "Validating records",
    records: 12000,
    processed: 7200,
    started: "10:14:22",
  },
  {
    id: 2,
    name: "Payments_20261010.csv",
    type: "Payments",
    status: "Completed",
    progress: 100,
    stage: "Completed successfully",
    records: 8500,
    processed: 8500,
    started: "10:08:10",
  },
  {
    id: 3,
    name: "Customer_Update.csv",
    type: "Customer Data",
    status: "Failed",
    progress: 35,
    stage: "Validation failed",
    records: 4200,
    processed: 1470,
    started: "10:05:41",
  },
  {
    id: 4,
    name: "MarketFeed.csv",
    type: "Market Data",
    status: "Queued",
    progress: 0,
    stage: "Waiting in queue",
    records: 15000,
    processed: 0,
    started: "—",
  },
  {
    id: 5,
    name: "Bank-Txns_002.csv",
    type: "Transactions",
    status: "Processing",
    progress: 25,
    stage: "Reading file",
    records: 6000,
    processed: 1500,
    started: "10:15:03",
  },
];

const statusClass = {
  Processing: "fm-processing",
  Completed: "fm-completed",
  Failed: "fm-failed",
  Queued: "fm-queued",
};

export default function FileMonitoring() {
  const [files, setFiles] = useState(initialFiles);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [notice, setNotice] = useState("");

  const stats = useMemo(
    () => ({
      total: files.length,
      processing: files.filter(
        (file) => file.status === "Processing"
      ).length,
      completed: files.filter(
        (file) => file.status === "Completed"
      ).length,
      failed: files.filter(
        (file) => file.status === "Failed"
      ).length,
      queued: files.filter(
        (file) => file.status === "Queued"
      ).length,
    }),
    [files]
  );

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();

    return files.filter((file) => {
      const matchesSearch =
        file.name.toLowerCase().includes(query) ||
        file.type.toLowerCase().includes(query);

      const matchesStatus =
        statusFilter === "All" ||
        file.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [files, search, statusFilter]);

  function retryFile(id) {
    setFiles((current) =>
      current.map((file) =>
        file.id === id
          ? {
              ...file,
              status: "Queued",
              progress: 0,
              processed: 0,
              stage: "Waiting to retry",
            }
          : file
      )
    );

    setNotice(
      "File moved to the demo retry queue. Backend integration is required for actual processing."
    );
  }

  function startQueuedFile(id) {
    setFiles((current) =>
      current.map((file) =>
        file.id === id
          ? {
              ...file,
              status: "Processing",
              progress: 5,
              processed: 0,
              stage: "Processing started (demo)",
              started: new Date().toLocaleTimeString(),
            }
          : file
      )
    );

    setNotice(
      "Demo status updated. No real file processing has started."
    );
  }

  function refreshView() {
    setNotice(
      "View refreshed. The displayed data is simulated."
    );
  }

  return (
    <div className="fm-page">
      <div className="fm-heading">
        <div>
          <div className="fm-eyebrow">
            <Activity size={15} />
            OPERATIONS
          </div>

          <h1>File Monitoring</h1>

          <p>
            Monitor individual bank files, processing progress,
            and failures.
          </p>
        </div>

        <button
          className="fm-refresh"
          type="button"
          onClick={refreshView}
        >
          <RefreshCw size={16} />
          Refresh view
        </button>
      </div>

      <div className="fm-demo-note">
        <AlertCircle size={17} />
        Demo monitoring data — live updates require backend
        integration.
      </div>

      <div className="fm-stats">
        <div className="fm-stat-card">
          <span>Total files</span>
          <div>
            <FileText />
            <strong>{stats.total}</strong>
          </div>
          <small>Files in this demo view</small>
        </div>

        <div className="fm-stat-card">
          <span>Processing</span>
          <div>
            <Activity />
            <strong>{stats.processing}</strong>
          </div>
          <small>Currently marked processing</small>
        </div>

        <div className="fm-stat-card">
          <span>Completed</span>
          <div>
            <CheckCircle2 />
            <strong>{stats.completed}</strong>
          </div>
          <small>Marked successful</small>
        </div>

        <div className="fm-stat-card">
          <span>Failed</span>
          <div>
            <XCircle />
            <strong>{stats.failed}</strong>
          </div>
          <small>Require attention</small>
        </div>

        <div className="fm-stat-card">
          <span>Queued</span>
          <div>
            <Clock3 />
            <strong>{stats.queued}</strong>
          </div>
          <small>Waiting to process</small>
        </div>
      </div>

      <div className="fm-panel">
        <div className="fm-panel-heading">
          <div>
            <h2>File processing queue</h2>
            <p>
              Review each file's current state and progress.
            </p>
          </div>

          <span className="fm-count">
            {filteredFiles.length} files shown
          </span>
        </div>

        <div className="fm-filters">
          <div className="fm-search">
            <Search size={17} />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search filename or file type..."
              aria-label="Search monitored files"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
            aria-label="Filter files by status"
          >
            <option value="All">All statuses</option>
            <option value="Processing">Processing</option>
            <option value="Completed">Completed</option>
            <option value="Failed">Failed</option>
            <option value="Queued">Queued</option>
          </select>
        </div>

        <div className="fm-table-wrap">
          <table className="fm-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Processing stage</th>
                <th>Records</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredFiles.map((file) => (
                <tr key={file.id}>
                  <td>
                    <div className="fm-file-name">
                      <FileText size={18} />
                      <div>
                        <strong>{file.name}</strong>
                        <small>{file.type}</small>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span
                      className={`fm-status ${statusClass[file.status]}`}
                    >
                      {file.status === "Processing" && (
                        <Activity size={13} />
                      )}
                      {file.status === "Completed" && (
                        <CheckCircle2 size={13} />
                      )}
                      {file.status === "Failed" && (
                        <XCircle size={13} />
                      )}
                      {file.status === "Queued" && (
                        <PauseCircle size={13} />
                      )}
                      {file.status}
                    </span>
                  </td>

                  <td>
                    <div className="fm-progress-label">
                      <span>{file.progress}%</span>
                    </div>

                    <div
                      className="fm-progress-track"
                      role="progressbar"
                      aria-valuenow={file.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${file.name} progress`}
                    >
                      <div
                        className={`fm-progress-fill ${statusClass[file.status]}`}
                        style={{
                          width: `${file.progress}%`,
                        }}
                      />
                    </div>

                    <small className="fm-record-detail">
                      {file.processed.toLocaleString()} /{" "}
                      {file.records.toLocaleString()} records
                    </small>
                  </td>

                  <td>{file.stage}</td>
                  <td>{file.records.toLocaleString()}</td>
                  <td>{file.started}</td>

                  <td>
                    {file.status === "Failed" && (
                      <button
                        className="fm-action fm-retry"
                        type="button"
                        onClick={() => retryFile(file.id)}
                      >
                        <RefreshCw size={14} />
                        Retry
                      </button>
                    )}

                    {file.status === "Queued" && (
                      <button
                        className="fm-action"
                        type="button"
                        onClick={() =>
                          startQueuedFile(file.id)
                        }
                      >
                        <PlayCircle size={14} />
                        Start demo
                      </button>
                    )}

                    {file.status === "Processing" && (
                      <span className="fm-waiting">
                        <Activity size={14} />
                        In progress
                      </span>
                    )}

                    {file.status === "Completed" && (
                      <span className="fm-success">
                        <ShieldCheck size={15} />
                        Verified
                      </span>
                    )}
                  </td>
                </tr>
              ))}

              {filteredFiles.length === 0 && (
                <tr>
                  <td colSpan={7} className="fm-empty">
                    No files match your search or status filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {notice && (
        <div className="fm-notice" role="status">
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      <div className="fm-footer">
        <Activity size={16} />
        <span>File Monitoring</span>
        <span>•</span>
        <span>
          Sample data only — not connected to a live processing engine
        </span>
      </div>
    </div>
  );
}

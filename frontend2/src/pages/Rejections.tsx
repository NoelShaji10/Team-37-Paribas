import { useState } from "react";
import {
  ArrowLeft,
  Search,
  ShieldAlert,
  AlertTriangle,
  CircleX,
  CheckCircle2,
} from "lucide-react";

interface RejectionsProps {
  onBack: () => void;
}

const rejectionData = [
  {
    id: "REC-10021",
    file: "Customer_Update.csv",
    field: "IFSC Code",
    value: "ABCD00012",
    reason: "Invalid IFSC code format",
    severity: "High",
    status: "Pending",
  },
  {
    id: "REC-10022",
    file: "Customer_Update.csv",
    field: "Account Number",
    value: "12345",
    reason: "Account number length is invalid",
    severity: "High",
    status: "Pending",
  },
  {
    id: "REC-10023",
    file: "Bank-Txns_001.csv",
    field: "Transaction Amount",
    value: "-5000",
    reason: "Transaction amount cannot be negative",
    severity: "Medium",
    status: "Pending",
  },
  {
    id: "REC-10024",
    file: "MarketFeed.csv",
    field: "Currency",
    value: "XYZ",
    reason: "Currency code not found in reference data",
    severity: "Low",
    status: "Reviewed",
  },
  {
    id: "REC-10025",
    file: "Payments_20261010.csv",
    field: "Beneficiary Name",
    value: "",
    reason: "Required beneficiary name is missing",
    severity: "High",
    status: "Pending",
  },
];

function Rejections({ onBack }: RejectionsProps) {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All Severities");
  const [status, setStatus] = useState("All Statuses");

  const filteredRecords = rejectionData.filter((record) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      record.id.toLowerCase().includes(query) ||
      record.file.toLowerCase().includes(query) ||
      record.field.toLowerCase().includes(query) ||
      record.reason.toLowerCase().includes(query);

    const matchesSeverity =
      severity === "All Severities" || record.severity === severity;

    const matchesStatus =
      status === "All Statuses" || record.status === status;

    return matchesSearch && matchesSeverity && matchesStatus;
  });

  const pendingCount = rejectionData.filter(
    (record) => record.status === "Pending"
  ).length;

  const highSeverityCount = rejectionData.filter(
    (record) => record.severity === "High"
  ).length;

  return (
    <div className="rejections-page">
      <div className="page-heading">
        <button className="secondary-button" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>

        <h1>Rejected Records</h1>
        <p>Review validation failures and identify records requiring correction.</p>
      </div>

      <div className="rejection-summary">
        <article className="rejection-stat">
          <div className="rejection-stat-icon red">
            <CircleX size={21} />
          </div>
          <div>
            <span>Total rejected records</span>
            <strong>{rejectionData.length}</strong>
          </div>
        </article>

        <article className="rejection-stat">
          <div className="rejection-stat-icon orange">
            <AlertTriangle size={21} />
          </div>
          <div>
            <span>High severity</span>
            <strong>{highSeverityCount}</strong>
          </div>
        </article>

        <article className="rejection-stat">
          <div className="rejection-stat-icon blue">
            <ShieldAlert size={21} />
          </div>
          <div>
            <span>Pending review</span>
            <strong>{pendingCount}</strong>
          </div>
        </article>

        <article className="rejection-stat">
          <div className="rejection-stat-icon green">
            <CheckCircle2 size={21} />
          </div>
          <div>
            <span>Reviewed</span>
            <strong>
              {rejectionData.length - pendingCount}
            </strong>
          </div>
        </article>
      </div>

      <section className="panel rejection-panel">
        <div className="panel-heading">
          <div>
            <h2>Validation Failures</h2>
            <p>Search rejected records by file, field, ID or reason.</p>
          </div>
        </div>

        <div className="file-filters">
          <label className="search-box">
            <Search size={17} />
            <input
              type="search"
              placeholder="Search rejected records..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search rejected records"
            />
          </label>

          <select
            aria-label="Filter by severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option>All Severities</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>

          <select
            aria-label="Filter by review status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option>All Statuses</option>
            <option>Pending</option>
            <option>Reviewed</option>
          </select>
        </div>

        <p className="results-count">
          Showing {filteredRecords.length} of {rejectionData.length} records
        </p>

        <div className="table-wrapper">
          <table className="file-table rejection-table">
            <thead>
              <tr>
                <th>Record ID</th>
                <th>Source File</th>
                <th>Field</th>
                <th>Rejected Value</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id}>
                  <td className="rejection-id">{record.id}</td>
                  <td>{record.file}</td>
                  <td>{record.field}</td>
                  <td>{record.value || "Empty"}</td>
                  <td>{record.reason}</td>
                  <td>
                    <span
                      className={`severity-badge ${record.severity.toLowerCase()}`}
                    >
                      {record.severity}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`review-status ${record.status.toLowerCase()}`}
                    >
                      {record.status}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No rejected records match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rejection-note">
        <AlertTriangle size={18} />
        <p>
          These are illustrative records for the frontend prototype.
          Actual rejection details will come from the backend validation engine.
        </p>
      </div>
    </div>
  );
}

export default Rejections;

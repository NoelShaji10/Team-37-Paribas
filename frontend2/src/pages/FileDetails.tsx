
import {
  ArrowLeft,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Database,
} from "lucide-react";

interface FileDetailsProps {
  onBack: () => void;
}

const fileDetails = {
  fileName: "customer_transactions_001.csv",
  fileId: "FILE-2026-001",
  fileType: "CSV",
  fileSize: "24.8 MB",
  uploadedAt: "10 Oct 2026, 10:30 AM",
  startedAt: "10 Oct 2026, 10:31 AM",
  completedAt: "10 Oct 2026, 10:34 AM",
  status: "Completed",
  progress: 100,
  totalRecords: 125000,
  processedRecords: 125000,
  failedRecords: 12,
  processingTime: "2 min 48 sec",
};

function FileDetails({ onBack }: FileDetailsProps) {
  const file = fileDetails;

  return (
    <div className="file-details-page">
      <div className="page-heading">
        <button className="secondary-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>

        <h1>File Details</h1>
        <p>View processing information and record-level results.</p>
      </div>

      <section className="details-file-card">
        <div className="details-file-icon">
          <FileText size={26} />
        </div>

        <div className="details-file-name">
          <h2>{file.fileName}</h2>
          <p>{file.fileId}</p>
        </div>

        <span className="status-badge status-completed">
          <CheckCircle2 size={14} />
          {file.status}
        </span>
      </section>

      <section className="details-grid">
        <div className="details-card">
          <span>File Size</span>
          <strong>{file.fileSize}</strong>
        </div>

        <div className="details-card">
          <span>Total Records</span>
          <strong>{file.totalRecords.toLocaleString()}</strong>
        </div>

        <div className="details-card">
          <span>Processed Records</span>
          <strong>{file.processedRecords.toLocaleString()}</strong>
        </div>

        <div className="details-card">
          <span>Failed Records</span>
          <strong>{file.failedRecords}</strong>
        </div>
      </section>

      <section className="details-panel">
        <h2>Processing Progress</h2>

        <div className="details-progress-label">
          <span>{file.progress}% complete</span>
          <span>{file.processingTime}</span>
        </div>

        <div className="details-progress-track">
          <div
            className="details-progress-fill"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      </section>

      <section className="details-panel">
        <h2>File Information</h2>

        <div className="details-info-grid">
          <div>
            <span>File Type</span>
            <strong>{file.fileType}</strong>
          </div>

          <div>
            <span>
              <Clock size={14} /> Uploaded At
            </span>
            <strong>{file.uploadedAt}</strong>
          </div>

          <div>
            <span>
              <Database size={14} /> Processing Started
            </span>
            <strong>{file.startedAt}</strong>
          </div>

          <div>
            <span>
              <CheckCircle2 size={14} /> Processing Completed
            </span>
            <strong>{file.completedAt}</strong>
          </div>
        </div>
      </section>

      <section className="details-panel">
        <div className="details-section-heading">
          <h2>Processing Summary</h2>
          <AlertTriangle size={20} />
        </div>

        <p>
          The file has finished processing. Twelve records were flagged for
          review. These values are sample data for the frontend prototype.
        </p>

        <div className="details-note">
          Record-level validation results and rejection reasons will be
          connected when the backend is implemented.
        </div>
      </section>
    </div>
  );
}

export default FileDetails;

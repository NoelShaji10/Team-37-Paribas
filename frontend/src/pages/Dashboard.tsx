
import { useState } from "react";

import {
  Activity,
  Bell,
  ChevronDown,
  CircleHelp,
  Database,
  FileSearch,
  Files,
  LayoutDashboard,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";

import DashboardCards from "../components/DashboardCards";
import DashboardCharts from "../components/DashboardCharts";

import FileDetails from "./FileDetails";
import FileMonitoring from "./FileMonitoring";
import Rejections from "./Rejections";
import ResolutionCentre from "./ResolutionCentre";
import Analytics from "./Analytics";
import MasterData from "./MasterData";
import SettingsPage from "./SettingsPage";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "File Monitoring", icon: Files },
  { label: "File Details", icon: FileSearch },
  { label: "Rejections", icon: ShieldAlert },
  { label: "Resolution Centre", icon: WandSparkles },
  { label: "Analytics", icon: Activity },
  { label: "Master Data", icon: Database },
  { label: "Settings", icon: Settings },
];

const recentFiles = [
  {
    name: "Bank-Txns_001.csv",
    type: "Bank Transactions",
    size: "12.4 MB",
    status: "Processing",
    progress: 60,
    time: "2.5 min",
    anomaly: "2",
  },
  {
    name: "Payments_20261010.csv",
    type: "Payments",
    size: "8.1 MB",
    status: "Completed",
    progress: 100,
    time: "1.8 min",
    anomaly: "—",
  },
  {
    name: "Customer_Update.csv",
    type: "Accounts",
    size: "5.6 MB",
    status: "Failed",
    progress: 0,
    time: "—",
    anomaly: "15",
  },
  {
    name: "MarketFeed.csv",
    type: "Rates",
    size: "22.3 MB",
    status: "Queued",
    progress: 0,
    time: "4.2 min",
    anomaly: "—",
  },
];

const pageDescriptions: Record<string, string> = {
  Settings: "Configure dashboard preferences and processing rules.",
};

export default function Dashboard() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState("All Types");
  const [status, setStatus] = useState("All Statuses");

  const filteredFiles = recentFiles.filter((file) => {
    const matchesSearch = file.name
      .toLowerCase()
      .includes(search.trim().toLowerCase());

    const matchesType =
      fileType === "All Types" || file.type === fileType;

    const matchesStatus =
      status === "All Statuses" || file.status === status;

    return matchesSearch && matchesType && matchesStatus;
  });

  const resetFilters = () => {
    setSearch("");
    setFileType("All Types");
    setStatus("All Statuses");
  };

  // Only the Dashboard displays the overview and charts.
  const showDashboard = activePage === "Dashboard";

  const renderPageIcon = () => {
    switch (activePage) {
      case "Analytics":
        return <Activity size={30} />;

      case "Master Data":
        return <Database size={30} />;

      case "Settings":
        return <Settings size={30} />;

      case "Rejections":
        return <ShieldAlert size={30} />;

      case "Resolution Centre":
        return <WandSparkles size={30} />;

      case "File Details":
        return <FileSearch size={30} />;

      default:
        return <Files size={30} />;
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Database size={25} />
          </div>

          <div>
            <h2>Bank Ingestion</h2>
            <p>AI-Powered Platform</p>
          </div>
        </div>

        <nav className="navigation">
          <p className="nav-heading">WORKSPACE</p>

          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.label}
                type="button"
                className={`nav-item ${
                  activePage === item.label ? "active" : ""
                }`}
                aria-current={
                  activePage === item.label ? "page" : undefined
                }
                onClick={() => setActivePage(item.label)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className="online-dot" />

          <div>
            <strong>Processing engine</strong>
            <p>System operational</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">BANK DATA OPERATIONS</p>
            <h1>Concurrent File Processing</h1>
            <p className="page-description">
              Monitor, validate and process bank data in parallel.
            </p>
          </div>

          <div className="topbar-actions">
            <div className="engine-status">
              <span className="online-dot" />
              Engine Running
            </div>

            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
              onClick={() =>
                window.alert(
                  "You are all caught up on notifications."
                )
              }
            >
              <Bell size={20} />
            </button>

            <button className="profile-button" type="button">
              <span className="avatar">AD</span>
              <span>Admin</span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <section className="page-body">
          {/* File Details */}
          {activePage === "File Details" && (
            <FileDetails
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Dedicated File Monitoring page */}
          {activePage === "File Monitoring" && (
            <FileMonitoring />
          )}

          {/* Rejections */}
          {activePage === "Rejections" && (
            <Rejections
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Resolution Centre */}
          {activePage === "Resolution Centre" && (
            <ResolutionCentre
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Analytics */}
          {activePage === "Analytics" && (
            <Analytics
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Master Data */}
          {activePage === "Master Data" && (
            <MasterData
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Settings */}
          {activePage === "Settings" && (
            <SettingsPage
              onBack={() => setActivePage("Dashboard")}
            />
          )}

          {/* Dashboard overview only */}
          {showDashboard && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Operations Overview</h2>

                  <p>
                    Here's the latest snapshot of file processing
                    activity.
                  </p>
                </div>

                <div className="date-label">
                  <Activity size={16} />
                  Today's overview
                </div>
              </div>

              {/* KPI cards */}
              <DashboardCards />

              {/* Charts */}
              <DashboardCharts />

              {/* Recent files table */}
              <section className="panel monitoring-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent Files</h2>
                    <p>
                      Review recent file ingestion and processing
                      activity.
                    </p>
                  </div>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setActivePage("File Monitoring")
                    }
                  >
                    <Files size={17} />
                    View all files
                  </button>
                </div>

                {/* Search and filters */}
                <div className="file-filters">
                  <label className="search-box">
                    <Search size={17} />

                    <input
                      type="search"
                      placeholder="Search filename..."
                      aria-label="Search filename"
                      value={search}
                      onChange={(event) =>
                        setSearch(event.target.value)
                      }
                    />
                  </label>

                  <select
                    aria-label="Filter by file type"
                    value={fileType}
                    onChange={(event) =>
                      setFileType(event.target.value)
                    }
                  >
                    <option value="All Types">All Types</option>
                    <option value="Payments">Payments</option>
                    <option value="Bank Transactions">
                      Bank Transactions
                    </option>
                    <option value="Accounts">Accounts</option>
                    <option value="Rates">Rates</option>
                  </select>

                  <select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value)
                    }
                  >
                    <option value="All Statuses">
                      All Statuses
                    </option>
                    <option value="Completed">Completed</option>
                    <option value="Processing">Processing</option>
                    <option value="Failed">Failed</option>
                    <option value="Queued">Queued</option>
                  </select>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={resetFilters}
                  >
                    <RotateCcw size={15} />
                    Reset
                  </button>
                </div>

                <p className="results-count">
                  Showing {filteredFiles.length} of{" "}
                  {recentFiles.length} files
                </p>

                <div className="table-wrapper">
                  <table className="file-table">
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Predicted Time</th>
                        <th>Anomalies</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredFiles.map((file) => (
                        <tr key={file.name}>
                          <td className="file-name">
                            <Files size={17} />
                            {file.name}
                          </td>

                          <td>{file.type}</td>
                          <td>{file.size}</td>

                          <td>
                            <span
                              className={`status-badge ${file.status.toLowerCase()}`}
                            >
                              {file.status}
                            </span>
                          </td>

                          <td>
                            <div className="progress-cell">
                              <div
                                className="progress-track"
                                role="progressbar"
                                aria-label={`${file.name} progress`}
                                aria-valuenow={file.progress}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
                                <div
                                  className={`progress-fill ${file.status.toLowerCase()}`}
                                  style={{
                                    width: `${file.progress}%`,
                                  }}
                                />
                              </div>

                              <span>{file.progress}%</span>
                            </div>
                          </td>

                          <td>{file.time}</td>

                          <td>
                            <span
                              className={
                                file.anomaly === "—"
                                  ? ""
                                  : "anomaly-count"
                              }
                            >
                              {file.anomaly}
                            </span>
                          </td>
                        </tr>
                      ))}

                      {filteredFiles.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="empty-state"
                          >
                            No files match your search or selected
                            filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Insights */}
              <div className="bottom-grid">
                <section className="panel insight-panel">
                  <div className="insight-icon warning">
                    <ShieldAlert size={21} />
                  </div>

                  <div>
                    <h3>Recent Anomalies</h3>

                    <p>
                      Review suspicious transactions, invalid IFSC
                      codes and data quality issues.
                    </p>

                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setActivePage("Rejections")
                      }
                    >
                      Review anomalies →
                    </button>
                  </div>
                </section>

                <section className="panel insight-panel">
                  <div className="insight-icon purple-bg">
                    <WandSparkles size={21} />
                  </div>

                  <div>
                    <h3>Resolution Centre</h3>

                    <p>
                      Review rejected records and apply suggested
                      corrections before resubmission.
                    </p>

                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setActivePage("Resolution Centre")
                      }
                    >
                      Open resolutions →
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}

          {/* Fallback for any unimplemented page */}
          {!showDashboard &&
            activePage !== "File Monitoring" &&
            activePage !== "File Details" &&
            activePage !== "Rejections" &&
            activePage !== "Resolution Centre" &&
            activePage !== "Analytics" &&
            activePage !== "Master Data" &&
            activePage !== "Settings" && (
              <section className="page-placeholder">
                <div className="placeholder-icon">
                  {renderPageIcon()}
                </div>

                <h2>{activePage}</h2>

                <p>
                  {pageDescriptions[activePage] ??
                    "View file information and processing results."}
                </p>

                <span className="coming-soon">
                  Page selected · Implementation coming next
                </span>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActivePage("Dashboard")}
                >
                  <LayoutDashboard size={16} />
                  Back to Dashboard
                </button>
              </section>
            )}

          {/* Footer */}
          <footer className="page-footer">
            <CircleHelp size={15} />
            Concurrent File Processing &amp; Monitoring
            <span>Frontend prototype · Mock data</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Activity,
  AlertTriangle,
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

import {
  getDashboardData,
  subscribeDashboardSummary,
  type DashboardFile,
  type DashboardSummary,
} from "../services/dashboardApi";

/* =========================================================
   Navigation
   ========================================================= */

const navigation = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "File Monitoring",
    icon: Files,
  },
  {
    label: "File Details",
    icon: FileSearch,
  },
  {
    label: "Rejections",
    icon: ShieldAlert,
  },
  {
    label: "Resolution Centre",
    icon: WandSparkles,
  },
  {
    label: "Analytics",
    icon: Activity,
  },
  {
    label: "Master Data",
    icon: Database,
  },
  {
    label: "Settings",
    icon: Settings,
  },
];

const pageDescriptions: Record<
  string,
  string
> = {
  Settings:
    "Configure dashboard preferences and processing rules.",
};

/* =========================================================
   Helpers
   ========================================================= */

function displayFileType(
  type: DashboardFile["fileType"]
) {
  switch (type) {
    case "PAYMENTS":
      return "Payments";

    case "BANK_TRANSACTIONS":
      return "Bank Transactions";

    case "ACCOUNTS":
      return "Accounts";

    case "RATES":
      return "Rates";

    default:
      return type;
  }
}

function displayStatus(
  status: DashboardFile["status"]
) {
  switch (status) {
    case "COMPLETED":
      return "Completed";

    case "PROCESSING":
      return "Processing";

    case "FAILED":
      return "Failed";

    case "QUEUED":
      return "Queued";

    case "NEEDS_REVIEW":
      return "Needs Review";

    default:
      return status;
  }
}

function statusClass(
  status: DashboardFile["status"]
) {
  switch (status) {
    case "COMPLETED":
      return "completed";

    case "PROCESSING":
      return "processing";

    case "FAILED":
      return "failed";

    case "QUEUED":
      return "queued";

    case "NEEDS_REVIEW":
      return "queued";

    default:
      return "queued";
  }
}

function formatSize(
  bytes: string | number
) {
  const value = Number(bytes || 0);

  if (
    value >=
    1024 * 1024 * 1024
  ) {
    return `${(
      value /
      (1024 * 1024 * 1024)
    ).toFixed(2)} GB`;
  }

  if (value >= 1024 * 1024) {
    return `${(
      value /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(
      value / 1024
    ).toFixed(1)} KB`;
  }

  return `${value} B`;
}

function formatDuration(
  ms?: number | null
) {
  if (!ms || ms <= 0) {
    return "—";
  }

  const seconds =
    Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(seconds / 60);

  const remainingSeconds =
    seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}

/* =========================================================
   Dashboard
   ========================================================= */

export default function Dashboard() {
  /* -------------------------------------------------------
     Navigation state
     ------------------------------------------------------- */

  const [
    activePage,
    setActivePage,
  ] = useState("Dashboard");

  /* -------------------------------------------------------
     Dashboard filters
     ------------------------------------------------------- */

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    fileType,
    setFileType,
  ] = useState("All Types");

  const [
    status,
    setStatus,
  ] = useState("All Statuses");

  /* -------------------------------------------------------
     Backend state
     ------------------------------------------------------- */

  const [
    dashboardSummary,
    setDashboardSummary,
  ] =
    useState<DashboardSummary | null>(
      null
    );

  const [
    dashboardFiles,
    setDashboardFiles,
  ] =
    useState<DashboardFile[]>([]);

  const [
    dashboardLoading,
    setDashboardLoading,
  ] = useState(true);

  const [
    dashboardError,
    setDashboardError,
  ] = useState("");

  /* -------------------------------------------------------
     Fetch dashboard backend data
     ------------------------------------------------------- */

  useEffect(() => {
    let mounted = true;

    // Initial fetch
    // getDashboardSummary()
    //   .then((data) => {
    //     if (mounted) {
    //       setDashboardData(data);
    //     }
    //   })
    //   .catch((error) => {
    //     console.error('Initial dashboard fetch failed:', error);
    //   });

    // Real-time updates
    const unsubscribe = subscribeDashboardSummary((data) => {
      if (mounted) {
        setDashboardSummary(data);
        console.log(data)
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const loadDashboard =
    useCallback(
      async (
        silent = false
      ) => {
        try {
          if (!silent) {
            setDashboardLoading(
              true
            );
          }

          const {
            summary,
            files,
          } =
            await getDashboardData();

          setDashboardSummary(
            summary
          );

          setDashboardFiles(
            files
          );

          setDashboardError("");
        } catch (error) {
          console.error(
            "Dashboard load failed:",
            error
          );

          setDashboardError(
            error instanceof Error
              ? error.message
              : "Unable to load dashboard data"
          );
        } finally {
          if (!silent) {
            setDashboardLoading(
              false
            );
          }
        }
      },
      []
    );

  /* -------------------------------------------------------
     Initial load + live polling
     ------------------------------------------------------- */

  useEffect(() => {
    loadDashboard();

    const interval =
      window.setInterval(
        () => {
          loadDashboard(true);
        },
        2000
      );

    return () => {
      window.clearInterval(
        interval
      );
    };
  }, [loadDashboard]);

  /* -------------------------------------------------------
     Convert backend files into table-ready files
     ------------------------------------------------------- */

  const recentFiles =
    useMemo(() => {
      return dashboardFiles
        .slice(0, 10)
        .map((file) => {
          return {
            id: file.id,

            name:
              file.originalName ||
              file.fileName,

            type:
              displayFileType(
                file.fileType
              ),

            size:
              formatSize(
                file.sizeBytes
              ),

            status:
              displayStatus(
                file.status
              ),

            rawStatus:
              file.status,

            progress:
              Math.round(
                file.progress ??
                  0
              ),

            time:
              formatDuration(
                file.predictedDurationMs
              ),

            actualTime:
              formatDuration(
                file.actualDurationMs
              ),

            anomaly:
              file._count
                ?.anomalies ??
              0,

            rejections:
              file._count
                ?.faultLogs ??
              0,
          };
        });
    }, [dashboardFiles]);

  /* -------------------------------------------------------
     Apply dashboard filters
     ------------------------------------------------------- */

  const filteredFiles =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return recentFiles.filter(
        (file) => {
          const matchesSearch =
            file.name
              .toLowerCase()
              .includes(query);

          const matchesType =
            fileType ===
              "All Types" ||
            file.type ===
              fileType;

          const matchesStatus =
            status ===
              "All Statuses" ||
            file.status ===
              status;

          return (
            matchesSearch &&
            matchesType &&
            matchesStatus
          );
        }
      );
    }, [
      recentFiles,
      search,
      fileType,
      status,
    ]);

  /* -------------------------------------------------------
     Reset filters
     ------------------------------------------------------- */

  const resetFilters = () => {
    setSearch("");
    setFileType(
      "All Types"
    );
    setStatus(
      "All Statuses"
    );
  };

  /* -------------------------------------------------------
     Page helpers
     ------------------------------------------------------- */

  const showDashboard =
    activePage ===
    "Dashboard";

  const renderPageIcon =
    () => {
      switch (activePage) {
        case "Analytics":
          return (
            <Activity size={30} />
          );

        case "Master Data":
          return (
            <Database size={30} />
          );

        case "Settings":
          return (
            <Settings size={30} />
          );

        case "Rejections":
          return (
            <ShieldAlert
              size={30}
            />
          );

        case "Resolution Centre":
          return (
            <WandSparkles
              size={30}
            />
          );

        case "File Details":
          return (
            <FileSearch
              size={30}
            />
          );

        default:
          return (
            <Files size={30} />
          );
      }
    };

  /* =======================================================
     Render
     ======================================================= */

  return (
    <div className="app-layout">

      {/* ===================================================
          Sidebar
          =================================================== */}

      <aside className="sidebar">

        <div className="brand">

          <div className="brand-mark">
            <Database
              size={25}
            />
          </div>

          <div>
            <h2>
              Bank Ingestion
            </h2>

            <p>
              AI-Powered Platform
            </p>
          </div>

        </div>

        <nav className="navigation">

          <p className="nav-heading">
            WORKSPACE
          </p>

          {navigation.map(
            (item) => {
              const Icon =
                item.icon;

              return (
                <button
                  key={
                    item.label
                  }
                  type="button"
                  className={`nav-item ${
                    activePage ===
                    item.label
                      ? "active"
                      : ""
                  }`}
                  aria-current={
                    activePage ===
                    item.label
                      ? "page"
                      : undefined
                  }
                  onClick={() =>
                    setActivePage(
                      item.label
                    )
                  }
                >
                  <Icon
                    size={19}
                  />

                  <span>
                    {
                      item.label
                    }
                  </span>
                </button>
              );
            }
          )}

        </nav>

        <div className="sidebar-footer">

          <span
            className="online-dot"
          />

          <div>

            <strong>
              Processing engine
            </strong>

            <p>
              {dashboardSummary
                ?.worker
                ?.isRunning
                ? "System operational"
                : "Waiting for worker"}
            </p>

          </div>

        </div>

      </aside>

      {/* ===================================================
          Main
          =================================================== */}

      <main className="main-content">

        {/* =================================================
            Topbar
            ================================================= */}

        <header className="topbar">

          <div>

            <p className="eyebrow">
              BANK DATA OPERATIONS
            </p>

            <h1>
              Concurrent File
              Processing
            </h1>

            <p className="page-description">
              Monitor, validate and
              process bank data in
              parallel.
            </p>

          </div>

          <div className="topbar-actions">

            {showDashboard && (
              <label className="topbar-file-search">

                <Search
                  size={17}
                  aria-hidden="true"
                />

                <input
                  type="search"
                  placeholder="Search files..."
                  aria-label="Search files"
                  value={search}
                  onChange={(
                    event
                  ) =>
                    setSearch(
                      event.target
                        .value
                    )
                  }
                />

                {search && (
                  <button
                    type="button"
                    onClick={() =>
                      setSearch("")
                    }
                    aria-label="Clear file search"
                  >
                    ×
                  </button>
                )}

              </label>
            )}

            <div className="engine-status">

              <span
                className="online-dot"
              />

              {dashboardSummary
                ?.worker
                ?.isRunning
                ? "Engine Running"
                : "Engine Idle"}

            </div>

            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
              onClick={() =>
                window.alert(
                  dashboardSummary
                    ?.totalAnomalies
                    ? `${dashboardSummary.totalAnomalies} anomalies detected.`
                    : "No anomaly alerts."
                )
              }
            >
              <Bell size={20} />
            </button>

            <button
              className="profile-button"
              type="button"
            >
              <span className="avatar">
                AD
              </span>

              <span>
                Admin
              </span>

              <ChevronDown
                size={15}
              />
            </button>

          </div>

        </header>

        {/* =================================================
            Capsule navigation
            ================================================= */}

        <nav
          className="capsule-navigation"
          aria-label="Quick navigation"
        >

          {navigation.map(
            (item) => {
              const Icon =
                item.icon;

              return (
                <button
                  key={`quick-${item.label}`}
                  type="button"
                  className={`capsule-nav-item ${
                    activePage ===
                    item.label
                      ? "active"
                      : ""
                  }`}
                  aria-current={
                    activePage ===
                    item.label
                      ? "page"
                      : undefined
                  }
                  onClick={() =>
                    setActivePage(
                      item.label
                    )
                  }
                >
                  <Icon
                    size={15}
                    strokeWidth={
                      1.8
                    }
                  />

                  <span>
                    {
                      item.label
                    }
                  </span>
                </button>
              );
            }
          )}

        </nav>

        {/* =================================================
            Page body
            ================================================= */}

        <section className="page-body">

          {/* =================================================
              File Details
              ================================================= */}

          {activePage ===
            "File Details" && (
            <FileDetails
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              File Monitoring
              ================================================= */}

          {activePage ===
            "File Monitoring" && (
            <FileMonitoring />
          )}

          {/* =================================================
              Rejections
              ================================================= */}

          {activePage ===
            "Rejections" && (
            <Rejections
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              Resolution Centre
              ================================================= */}

          {activePage ===
            "Resolution Centre" && (
            <ResolutionCentre
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              Analytics
              ================================================= */}

          {activePage ===
            "Analytics" && (
            <Analytics
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              Master Data
              ================================================= */}

          {activePage ===
            "Master Data" && (
            <MasterData
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              Settings
              ================================================= */}

          {activePage ===
            "Settings" && (
            <SettingsPage
              onBack={() =>
                setActivePage(
                  "Dashboard"
                )
              }
            />
          )}

          {/* =================================================
              Dashboard
              ================================================= */}

          {showDashboard && (
            <>

              <div className="section-heading">

                <div>

                  <h2>
                    Operations
                    Overview
                  </h2>

                  <p>
                    Live snapshot of
                    file processing
                    activity.
                  </p>

                </div>

                <div className="date-label">
                  <Activity
                    size={16}
                  />
                  Live overview
                </div>

              </div>

              {/* Backend error */}

              {dashboardError && (
                <div className="rejection-note">

                  <AlertTriangle
                    size={18}
                  />

                  <p>
                    {
                      dashboardError
                    }
                  </p>

                </div>
              )}

              {/* Initial loading */}

              {dashboardLoading &&
                !dashboardSummary && (
                  <section className="panel">

                    <p>
                      Loading dashboard
                      data...
                    </p>

                  </section>
                )}

              {/* =================================================
                  KPI Cards
                  ================================================= */}

              <DashboardCards
                summary={
                  dashboardSummary
                }
              />

              {/* =================================================
                  Charts
                  ================================================= */}

              <DashboardCharts
                files={
                  dashboardFiles
                }
              />

              {/* =================================================
                  Recent Files
                  ================================================= */}

              <section className="panel monitoring-panel">

                <div className="panel-heading">

                  <div>

                    <h2>
                      Recent Files
                    </h2>

                    <p>
                      Review recent file
                      ingestion and
                      processing
                      activity.
                    </p>

                  </div>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setActivePage(
                        "File Monitoring"
                      )
                    }
                  >
                    <Files
                      size={17}
                    />
                    View all files
                  </button>

                </div>

                {/* Filters */}

                <div className="file-filters">

                  <select
                    aria-label="Filter by file type"
                    value={fileType}
                    onChange={(
                      event
                    ) =>
                      setFileType(
                        event.target
                          .value
                      )
                    }
                  >

                    <option value="All Types">
                      All Types
                    </option>

                    <option value="Payments">
                      Payments
                    </option>

                    <option value="Bank Transactions">
                      Bank Transactions
                    </option>

                    <option value="Accounts">
                      Accounts
                    </option>

                    <option value="Rates">
                      Rates
                    </option>

                  </select>

                  <select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(
                      event
                    ) =>
                      setStatus(
                        event.target
                          .value
                      )
                    }
                  >

                    <option value="All Statuses">
                      All Statuses
                    </option>

                    <option value="Completed">
                      Completed
                    </option>

                    <option value="Processing">
                      Processing
                    </option>

                    <option value="Failed">
                      Failed
                    </option>

                    <option value="Queued">
                      Queued
                    </option>

                    <option value="Needs Review">
                      Needs Review
                    </option>

                  </select>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={
                      resetFilters
                    }
                  >
                    <RotateCcw
                      size={15}
                    />
                    Reset
                  </button>

                </div>

                <p className="results-count">
                  Showing{" "}
                  {
                    filteredFiles.length
                  }{" "}
                  of{" "}
                  {
                    recentFiles.length
                  }{" "}
                  recent files
                </p>

                <div className="table-wrapper">

                  <table className="file-table">

                    <thead>

                      <tr>
                        <th>
                          File Name
                        </th>

                        <th>
                          Type
                        </th>

                        <th>
                          Size
                        </th>

                        <th>
                          Status
                        </th>

                        <th>
                          Progress
                        </th>

                        <th>
                          Predicted Time
                        </th>

                        <th>
                          Anomalies
                        </th>
                      </tr>

                    </thead>

                    <tbody>

                      {filteredFiles.map(
                        (file) => (
                          <tr
                            key={
                              file.id
                            }
                          >

                            <td className="file-name">

                              <Files
                                size={17}
                              />

                              {
                                file.name
                              }

                            </td>

                            <td>
                              {
                                file.type
                              }
                            </td>

                            <td>
                              {
                                file.size
                              }
                            </td>

                            <td>

                              <span
                                className={`status-badge ${statusClass(
                                  file.rawStatus
                                )}`}
                              >
                                {
                                  file.status
                                }
                              </span>

                            </td>

                            <td>

                              <div className="progress-cell">

                                <div
                                  className="progress-track"
                                  role="progressbar"
                                  aria-label={`${file.name} progress`}
                                  aria-valuenow={
                                    file.progress
                                  }
                                  aria-valuemin={
                                    0
                                  }
                                  aria-valuemax={
                                    100
                                  }
                                >

                                  <div
                                    className={`progress-fill ${statusClass(
                                      file.rawStatus
                                    )}`}
                                    style={{
                                      width: `${Math.min(
                                        file.progress,
                                        100
                                      )}%`,
                                    }}
                                  />

                                </div>

                                <span>
                                  {
                                    file.progress
                                  }
                                  %
                                </span>

                              </div>

                            </td>

                            <td>
                              {
                                file.time
                              }
                            </td>

                            <td>

                              <span
                                className={
                                  file.anomaly >
                                  0
                                    ? "anomaly-count"
                                    : ""
                                }
                              >
                                {file.anomaly >
                                0
                                  ? file.anomaly
                                  : "—"}
                              </span>

                            </td>

                          </tr>
                        )
                      )}

                      {!dashboardLoading &&
                        filteredFiles.length ===
                          0 && (
                          <tr>

                            <td
                              colSpan={
                                7
                              }
                              className="empty-state"
                            >
                              No files match
                              your search or
                              selected
                              filters.
                            </td>

                          </tr>
                        )}

                    </tbody>

                  </table>

                </div>

              </section>

              {/* =================================================
                  Bottom insights
                  ================================================= */}

              <div className="bottom-grid">

                <section className="panel insight-panel">

                  <div className="insight-icon warning">

                    <ShieldAlert
                      size={21}
                    />

                  </div>

                  <div>

                    <h3>
                      Validation Issues
                    </h3>

                    <p>
                      {dashboardSummary
                        ?.pendingRejections ??
                        0}{" "}
                      validation issues
                      currently require
                      review.
                    </p>

                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setActivePage(
                          "Rejections"
                        )
                      }
                    >
                      Review rejected
                      records →
                    </button>

                  </div>

                </section>

                <section className="panel insight-panel">

                  <div className="insight-icon purple-bg">

                    <WandSparkles
                      size={21}
                    />

                  </div>

                  <div>

                    <h3>
                      Resolution Centre
                    </h3>

                    <p>
                      {dashboardSummary
                        ?.needsReviewFiles ??
                        0}{" "}
                      files currently
                      require manual
                      review.
                    </p>

                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setActivePage(
                          "Resolution Centre"
                        )
                      }
                    >
                      Open resolutions
                      →
                    </button>

                  </div>

                </section>

              </div>

            </>
          )}

          {/* =================================================
              Fallback
              ================================================= */}

          {!showDashboard &&
            activePage !==
              "File Monitoring" &&
            activePage !==
              "File Details" &&
            activePage !==
              "Rejections" &&
            activePage !==
              "Resolution Centre" &&
            activePage !==
              "Analytics" &&
            activePage !==
              "Master Data" &&
            activePage !==
              "Settings" && (
              <section className="page-placeholder">

                <div className="placeholder-icon">
                  {
                    renderPageIcon()
                  }
                </div>

                <h2>
                  {activePage}
                </h2>

                <p>
                  {pageDescriptions[
                    activePage
                  ] ??
                    "View file information and processing results."}
                </p>

                <span className="coming-soon">
                  Page selected ·
                  Implementation
                  coming next
                </span>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    setActivePage(
                      "Dashboard"
                    )
                  }
                >
                  <LayoutDashboard
                    size={16}
                  />
                  Back to Dashboard
                </button>

              </section>
            )}

          {/* =================================================
              Footer
              ================================================= */}

          <footer className="page-footer">

            <CircleHelp
              size={15}
            />

            Concurrent File
            Processing &amp;
            Monitoring

            <span>
              Backend connected
            </span>

          </footer>

        </section>

      </main>

    </div>
  );
}
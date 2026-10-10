
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";

// type DashboardSummary = {
//   totalFiles: number;
//   completedFiles: number;
//   failedFiles: number;
//   activeProcessing: number;
//   queuedFiles: number;
//   averageProcessingTimeMs: number;
// };


import type { DashboardSummary } from "../types";

type DashboardChartsProps = {
  summary: DashboardSummary;
};

export default function DashboardCharts({
  summary,
}: DashboardChartsProps) {
  const statusData = [
    {
      name: "Completed",
      value: summary.completedFiles || 0,
      color: "#18a878",
    },
    {
      name: "Failed",
      value: summary.failedFiles || 0,
      color: "#e65362",
    },
    {
      name: "Processing",
      value: summary.activeProcessing || 0,
      color: "#3978e8",
    },
    {
      name: "Queued",
      value: summary.queuedFiles || 0,
      color: "#e6a23c",
    },
    {
      name: "Needs Review",
      value: summary.needsReviewFiles || 0,
      color: "#8c62df",
    },
  ];

  const fileTypeData = (summary.fileTypeStats || []).map((item) => ({
    type:
      {
        PAYMENTS: "Payments",
        BANK_TRANSACTIONS: "Bank-Txns",
        ACCOUNTS: "Accounts",
        RATES: "Rates",
      }[item.type] ?? item.type,
    files: item.files,
  }));

  const processingTimeData = (summary.processingTimeHistory || []).map(
    (item) => ({
      time: new Date(item.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      actual:
        item.actual == null ? null : Number((item.actual / 60000).toFixed(2)),
      predicted:
        item.predicted == null ? null : Number((item.predicted / 60000).toFixed(2)),
    })
  );

 

 

  return (
    <section className="charts-grid">
      <article className="panel chart-panel">
        <div className="chart-heading">
          <h3>Processing Status</h3>
          <p>Distribution of incoming files</p>
        </div>

        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                innerRadius={57}
                outerRadius={82}
                paddingAngle={3}
              >
                {statusData.map((item) => (
                  <Cell
                    key={item.name}
                    fill={item.color}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-legend">
          {statusData.map((item) => (
            <div
              key={item.name}
              className="legend-item"
            >
              <span
                className="legend-dot"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.name}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </article>

      <article className="panel chart-panel">
        <div className="chart-heading">
          <h3>Files by Type</h3>
          <p>Processing volume by category</p>
        </div>

        <div className="chart-container">
          {fileTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fileTypeData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e9edf4"
                />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Bar
                  dataKey="files"
                  name="Files"
                  fill="#064E3B"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">
              File-type statistics will appear when the
              backend provides grouped file counts.
            </p>
          )}
        </div>
      </article>

      <article className="panel chart-panel time-chart-panel">
        <div className="chart-heading">
          <h3>Actual vs Predicted Processing Time</h3>
          <p>Hourly average processing time in minutes</p>
        </div>

        <div className="chart-container">
          {processingTimeData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={processingTimeData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e9edf4"
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  unit="m"
                />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="#3978e8"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="Predicted"
                  stroke="#8c62df"
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">
              Processing-time history will appear when
              the backend provides time-series data.
            </p>
          )}
        </div>
      </article>
    </section>
  );
}

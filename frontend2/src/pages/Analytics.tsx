import {
  Activity,
  CheckCircle2,
  Clock,
  Files,
  ShieldAlert,
} from "lucide-react";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

const statusData = [
  { name: "Completed", value: 92, color: "#16a36a" },
  { name: "Failed", value: 10, color: "#e05252" },
  { name: "Processing", value: 14, color: "#3478f6" },
  { name: "Queued", value: 12, color: "#e6a23c" },
];

const typeData = [
  { type: "Payments", files: 38 },
  { type: "Transactions", files: 32 },
  { type: "Accounts", files: 25 },
  { type: "Rates", files: 18 },
];

const processingData = [
  { time: "09:00", actual: 2.8, predicted: 3.0 },
  { time: "10:00", actual: 3.2, predicted: 3.1 },
  { time: "11:00", actual: 2.6, predicted: 2.9 },
  { time: "12:00", actual: 3.5, predicted: 3.3 },
  { time: "13:00", actual: 2.9, predicted: 3.0 },
  { time: "14:00", actual: 2.4, predicted: 2.7 },
];

const metricCards = [
  {
    label: "Files processed",
    value: "128",
    detail: "Sample total",
    icon: Files,
    className: "analytics-blue",
  },
  {
    label: "Successful files",
    value: "92",
    detail: "Sample completed count",
    icon: CheckCircle2,
    className: "analytics-green",
  },
  {
    label: "Average processing",
    value: "2.8 min",
    detail: "Sample average",
    icon: Clock,
    className: "analytics-purple",
  },
  {
    label: "Anomalies detected",
    value: "27",
    detail: "Sample flagged issues",
    icon: ShieldAlert,
    className: "analytics-orange",
  },
];

interface AnalyticsProps {
  onBack: () => void;
}

export default function Analytics({ onBack }: AnalyticsProps) {
  return (
    <div className="analytics-page">
      <div className="page-heading">
        <button
          className="secondary-button"
          type="button"
          onClick={onBack}
        >
          ← Back to Dashboard
        </button>

        <h1>Processing Analytics</h1>
        <p>
          Review file throughput, processing times, and validation outcomes.
        </p>
      </div>

      <div className="analytics-demo-note">
        <Activity size={17} />
        <span>
          Demo analytics — all chart values are illustrative, not live metrics.
        </span>
      </div>

      <div className="analytics-metrics">
        {metricCards.map((metric) => {
          const Icon = metric.icon;

          return (
            <article
              className="analytics-metric"
              key={metric.label}
            >
              <div className={`analytics-metric-icon ${metric.className}`}>
                <Icon size={21} />
              </div>

              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </div>
            </article>
          );
        })}
      </div>

      <div className="analytics-chart-grid">
        {/* Processing status pie chart */}
        <section className="panel analytics-chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Processing Status</h2>
              <p>Sample distribution by file status</p>
            </div>
          </div>

          <div className="analytics-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={3}
                >
                  {statusData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.color}
                    />
                  ))}
                </Pie>

                <Tooltip />
                <Legend verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* File types bar chart */}
        <section className="panel analytics-chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Files by Type</h2>
              <p>Sample volume across file categories</p>
            </div>
          </div>

          <div className="analytics-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={typeData}
                margin={{
                  top: 10,
                  right: 12,
                  left: -15,
                  bottom: 5,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 11 }}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />

                <Bar
                  dataKey="files"
                  name="Files"
                  fill="#064E3B"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Actual versus predicted processing time */}
        <section className="panel analytics-chart-panel wide">
          <div className="panel-heading">
            <div>
              <h2>Actual vs Predicted Processing Time</h2>
              <p>Illustrative hourly comparison in minutes</p>
            </div>
          </div>

          <div className="analytics-chart analytics-line-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={processingData}
                margin={{
                  top: 10,
                  right: 20,
                  left: 0,
                  bottom: 5,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="time" />
                <YAxis unit=" min" />
                <Tooltip />
                <Legend />

                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="#3478f6"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />

                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="Predicted"
                  stroke="#16a36a"
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

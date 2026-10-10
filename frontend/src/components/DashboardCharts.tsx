
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

import type { ProcessingFile } from "../types";
import { STATUS_LABEL, TYPE_LABEL } from "../types";

const STATUS_COLOR: Record<string, string> = {
  Completed: "#18a878", "Needs Review": "#e6a23c", Failed: "#e65362", Processing: "#3978e8", Queued: "#9aa6b8",
};

function buildChartData(files: ProcessingFile[]) {
  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const f of files) {
    const s = STATUS_LABEL[f.status];
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    const t = TYPE_LABEL[f.fileType];
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const statusData = [...byStatus.entries()].map(([name, value]) => ({ name, value, color: STATUS_COLOR[name] ?? "#9aa6b8" }));
  const fileTypeData = [...byType.entries()].map(([type, count]) => ({ type, files: count }));
  // Actual vs predicted seconds for the latest finished files (oldest first)
  const processingTimeData = files
    .filter((f) => f.actualDurationMs !== null)
    .slice(0, 12)
    .reverse()
    .map((f) => ({
      time: (f.originalName ?? f.fileName).slice(0, 12),
      actual: Number(((f.actualDurationMs ?? 0) / 1000).toFixed(1)),
      predicted: f.predictedDurationMs !== null ? Number((f.predictedDurationMs / 1000).toFixed(1)) : null,
    }));
  return { statusData, fileTypeData, processingTimeData };
}

export default function DashboardCharts({ files }: { files: ProcessingFile[] }) {
  const { statusData, fileTypeData, processingTimeData } = buildChartData(files);
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
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-legend">
          {statusData.map((item) => (
            <div key={item.name} className="legend-item">
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
                fill="#3978e8"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="panel chart-panel time-chart-panel">
        <div className="chart-heading">
          <h3>Actual vs Predicted Processing Time</h3>
          <p>Seconds per file, latest finished files</p>
        </div>

        <div className="chart-container">
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
                unit="s"
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
        </div>
      </article>
    </section>
  );
}

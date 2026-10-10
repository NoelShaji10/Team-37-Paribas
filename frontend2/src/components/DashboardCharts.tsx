
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

const statusData = [
  { name: "Completed", value: 118, color: "#18a878" },
  { name: "Failed", value: 10, color: "#e65362" },
  { name: "Processing", value: 6, color: "#3978e8" },
  { name: "Queued", value: 4, color: "#e6a23c" },
];

const fileTypeData = [
  { type: "Payments", files: 42 },
  { type: "Bank-Txns", files: 35 },
  { type: "Accounts", files: 28 },
  { type: "Rates", files: 23 },
];

const processingTimeData = [
  { time: "09:00", actual: 2.8, predicted: 3.0 },
  { time: "10:00", actual: 3.2, predicted: 3.1 },
  { time: "11:00", actual: 2.5, predicted: 2.7 },
  { time: "12:00", actual: 3.6, predicted: 3.4 },
  { time: "13:00", actual: 2.9, predicted: 3.0 },
  { time: "14:00", actual: 2.4, predicted: 2.6 },
];

export default function DashboardCharts() {
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
                fill="#064E3B"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="panel chart-panel time-chart-panel">
        <div className="chart-heading">
          <h3>Actual vs Predicted Processing Time</h3>
          <p>Hourly average processing time in minutes</p>
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
        </div>
      </article>
    </section>
  );
}


import {
  Files,
  CheckCircle2,
  CircleX,
  Clock3,
  Hourglass,
} from "lucide-react";

import type { DashboardSummary } from "../types";
import { formatMs } from "../types";

function buildMetrics(summary: DashboardSummary | null) {
  const finished = summary ? summary.completedFiles + summary.needsReviewFiles + summary.failedFiles : 0;
  const clean = summary ? summary.completedFiles : 0;
  const pending = summary ? summary.queuedFiles + summary.activeProcessing : 0;
  return [
    { title: "Total Files Processed", value: summary ? String(finished) : "—",
      subtitle: "All time", change: summary ? `${summary.totalFiles} uploaded` : "", icon: Files, color: "blue" },
    { title: "Success Rate", value: finished ? `${((clean / finished) * 100).toFixed(1)}%` : "—",
      subtitle: "Loaded with no rejections", change: summary ? `${summary.needsReviewFiles} need review` : "",
      icon: CheckCircle2, color: "green" },
    { title: "Failed Files", value: summary ? String(summary.failedFiles) : "—",
      subtitle: "Processing errors", change: summary ? `${summary.totalAnomalies.toLocaleString()} anomalies flagged` : "",
      icon: CircleX, color: "red" },
    { title: "Avg. Processing Time", value: summary ? formatMs(summary.averageProcessingTimeMs) : "—",
      subtitle: "Per file", change: summary?.worker ? `${summary.worker.maxConcurrentJobs} in parallel` : "",
      icon: Clock3, color: "purple" },
    { title: "Pending / Queued", value: summary ? String(pending) : "—",
      subtitle: "Waiting or running", change: summary ? `${summary.activeProcessing} running` : "",
      icon: Hourglass, color: "orange" },
  ];
}

export default function DashboardCards({ summary }: { summary: DashboardSummary | null }) {
  const metrics = buildMetrics(summary);
  return (
    <section className="kpi-grid">
      {metrics.map((metric) => {
        const Icon = metric.icon;

        return (
          <article
            className={`kpi-card ${metric.color}`}
            key={metric.title}
          >
            <div className="kpi-icon">
              <Icon size={23} />
            </div>

            <div className="kpi-content">
              <p className="kpi-title">{metric.title}</p>
              <h2>{metric.value}</h2>
              <p className="kpi-subtitle">
                {metric.subtitle}
                <span className="kpi-change">{metric.change}</span>
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}

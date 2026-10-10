
import {
  Files,
  CheckCircle2,
  CircleX,
  Clock3,
  Hourglass,
} from "lucide-react";

import type { DashboardSummary } from "../types";

type DashboardCardsProps = {
  summary: DashboardSummary;
};

export default function DashboardCards({
  summary,
}: DashboardCardsProps) {
  const successRate =
    summary.totalFiles > 0
      ? (summary.completedFiles / summary.totalFiles) * 100
      : 0;

  const metrics = [
    {
      title: "Total Files Processed",
      value: summary.totalFiles.toLocaleString(),
      subtitle: "Total files",
      change: "Live",
      icon: Files,
      color: "blue",
    },
    {
      title: "Success Rate",
      value: `${successRate.toFixed(1)}%`,
      subtitle: "Completed / total",
      change: "Live",
      icon: CheckCircle2,
      color: "green",
    },
    {
      title: "Failed Files",
      value: summary.failedFiles.toLocaleString(),
      subtitle: "Failed processing",
      change: "Live",
      icon: CircleX,
      color: "red",
    },
    {
      title: "Avg. Processing Time",
      value:
        summary.averageProcessingTimeMs >= 60000
          ? `${(
              summary.averageProcessingTimeMs / 60000
            ).toFixed(1)} min`
          : `${(
              summary.averageProcessingTimeMs / 1000
            ).toFixed(1)} sec`,
      subtitle: "Per file",
      change: "Live",
      icon: Clock3,
      color: "purple",
    },
    {
      title: "Pending / Queued",
      value: summary.queuedFiles.toLocaleString(),
      subtitle: "Waiting to process",
      change: "Live",
      icon: Hourglass,
      color: "orange",
    },
  ];

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
                <span className="kpi-change">
                  {metric.change}
                </span>
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}

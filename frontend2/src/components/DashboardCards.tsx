
import {
  Files,
  CheckCircle2,
  CircleX,
  Clock3,
  Hourglass,
} from "lucide-react";

const metrics = [
  {
    title: "Total Files Processed",
    value: "128",
    subtitle: "Today",
    change: "+12%",
    icon: Files,
    color: "blue",
  },
  {
    title: "Success Rate",
    value: "92.2%",
    subtitle: "Today",
    change: "+3.1%",
    icon: CheckCircle2,
    color: "green",
  },
  {
    title: "Failed Files",
    value: "10",
    subtitle: "Today",
    change: "-2%",
    icon: CircleX,
    color: "red",
  },
  {
    title: "Avg. Processing Time",
    value: "2.8 min",
    subtitle: "Per file",
    change: "-18%",
    icon: Clock3,
    color: "purple",
  },
  {
    title: "Pending / Queued",
    value: "6",
    subtitle: "Waiting to process",
    change: "In queue",
    icon: Hourglass,
    color: "orange",
  },
];

export default function DashboardCards() {
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

// Layer 2 results for one file: counts by anomaly type and the individual flags with explanations.
import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";

import type { Anomaly } from "../types";

const METHOD_LABEL: Record<string, string> = {
  RULE: "Workbook rule",
  ROBUST_Z: "Robust statistics",
  SIGMA_Z: "Statistics (sigma)",
  IFOREST: "Isolation Forest (ML)",
};

function severity(score: number | null): { label: string; color: string } {
  const s = score ?? 0;
  if (s >= 0.9) return { label: "High", color: "#d43e50" };
  if (s >= 0.65) return { label: "Medium", color: "#b5760c" };
  return { label: "Low", color: "#1d65ce" };
}

export default function AnomalyPanel({ anomalies }: { anomalies: Anomaly[] }) {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [limit, setLimit] = useState(50);

  const groups = useMemo(() => {
    const m = new Map<string, { count: number; rule: string; method: string }>();
    for (const a of anomalies) {
      const g = m.get(a.anomalyType) ?? { count: 0, rule: a.details?.ruleRef ?? "", method: a.details?.method ?? "" };
      g.count += 1;
      m.set(a.anomalyType, g);
    }
    return [...m.entries()].sort((x, y) => y[1].count - x[1].count);
  }, [anomalies]);

  const visible = useMemo(
    () =>
      anomalies
        .filter((a) => typeFilter === "ALL" || a.anomalyType === typeFilter)
        .sort((x, y) => (y.score ?? 0) - (x.score ?? 0)),
    [anomalies, typeFilter]
  );

  return (
    <section className="details-panel">
      <div className="details-section-heading">
        <h2>Layer 2: Anomaly Detection ({anomalies.length.toLocaleString()} flags)</h2>
        <ShieldAlert size={20} />
      </div>

      {anomalies.length === 0 ? (
        <p>No anomalies flagged for this file.</p>
      ) : (
        <>
          <div className="anomaly-summary-grid">
            <button
              type="button"
              className={`anomaly-chip ${typeFilter === "ALL" ? "active" : ""}`}
              onClick={() => setTypeFilter("ALL")}
            >
              All <strong>{anomalies.length.toLocaleString()}</strong>
            </button>
            {groups.map(([type, g]) => (
              <button
                key={type}
                type="button"
                className={`anomaly-chip ${typeFilter === type ? "active" : ""}`}
                onClick={() => setTypeFilter(type)}
                title={`${g.rule} · ${METHOD_LABEL[g.method] ?? g.method}`}
              >
                {type.replaceAll("_", " ").toLowerCase()} <strong>{g.count.toLocaleString()}</strong>
                <small>{g.rule}</small>
              </button>
            ))}
          </div>

          <div className="table-wrapper">
            <table className="file-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Type</th>
                  <th>Workbook rule</th>
                  <th>Method</th>
                  <th>Severity</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((a) => {
                  const sev = severity(a.score);
                  return (
                    <tr key={a.id}>
                      <td>{a.rowNumber ?? "File"}</td>
                      <td>{a.anomalyType}</td>
                      <td>{a.details?.ruleRef ?? "—"}</td>
                      <td>{METHOD_LABEL[a.details?.method ?? ""] ?? a.details?.method ?? "—"}</td>
                      <td>
                        <span style={{ color: sev.color, fontWeight: 600 }}>
                          {sev.label} ({(a.score ?? 0).toFixed(2)})
                        </span>
                      </td>
                      <td className="anomaly-explanation">{a.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length > limit && (
            <button className="secondary-button" type="button" onClick={() => setLimit(limit + 100)}>
              Show more ({(visible.length - limit).toLocaleString()} remaining)
            </button>
          )}
        </>
      )}
    </section>
  );
}

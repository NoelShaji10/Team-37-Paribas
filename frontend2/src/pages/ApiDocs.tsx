import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink, RefreshCw } from "lucide-react";

import { API_URL, ML_URL } from "../services/api";

interface ApiDocsProps {
  onBack: () => void;
}

// The two Swagger UIs, served by the services themselves and shown here in a frame
const SERVICES = [
  {
    key: "backend",
    label: "Backend API",
    docs: `${API_URL}/api/docs`,
    health: `${API_URL}/health`,
    about: "Upload, file monitoring, dashboard summary and the Resolution Centre (accept / edit / reject).",
  },
  {
    key: "ml",
    label: "ML Service",
    docs: `${ML_URL}/docs`,
    health: `${ML_URL}/health`,
    about: "Layer 2 anomaly detection, AI normalisation and suggested fixes, ETA prediction, file-level validation.",
  },
] as const;

type Status = "checking" | "up" | "down";

export default function ApiDocs({ onBack }: ApiDocsProps) {
  const [active, setActive] = useState<(typeof SERVICES)[number]["key"]>("backend");
  const [status, setStatus] = useState<Record<string, Status>>({ backend: "checking", ml: "checking" });
  const [frameKey, setFrameKey] = useState(0);

  const check = useCallback(() => {
    for (const s of SERVICES) {
      setStatus((cur) => ({ ...cur, [s.key]: "checking" }));
      fetch(s.health)
        .then((r) => setStatus((cur) => ({ ...cur, [s.key]: r.ok ? "up" : "down" })))
        .catch(() => setStatus((cur) => ({ ...cur, [s.key]: "down" })));
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const service = SERVICES.find((s) => s.key === active)!;

  return (
    <div className="api-docs-page">
      <div className="page-heading">
        <button className="secondary-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>
        <h1>API Docs</h1>
        <p>
          Interactive Swagger UI for both services. Pick an endpoint, click <strong>Try it out</strong>, then{" "}
          <strong>Execute</strong>: calls run against the live services on this machine.
        </p>
      </div>

      <div className="api-docs-tabs">
        {SERVICES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`anomaly-chip ${active === s.key ? "active" : ""}`}
            onClick={() => setActive(s.key)}
          >
            <span className={`api-status-dot ${status[s.key]}`} aria-label={status[s.key]} />
            {s.label}
          </button>
        ))}
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            check();
            setFrameKey((k) => k + 1);
          }}
        >
          <RefreshCw size={15} />
          Reload
        </button>
        <a className="secondary-button" href={service.docs} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          Open in new tab
        </a>
      </div>

      <p className="api-docs-about">
        <BookOpen size={15} /> {service.about} <code>{service.docs}</code>
      </p>

      {status[active] === "down" ? (
        <div className="live-banner error">
          {service.label} is not reachable at {service.health}. Start everything with ./scripts/run_all.sh, then press
          Reload.
        </div>
      ) : (
        <iframe
          key={`${active}-${frameKey}`}
          className="api-docs-frame"
          src={service.docs}
          title={`${service.label} Swagger UI`}
        />
      )}
    </div>
  );
}

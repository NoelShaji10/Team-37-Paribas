import { useState } from "react";
import {
  Settings,
  Cpu,
  ShieldCheck,
  Bell,
  Monitor,
  Save,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";

interface SettingsPageProps {
  onBack: () => void;
}

interface AppSettings {
  maxConcurrentFiles: number;
  retryAttempts: number;
  processingTimeout: number;
  validateFileFormat: boolean;
  validateRequiredFields: boolean;
  validateDuplicates: boolean;
  validateIfsc: boolean;
  failureNotifications: boolean;
  anomalyNotifications: boolean;
  completionNotifications: boolean;
  emailNotifications: boolean;
  autoRefresh: boolean;
  refreshInterval: number;
  compactTable: boolean;
}

const defaultSettings: AppSettings = {
  maxConcurrentFiles: 5,
  retryAttempts: 3,
  processingTimeout: 30,
  validateFileFormat: true,
  validateRequiredFields: true,
  validateDuplicates: true,
  validateIfsc: true,
  failureNotifications: true,
  anomalyNotifications: true,
  completionNotifications: false,
  emailNotifications: false,
  autoRefresh: true,
  refreshInterval: 30,
  compactTable: false,
};

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] =
    useState<AppSettings>({ ...defaultSettings });
  const [saved, setSaved] = useState(false);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setSaved(false);
  };

  const handleSave = () => {
    // Demo only: this does not save to a backend or persistent storage.
    setSaved(true);
  };

  const handleReset = () => {
    setSettings({ ...defaultSettings });
    setSaved(false);
  };

  const toggleOptions = [
    {
      key: "validateFileFormat" as const,
      label: "File format validation",
      description: "Check file extensions and supported formats.",
    },
    {
      key: "validateRequiredFields" as const,
      label: "Required field validation",
      description: "Check that mandatory columns and values are present.",
    },
    {
      key: "validateDuplicates" as const,
      label: "Duplicate record detection",
      description: "Flag duplicate records during validation.",
    },
    {
      key: "validateIfsc" as const,
      label: "IFSC code validation",
      description: "Check bank IFSC codes against reference data.",
    },
  ];

  const notificationOptions = [
    {
      key: "failureNotifications" as const,
      label: "Processing failures",
      description: "Notify when a file fails processing.",
    },
    {
      key: "anomalyNotifications" as const,
      label: "Data anomalies",
      description: "Notify when validation detects suspicious data.",
    },
    {
      key: "completionNotifications" as const,
      label: "Processing completed",
      description: "Notify when file processing finishes successfully.",
    },
    {
      key: "emailNotifications" as const,
      label: "Email notifications",
      description: "Enable email alerts when a backend notification service is connected.",
    },
  ];

  return (
    <div className="settings-page">
      <div className="settings-page-heading">
        <div>
          <button
            className="secondary-button"
            type="button"
            onClick={onBack}
          >
            ← Back to Dashboard
          </button>

          <h1>Settings</h1>
          <p>
            Configure processing behavior, validation rules, notifications,
            and dashboard preferences.
          </p>
        </div>

        <div className="settings-heading-icon">
          <Settings size={26} />
        </div>
      </div>

      <div className="settings-demo-notice">
        <Settings size={18} />
        <span>
          Demo mode — settings are held in frontend state and reset when
          the page is reloaded.
        </span>
      </div>

      {saved && (
        <div className="settings-saved-message" role="status">
          <CheckCircle2 size={18} />
          Settings updated in this demo session.
        </div>
      )}

      <div className="settings-layout">
        {/* Processing preferences */}
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-icon blue">
              <Cpu size={21} />
            </div>
            <div>
              <h2>Processing Preferences</h2>
              <p>Configure how files should be processed.</p>
            </div>
          </div>

          <div className="settings-field">
            <div>
              <label htmlFor="maxConcurrentFiles">
                Maximum concurrent files
              </label>
              <p>Number of files to process at the same time.</p>
            </div>

            <select
              id="maxConcurrentFiles"
              value={settings.maxConcurrentFiles}
              onChange={(event) =>
                updateSetting(
                  "maxConcurrentFiles",
                  Number(event.target.value)
                )
              }
            >
              <option value={1}>1 file</option>
              <option value={2}>2 files</option>
              <option value={3}>3 files</option>
              <option value={5}>5 files</option>
              <option value={10}>10 files</option>
              <option value={20}>20 files</option>
            </select>
          </div>

          <div className="settings-field">
            <div>
              <label htmlFor="retryAttempts">Retry attempts</label>
              <p>Retries allowed when processing fails.</p>
            </div>

            <select
              id="retryAttempts"
              value={settings.retryAttempts}
              onChange={(event) =>
                updateSetting("retryAttempts", Number(event.target.value))
              }
            >
              <option value={0}>No retries</option>
              <option value={1}>1 attempt</option>
              <option value={2}>2 attempts</option>
              <option value={3}>3 attempts</option>
              <option value={5}>5 attempts</option>
            </select>
          </div>

          <div className="settings-field">
            <div>
              <label htmlFor="processingTimeout">
                Processing timeout
              </label>
              <p>Maximum allowed processing time per file.</p>
            </div>

            <select
              id="processingTimeout"
              value={settings.processingTimeout}
              onChange={(event) =>
                updateSetting(
                  "processingTimeout",
                  Number(event.target.value)
                )
              }
            >
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>
        </section>

        {/* Validation rules */}
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-icon green">
              <ShieldCheck size={21} />
            </div>
            <div>
              <h2>Validation Rules</h2>
              <p>Choose which checks the processing workflow should use.</p>
            </div>
          </div>

          <div className="settings-toggle-list">
            {toggleOptions.map((option) => (
              <label className="settings-toggle-row" key={option.key}>
                <div>
                  <strong>{option.label}</strong>
                  <p>{option.description}</p>
                </div>

                <input
                  type="checkbox"
                  checked={settings[option.key]}
                  onChange={(event) =>
                    updateSetting(option.key, event.target.checked)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        {/* Notifications */}
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-icon orange">
              <Bell size={21} />
            </div>
            <div>
              <h2>Notifications</h2>
              <p>Choose which events should trigger alerts.</p>
            </div>
          </div>

          <div className="settings-toggle-list">
            {notificationOptions.map((option) => (
              <label className="settings-toggle-row" key={option.key}>
                <div>
                  <strong>{option.label}</strong>
                  <p>{option.description}</p>
                </div>

                <input
                  type="checkbox"
                  checked={settings[option.key]}
                  onChange={(event) =>
                    updateSetting(option.key, event.target.checked)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        {/* Display preferences */}
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-icon purple">
              <Monitor size={21} />
            </div>
            <div>
              <h2>Display Preferences</h2>
              <p>Customize dashboard refresh and table display.</p>
            </div>
          </div>

          <label className="settings-toggle-row">
            <div>
              <strong>Automatic refresh</strong>
              <p>
                Enable automatic dashboard refresh when supported by the
                application.
              </p>
            </div>

            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={(event) =>
                updateSetting("autoRefresh", event.target.checked)
              }
            />
          </label>

          <div className="settings-field">
            <div>
              <label htmlFor="refreshInterval">
                Refresh interval
              </label>
              <p>Preferred interval, in seconds.</p>
            </div>

            <select
              id="refreshInterval"
              value={settings.refreshInterval}
              disabled={!settings.autoRefresh}
              onChange={(event) =>
                updateSetting(
                  "refreshInterval",
                  Number(event.target.value)
                )
              }
            >
              <option value={10}>10 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={120}>2 minutes</option>
            </select>
          </div>

          <label className="settings-toggle-row">
            <div>
              <strong>Compact tables</strong>
              <p>Prefer tighter spacing in data tables.</p>
            </div>

            <input
              type="checkbox"
              checked={settings.compactTable}
              onChange={(event) =>
                updateSetting("compactTable", event.target.checked)
              }
            />
          </label>
        </section>
      </div>

      <div className="settings-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={handleReset}
        >
          <RotateCcw size={16} />
          Reset to defaults
        </button>

        <button
          className="primary-button"
          type="button"
          onClick={handleSave}
        >
          <Save size={17} />
          Save Settings
        </button>
      </div>
    </div>
  );
}

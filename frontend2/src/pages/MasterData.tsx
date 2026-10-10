import { useMemo, useState } from "react";
import {
  Database,
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  RotateCcw,
} from "lucide-react";

type DataCategory = "Currencies" | "Bank Accounts" | "IFSC Codes";

interface MasterRecord {
  id: number;
  code: string;
  name: string;
  description: string;
  status: "Active" | "Inactive";
}

const initialData: Record<DataCategory, MasterRecord[]> = {
  Currencies: [
    {
      id: 1,
      code: "INR",
      name: "Indian Rupee",
      description: "Indian national currency",
      status: "Active",
    },
    {
      id: 2,
      code: "USD",
      name: "US Dollar",
      description: "United States dollar",
      status: "Active",
    },
    {
      id: 3,
      code: "EUR",
      name: "Euro",
      description: "Eurozone currency",
      status: "Active",
    },
    {
      id: 4,
      code: "GBP",
      name: "British Pound",
      description: "United Kingdom pound sterling",
      status: "Inactive",
    },
  ],
  "Bank Accounts": [
    {
      id: 5,
      code: "ACC1001",
      name: "Operations Account",
      description: "INR settlement account",
      status: "Active",
    },
    {
      id: 6,
      code: "ACC1002",
      name: "Payments Account",
      description: "Domestic payments processing",
      status: "Active",
    },
    {
      id: 7,
      code: "ACC1003",
      name: "Reconciliation Account",
      description: "Daily reconciliation",
      status: "Inactive",
    },
  ],
  "IFSC Codes": [
    {
      id: 8,
      code: "HDFC0001234",
      name: "HDFC Bank - Sample Branch",
      description: "Sample IFSC reference record",
      status: "Active",
    },
    {
      id: 9,
      code: "ICIC0001234",
      name: "ICICI Bank - Sample Branch",
      description: "Sample IFSC reference record",
      status: "Active",
    },
    {
      id: 10,
      code: "SBIN0001234",
      name: "State Bank - Sample Branch",
      description: "Sample IFSC reference record",
      status: "Inactive",
    },
  ],
};

const categories: DataCategory[] = [
  "Currencies",
  "Bank Accounts",
  "IFSC Codes",
];

interface MasterDataProps {
  onBack: () => void;
}

export default function MasterData({ onBack }: MasterDataProps) {
  const [data, setData] = useState(initialData);
  const [category, setCategory] = useState<DataCategory>("Currencies");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStatus, setFormStatus] =
    useState<"Active" | "Inactive">("Active");
  const [formError, setFormError] = useState("");

  const records = data[category];

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        record.code.toLowerCase().includes(query) ||
        record.name.toLowerCase().includes(query) ||
        record.description.toLowerCase().includes(query);

      const matchesStatus =
        statusFilter === "All" || record.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [records, search, statusFilter]);

  const activeCount = records.filter(
    (record) => record.status === "Active"
  ).length;

  const resetForm = () => {
    setFormCode("");
    setFormName("");
    setFormDescription("");
    setFormStatus("Active");
    setFormError("");
    setEditingId(null);
    setShowForm(false);
  };

  const openAddForm = () => {
    setEditingId(null);
    setFormCode("");
    setFormName("");
    setFormDescription("");
    setFormStatus("Active");
    setFormError("");
    setShowForm(true);
  };

  const openEditForm = (record: MasterRecord) => {
    setEditingId(record.id);
    setFormCode(record.code);
    setFormName(record.name);
    setFormDescription(record.description);
    setFormStatus(record.status);
    setFormError("");
    setShowForm(true);
  };

  const saveRecord = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const code = formCode.trim().toUpperCase();
    const name = formName.trim();
    const description = formDescription.trim();

    if (!code || !name || !description) {
      setFormError("Please complete all fields.");
      return;
    }

    const duplicate = records.some(
      (record) =>
        record.code.toLowerCase() === code.toLowerCase() &&
        record.id !== editingId
    );

    if (duplicate) {
      setFormError("A record with this code already exists.");
      return;
    }

    setData((current) => {
      const currentRecords = current[category];

      let updatedRecords: MasterRecord[];

      if (editingId !== null) {
        updatedRecords = currentRecords.map((record) =>
          record.id === editingId
            ? {
                ...record,
                code,
                name,
                description,
                status: formStatus,
              }
            : record
        );
      } else {
        const newRecord: MasterRecord = {
          id: Math.max(0, ...Object.values(current).flat().map((r) => r.id)) + 1,
          code,
          name,
          description,
          status: formStatus,
        };

        updatedRecords = [...currentRecords, newRecord];
      }

      return {
        ...current,
        [category]: updatedRecords,
      };
    });

    resetForm();
  };

  const deleteRecord = (record: MasterRecord) => {
    const confirmed = window.confirm(
      `Delete ${record.code} from ${category}? This only changes the demo data.`
    );

    if (!confirmed) return;

    setData((current) => ({
      ...current,
      [category]: current[category].filter(
        (item) => item.id !== record.id
      ),
    }));
  };

  const resetDemoData = () => {
    const confirmed = window.confirm(
      "Reset all master data to the original sample records?"
    );

    if (!confirmed) return;

    setData(initialData);
    setSearch("");
    setStatusFilter("All");
    resetForm();
  };

  return (
    <div className="master-data-page">
      <div className="master-data-heading">
        <div>
          <button
            className="secondary-button"
            type="button"
            onClick={onBack}
          >
            ← Back to Dashboard
          </button>

          <h1>Master Data Management</h1>
          <p>
            Maintain reference records used for bank file validation.
          </p>
        </div>

        <button
          className="primary-button"
          type="button"
          onClick={openAddForm}
        >
          <Plus size={17} />
          Add Record
        </button>
      </div>

      <div className="master-data-notice">
        <Database size={19} />
        <span>
          Demo mode: changes are held in frontend state and are not saved
          to a database.
        </span>
      </div>

      <div className="master-data-summary">
        <article className="master-summary-card">
          <span>Current category</span>
          <strong>{category}</strong>
        </article>

        <article className="master-summary-card">
          <span>Total records</span>
          <strong>{records.length}</strong>
        </article>

        <article className="master-summary-card">
          <span>Active records</span>
          <strong>{activeCount}</strong>
        </article>
      </div>

      <section className="panel master-data-panel">
        <div className="master-category-tabs">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`master-category-tab ${
                category === item ? "active" : ""
              }`}
              onClick={() => {
                setCategory(item);
                setSearch("");
                setStatusFilter("All");
                resetForm();
              }}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="master-data-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code, name or description..."
              aria-label="Search master data"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter records by status"
          >
            <option value="All">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter("All");
            }}
          >
            <RotateCcw size={15} />
            Reset filters
          </button>
        </div>

        {showForm && (
          <form className="master-record-form" onSubmit={saveRecord}>
            <div className="master-form-heading">
              <h3>{editingId !== null ? "Edit Record" : "Add New Record"}</h3>

              <button
                className="icon-button"
                type="button"
                aria-label="Close form"
                onClick={resetForm}
              >
                <X size={18} />
              </button>
            </div>

            <div className="master-form-grid">
              <label>
                Code
                <input
                  value={formCode}
                  onChange={(event) => setFormCode(event.target.value)}
                  placeholder="Enter unique code"
                  maxLength={40}
                  required
                />
              </label>

              <label>
                Name
                <input
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  placeholder="Enter name"
                  maxLength={100}
                  required
                />
              </label>

              <label className="master-description-field">
                Description
                <input
                  value={formDescription}
                  onChange={(event) =>
                    setFormDescription(event.target.value)
                  }
                  placeholder="Enter description"
                  maxLength={200}
                  required
                />
              </label>

              <label>
                Status
                <select
                  value={formStatus}
                  onChange={(event) =>
                    setFormStatus(
                      event.target.value as "Active" | "Inactive"
                    )
                  }
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>

            {formError && (
              <p className="master-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="master-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={resetForm}
              >
                Cancel
              </button>

              <button className="primary-button" type="submit">
                {editingId !== null ? "Save Changes" : "Add Record"}
              </button>
            </div>
          </form>
        )}

        <div className="master-table-caption">
          <h2>{category}</h2>
          <span>
            Showing {filteredRecords.length} of {records.length} records
          </span>
        </div>

        <div className="table-wrapper">
          <table className="file-table master-data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id}>
                  <td className="master-record-code">{record.code}</td>
                  <td>{record.name}</td>
                  <td>{record.description}</td>

                  <td>
                    <span
                      className={`status-badge ${
                        record.status === "Active"
                          ? "completed"
                          : "failed"
                      }`}
                    >
                      {record.status}
                    </span>
                  </td>

                  <td>
                    <div className="master-row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Edit ${record.code}`}
                        title="Edit record"
                        onClick={() => openEditForm(record)}
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        className="icon-button master-delete-button"
                        type="button"
                        aria-label={`Delete ${record.code}`}
                        title="Delete record"
                        onClick={() => deleteRecord(record)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No records match your search or selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="master-data-footer">
          <span>
            Reference records are sample data for frontend demonstration.
          </span>

          <button
            className="text-button"
            type="button"
            onClick={resetDemoData}
          >
            Reset demo data
          </button>
        </div>
      </section>
    </div>
  );
}

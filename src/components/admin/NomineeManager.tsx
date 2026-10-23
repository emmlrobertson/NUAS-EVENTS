"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Category } from "@prisma/client";

interface NomineeWithCategory {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  nomineeCode: string;
  displayOrder: number;
  isActive: boolean;
  isApproved: boolean;
  category: {
    id: string;
    title: string;
  };
}

interface NomineeManagerProps {
  categories: Category[];
  initialNominees: NomineeWithCategory[];
}

export default function NomineeManager({ categories, initialNominees }: NomineeManagerProps) {
  const router = useRouter();
  const [nominees, setNominees] = useState<NomineeWithCategory[]>(initialNominees);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [name, setName] = useState("");
  const [nomineeCode, setNomineeCode] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isApproved, setIsApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError("Please select an award category first.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/nominees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          name,
          nomineeCode: nomineeCode.toUpperCase().trim(),
          bio: bio || null,
          avatarUrl: avatarUrl || null,
          displayOrder: Number(displayOrder),
          isActive: true,
          isApproved,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create nominee");

      const selectedCat = categories.find((c) => c.id === categoryId);
      setSuccess(`Nominee "${name}" (${nomineeCode.toUpperCase()}) added successfully${isApproved ? " (Approved)" : " (Pending Approval)"}.`);
      setName("");
      setNomineeCode("");
      setBio("");
      setAvatarUrl("");
      setDisplayOrder(0);
      setIsApproved(false);
      router.refresh();

      setNominees((prev) => [
        ...prev,
        {
          ...data.nominee,
          category: {
            id: categoryId,
            title: selectedCat ? selectedCat.title : "Category",
          },
        },
      ]);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error creating nominee");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStatus(
    id: string,
    field: "isActive" | "isApproved",
    currentValue: boolean
  ) {
    setActionLoadingId(`${id}-${field}`);
    setError(null);
    setSuccess(null);

    const newValue = !currentValue;
    try {
      const res = await fetch("/api/admin/nominees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          [field]: newValue,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to update ${field}`);

      setNominees((prev) =>
        prev.map((nom) => (nom.id === id ? { ...nom, [field]: newValue } : nom))
      );

      const fieldLabel = field === "isApproved" ? (newValue ? "Approved" : "Unapproved (Pending)") : (newValue ? "Activated" : "Deactivated");
      setSuccess(`Nominee "${data.nominee.name}" was ${fieldLabel} successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error updating nominee status");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="manager-grid">
      {/* Creation Card */}
      <div className="manager-form-card">
        <h2 className="box-title">Add Official Nominee</h2>
        {error && <div className="admin-alert-error">{error}</div>}
        {success && <div className="admin-alert-success">{success}</div>}

        <form onSubmit={handleCreate} className="admin-form">
          <div className="form-group">
            <label htmlFor="nom-category">Award Category *</label>
            <select
              id="nom-category"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="admin-input"
            >
              <option value="" disabled>
                -- Select Category --
              </option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.title}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="nom-name">Nominee Name *</label>
            <input
              id="nom-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Samuel K. Mensah"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="nom-code">Nominee Voting Code * (e.g. EXEC-01)</label>
            <input
              id="nom-code"
              type="text"
              required
              value={nomineeCode}
              onChange={(e) => setNomineeCode(e.target.value.toUpperCase().replace(/\s+/g, "-"))}
              placeholder="Unique Voting Code"
              className="admin-input"
              style={{ textTransform: "uppercase" }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="nom-bio">Short Bio or Citation</label>
            <textarea
              id="nom-bio"
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Brief biography or achievements of the nominee"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="nom-avatar">Avatar or Photo URL</label>
            <input
              id="nom-avatar"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="nom-order">Display Order</label>
            <input
              id="nom-order"
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
              className="admin-input"
            />
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              id="nom-approved"
              type="checkbox"
              checked={isApproved}
              onChange={(e) => setIsApproved(e.target.checked)}
              style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
            />
            <label htmlFor="nom-approved" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem" }}>
              Approve immediately (unchecked nominees remain Pending Review)
            </label>
          </div>

          <button type="submit" disabled={loading} className="admin-submit-btn">
            {loading ? "Saving..." : "Add Nominee"}
          </button>
        </form>
      </div>

      {/* Nominees Table Card */}
      <div className="manager-table-card">
        <h2 className="box-title">Nominees Roster ({nominees.length})</h2>
        {nominees.length === 0 ? (
          <p className="empty-table-notice">No nominees created yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Nominee</th>
                <th>Category</th>
                <th>Active</th>
                <th>Approval</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {nominees.map((nom) => {
                const isActLoading = actionLoadingId === `${nom.id}-isActive`;
                const isAppLoading = actionLoadingId === `${nom.id}-isApproved`;

                return (
                  <tr key={nom.id}>
                    <td>
                      <span className="nominee-code-pill">{nom.nomineeCode}</span>
                    </td>
                    <td>
                      <strong>{nom.name}</strong>
                      {nom.bio && <p className="table-sub">{nom.bio}</p>}
                    </td>
                    <td>{nom.category.title}</td>
                    <td>
                      <span
                        className={`status-pill ${
                          nom.isActive ? "status-published" : "status-draft"
                        }`}
                      >
                        {nom.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          nom.isApproved ? "status-published" : "status-pill-pending"
                        }`}
                      >
                        {nom.isApproved ? "Approved" : "Pending Review"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          disabled={isAppLoading}
                          onClick={() => handleToggleStatus(nom.id, "isApproved", nom.isApproved)}
                          className="logout-btn"
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.5rem",
                            borderColor: nom.isApproved ? "#f59e0b" : "#10b981",
                            color: nom.isApproved ? "#b45309" : "#047857",
                          }}
                        >
                          {isAppLoading
                            ? "Updating..."
                            : nom.isApproved
                            ? "Revoke Approval"
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={isActLoading}
                          onClick={() => handleToggleStatus(nom.id, "isActive", nom.isActive)}
                          className="logout-btn"
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.5rem",
                            borderColor: nom.isActive ? "#ef4444" : "#3b82f6",
                            color: nom.isActive ? "#b91c1c" : "#1d4ed8",
                          }}
                        >
                          {isActLoading
                            ? "Updating..."
                            : nom.isActive
                            ? "Deactivate"
                            : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

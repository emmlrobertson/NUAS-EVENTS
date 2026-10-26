"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Category } from "@prisma/client";
import NomineePhotoPicker from "./NomineePhotoPicker";

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

  // Edit Modal State
  const [editingNominee, setEditingNominee] = useState<NomineeWithCategory | null>(null);
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editName, setEditName] = useState("");
  const [editNomineeCode, setEditNomineeCode] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);
  const [editDisplayOrder, setEditDisplayOrder] = useState(0);
  const [editIsActive, setEditIsActive] = useState(true);
  const [editIsApproved, setEditIsApproved] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
          name: name.trim(),
          nomineeCode: nomineeCode.toUpperCase().trim(),
          bio: bio.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
          displayOrder: Number(displayOrder),
          isActive: true,
          isApproved,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create nominee");

      const selectedCat = categories.find((c) => c.id === categoryId);
      setSuccess(
        `Nominee "${name}" (${nomineeCode.toUpperCase()}) added successfully${
          isApproved ? " (Approved)" : " (Pending Approval)"
        }.`
      );
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

  function openEditModal(nom: NomineeWithCategory) {
    setEditingNominee(nom);
    setEditCategoryId(nom.category.id);
    setEditName(nom.name);
    setEditNomineeCode(nom.nomineeCode);
    setEditBio(nom.bio || "");
    setEditAvatarUrl(nom.avatarUrl || null);
    setEditDisplayOrder(nom.displayOrder);
    setEditIsActive(nom.isActive);
    setEditIsApproved(nom.isApproved);
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingNominee) return;

    setEditLoading(true);
    setEditError(null);

    try {
      const res = await fetch("/api/admin/nominees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingNominee.id,
          categoryId: editCategoryId,
          name: editName.trim(),
          nomineeCode: editNomineeCode.toUpperCase().trim(),
          bio: editBio.trim() || null,
          avatarUrl: editAvatarUrl || null,
          displayOrder: Number(editDisplayOrder),
          isActive: editIsActive,
          isApproved: editIsApproved,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update nominee");

      const selectedCat = categories.find((c) => c.id === editCategoryId);

      setNominees((prev) =>
        prev.map((nom) =>
          nom.id === editingNominee.id
            ? {
                ...data.nominee,
                category: {
                  id: editCategoryId,
                  title: selectedCat ? selectedCat.title : nom.category.title,
                },
              }
            : nom
        )
      );

      setSuccess(`Nominee "${editName}" updated successfully.`);
      setEditingNominee(null);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setEditError(err.message);
      } else {
        setEditError("Failed to update nominee details");
      }
    } finally {
      setEditLoading(false);
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

      const fieldLabel =
        field === "isApproved"
          ? newValue
            ? "Approved"
            : "Unapproved (Pending)"
          : newValue
          ? "Activated"
          : "Deactivated";
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

  async function handleDeleteNominee(id: string, nomineeName: string) {
    if (
      !window.confirm(
        `Are you sure you want to delete nominee "${nomineeName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    setActionLoadingId(`${id}-delete`);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/nominees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete nominee");
      }

      setNominees((prev) => prev.filter((nom) => nom.id !== id));
      setSuccess(`Nominee "${nomineeName}" deleted successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error deleting nominee");
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
            <label htmlFor="nom-name">Nominee Full Name *</label>
            <input
              id="nom-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John K. Mensah"
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
            <small
              style={{
                color: "var(--color-text-dim)",
                fontSize: "0.75rem",
                marginTop: "0.25rem",
                display: "block",
              }}
            >
              Codes must be unique across the event and uppercase (e.g. EXEC-01, SPIR-02).
            </small>
          </div>

          {/* Photo Picker Component for Creation */}
          <NomineePhotoPicker
            value={avatarUrl}
            onChange={(url) => setAvatarUrl(url || "")}
            nomineeName={name || "New Nominee"}
            nomineeCode={nomineeCode}
            disabled={loading}
          />

          <div className="form-group">
            <label htmlFor="nom-bio">Nominee Citation / Bio (Optional)</label>
            <textarea
              id="nom-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Brief citation or achievements supporting this nomination"
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
                const isDelLoading = actionLoadingId === `${nom.id}-delete`;

                const initials = nom.name
                  .trim()
                  .split(/\s+/)
                  .map((n) => n[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "NA";

                return (
                  <tr key={nom.id}>
                    <td>
                      <span className="nominee-code-pill">{nom.nomineeCode}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div
                          style={{
                            width: "38px",
                            height: "38px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            background: "linear-gradient(135deg, #1b365d 0%, #10223d 100%)",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            flexShrink: 0,
                            border: "1px solid var(--color-border-card, #e2e8f0)",
                            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
                          }}
                        >
                          {nom.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={nom.avatarUrl}
                              alt={nom.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            initials
                          )}
                        </div>
                        <div>
                          <strong>{nom.name}</strong>
                          {nom.bio && <p className="table-sub">{nom.bio}</p>}
                        </div>
                      </div>
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
                        {nom.isApproved ? (
                          <>
                            <span aria-hidden="true" style={{ fontSize: "0.7rem" }}>
                              &#10003;
                            </span>
                            Approved
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" style={{ fontSize: "0.7rem" }}>
                              &#9203;
                            </span>
                            Pending Review
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="admin-action-btn-group">
                        <button
                          type="button"
                          disabled={isAppLoading || isDelLoading}
                          onClick={() => openEditModal(nom)}
                          className="admin-action-btn admin-btn-edit"
                          title="Edit nominee details and photo"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isAppLoading || isDelLoading}
                          onClick={() => handleToggleStatus(nom.id, "isApproved", nom.isApproved)}
                          className={`admin-action-btn ${
                            nom.isApproved ? "admin-btn-revoke" : "admin-btn-approve"
                          }`}
                          title={nom.isApproved ? "Revoke nominee approval" : "Approve nominee"}
                        >
                          {isAppLoading
                            ? "Updating..."
                            : nom.isApproved
                            ? "Revoke Approval"
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={isActLoading || isDelLoading}
                          onClick={() => handleToggleStatus(nom.id, "isActive", nom.isActive)}
                          className={`admin-action-btn ${
                            nom.isActive ? "admin-btn-deactivate" : "admin-btn-activate"
                          }`}
                          title={nom.isActive ? "Deactivate nominee" : "Activate nominee"}
                        >
                          {isActLoading
                            ? "Updating..."
                            : nom.isActive
                            ? "Deactivate"
                            : "Activate"}
                        </button>
                        <button
                          type="button"
                          disabled={isDelLoading || isAppLoading || isActLoading}
                          onClick={() => handleDeleteNominee(nom.id, nom.name)}
                          className="admin-action-btn admin-btn-delete"
                          title="Delete nominee"
                        >
                          {isDelLoading ? "Deleting..." : "Delete"}
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

      {/* Edit Nominee Modal */}
      {editingNominee && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
        >
          <div
            className="manager-form-card"
            style={{
              maxWidth: "560px",
              width: "100%",
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              padding: "1.75rem",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <h3 className="box-title" style={{ margin: 0, fontSize: "1.15rem" }}>
                Edit Nominee: {editingNominee.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingNominee(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  lineHeight: 1,
                }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            {editError && (
              <div className="admin-alert-error" style={{ marginBottom: "1rem" }}>
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="admin-form">
              {/* Photo Picker in Edit Modal */}
              <NomineePhotoPicker
                value={editAvatarUrl}
                onChange={(url) => setEditAvatarUrl(url)}
                nomineeName={editName}
                nomineeCode={editNomineeCode}
                nomineeId={editingNominee.id}
                disabled={editLoading}
              />

              <div className="form-group">
                <label>Nominee Full Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div className="form-group">
                <label>Nominee Voting Code *</label>
                <input
                  type="text"
                  required
                  value={editNomineeCode}
                  onChange={(e) =>
                    setEditNomineeCode(e.target.value.toUpperCase().replace(/\s+/g, "-"))
                  }
                  className="admin-input"
                  style={{ textTransform: "uppercase" }}
                />
              </div>

              <div className="form-group">
                <label>Award Category *</label>
                <select
                  required
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="admin-input"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Citation / Bio</label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div className="form-group">
                <label>Display Order</label>
                <input
                  type="number"
                  value={editDisplayOrder}
                  onChange={(e) => setEditDisplayOrder(Number(e.target.value))}
                  className="admin-input"
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  margin: "0.75rem 0 1.25rem 0",
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    style={{ width: "1rem", height: "1rem" }}
                  />
                  Active (Accepting Votes)
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editIsApproved}
                    onChange={(e) => setEditIsApproved(e.target.checked)}
                    style={{ width: "1rem", height: "1rem" }}
                  />
                  Approved (Publicly Visible)
                </label>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setEditingNominee(null)}
                  disabled={editLoading}
                  className="admin-action-btn admin-btn-deactivate"
                  style={{ padding: "0.55rem 1rem", fontSize: "0.875rem" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="admin-submit-btn"
                  style={{ marginTop: 0, padding: "0.55rem 1.25rem", fontSize: "0.875rem" }}
                >
                  {editLoading ? "Saving Changes..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

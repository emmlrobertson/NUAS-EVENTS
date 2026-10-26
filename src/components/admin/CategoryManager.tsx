"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CategoryWithCount {
  id: string;
  title: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  isApproved: boolean;
  _count: {
    nominees: number;
  };
}

interface CategoryManagerProps {
  eventId: string;
  initialCategories: CategoryWithCount[];
}

export default function CategoryManager({ eventId, initialCategories }: CategoryManagerProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryWithCount[]>(initialCategories);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isApproved, setIsApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          title,
          description: description || null,
          displayOrder: Number(displayOrder),
          isActive: true,
          isApproved,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create category");

      setSuccess(`Category "${title}" created successfully${isApproved ? " (Approved)" : " (Pending Approval)"}.`);
      setTitle("");
      setDescription("");
      setDisplayOrder(0);
      setIsApproved(false);
      router.refresh();

      setCategories((prev) => [
        ...prev,
        { ...data.category, _count: { nominees: 0 } },
      ]);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error creating category");
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
      const res = await fetch("/api/admin/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          [field]: newValue,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to update ${field}`);

      setCategories((prev) =>
        prev.map((cat) => (cat.id === id ? { ...cat, [field]: newValue } : cat))
      );

      const fieldLabel = field === "isApproved" ? (newValue ? "Approved" : "Unapproved (Pending)") : (newValue ? "Activated" : "Deactivated");
      setSuccess(`Category "${data.category.title}" was ${fieldLabel} successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error updating category status");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleDeleteCategory(id: string, categoryTitle: string, nomineeCount: number) {
    const confirmPrompt =
      nomineeCount > 0
        ? `Are you sure you want to delete category "${categoryTitle}" and its ${nomineeCount} nominee(s)? This action cannot be undone.`
        : `Are you sure you want to delete category "${categoryTitle}"? This action cannot be undone.`;

    if (!window.confirm(confirmPrompt)) {
      return;
    }

    setActionLoadingId(`${id}-delete`);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete category");
      }

      setCategories((prev) => prev.filter((cat) => cat.id !== id));
      setSuccess(`Category "${categoryTitle}" deleted successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error deleting category");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="manager-grid">
      {/* Creation Card */}
      <div className="manager-form-card">
        <h2 className="box-title">Add Award Category</h2>
        {error && <div className="admin-alert-error">{error}</div>}
        {success && <div className="admin-alert-success">{success}</div>}

        <form onSubmit={handleCreate} className="admin-form">
          <div className="form-group">
            <label htmlFor="cat-title">Category Title *</label>
            <input
              id="cat-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Most Dedicated Executive"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="cat-desc">Description</label>
            <textarea
              id="cat-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Criteria or purpose of this award category"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="cat-order">Display Order</label>
            <input
              id="cat-order"
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
              className="admin-input"
            />
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              id="cat-approved"
              type="checkbox"
              checked={isApproved}
              onChange={(e) => setIsApproved(e.target.checked)}
              style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
            />
            <label htmlFor="cat-approved" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem" }}>
              Approve immediately (unchecked categories remain Pending Review)
            </label>
          </div>

          <button type="submit" disabled={loading} className="admin-submit-btn">
            {loading ? "Saving..." : "Create Category"}
          </button>
        </form>
      </div>

      {/* Categories Table Card */}
      <div className="manager-table-card">
        <h2 className="box-title">Existing Categories ({categories.length})</h2>
        {categories.length === 0 ? (
          <p className="empty-table-notice">No categories created yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Category Title</th>
                <th>Nominees</th>
                <th>Active</th>
                <th>Approval</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const isActLoading = actionLoadingId === `${cat.id}-isActive`;
                const isAppLoading = actionLoadingId === `${cat.id}-isApproved`;
                const isDelLoading = actionLoadingId === `${cat.id}-delete`;

                return (
                  <tr key={cat.id}>
                    <td>{cat.displayOrder}</td>
                    <td>
                      <strong>{cat.title}</strong>
                      {cat.description && <p className="table-sub">{cat.description}</p>}
                    </td>
                    <td>{cat._count.nominees}</td>
                    <td>
                      <span
                        className={`status-pill ${
                          cat.isActive ? "status-published" : "status-draft"
                        }`}
                      >
                        {cat.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          cat.isApproved ? "status-published" : "status-pill-pending"
                        }`}
                      >
                        {cat.isApproved ? (
                          <>
                            <span aria-hidden="true" style={{ fontSize: "0.7rem" }}>&#10003;</span>
                            Approved
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" style={{ fontSize: "0.7rem" }}>&#9203;</span>
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
                          onClick={() => handleToggleStatus(cat.id, "isApproved", cat.isApproved)}
                          className={`admin-action-btn ${cat.isApproved ? "admin-btn-revoke" : "admin-btn-approve"}`}
                          title={cat.isApproved ? "Revoke category approval" : "Approve category"}
                        >
                          {isAppLoading
                            ? "Updating..."
                            : cat.isApproved
                            ? "Revoke Approval"
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={isActLoading || isDelLoading}
                          onClick={() => handleToggleStatus(cat.id, "isActive", cat.isActive)}
                          className={`admin-action-btn ${cat.isActive ? "admin-btn-deactivate" : "admin-btn-activate"}`}
                          title={cat.isActive ? "Deactivate category" : "Activate category"}
                        >
                          {isActLoading
                            ? "Updating..."
                            : cat.isActive
                            ? "Deactivate"
                            : "Activate"}
                        </button>
                        <button
                          type="button"
                          disabled={isDelLoading || isAppLoading || isActLoading}
                          onClick={() => handleDeleteCategory(cat.id, cat.title, cat._count.nominees)}
                          className="admin-action-btn admin-btn-delete"
                          title="Delete category"
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
    </div>
  );
}

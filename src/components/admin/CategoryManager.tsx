"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CategoryWithCount {
  id: string;
  title: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
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
  const [loading, setLoading] = useState(false);
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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create category");

      setSuccess(`Category "${title}" created successfully.`);
      setTitle("");
      setDescription("");
      setDisplayOrder(0);
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

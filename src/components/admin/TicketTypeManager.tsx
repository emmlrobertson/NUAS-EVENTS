"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TicketTypeWithCount {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  priceInPesewas: number;
  totalCapacity: number;
  soldQuantity: number;
  reservedQuantity: number;
  salesStart: string | Date;
  salesEnd: string | Date;
  isActive: boolean;
  createdAt: string | Date;
  _count: {
    orderItems: number;
    issuedTickets: number;
  };
}

interface TicketTypeManagerProps {
  eventId: string;
  initialTicketTypes: TicketTypeWithCount[];
}

export default function TicketTypeManager({ eventId, initialTicketTypes }: TicketTypeManagerProps) {
  const router = useRouter();
  const [ticketTypes, setTicketTypes] = useState<TicketTypeWithCount[]>(initialTicketTypes);

  // Form states for creation
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceInGhs, setPriceInGhs] = useState("0.00");
  const [totalCapacity, setTotalCapacity] = useState(50);
  const [salesStart, setSalesStart] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [salesEnd, setSalesEnd] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
  );
  const [isActive, setIsActive] = useState(true);

  // Edit modal state
  const [editingType, setEditingType] = useState<TicketTypeWithCount | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriceInGhs, setEditPriceInGhs] = useState("0.00");
  const [editCapacity, setEditCapacity] = useState(0);
  const [editSalesStart, setEditSalesStart] = useState("");
  const [editSalesEnd, setEditSalesEnd] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Convert GHS string to integer pesewas
  function ghsToPesewas(ghs: string): number {
    const parsed = parseFloat(ghs);
    if (isNaN(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
  }

  // Convert integer pesewas to formatted GHS
  function pesewasToGhs(pesewas: number): string {
    return (pesewas / 100).toFixed(2);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const priceInPesewas = ghsToPesewas(priceInGhs);

    try {
      const res = await fetch("/api/admin/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          name,
          description: description || null,
          priceInPesewas,
          totalCapacity: Number(totalCapacity),
          salesStart: new Date(salesStart).toISOString(),
          salesEnd: new Date(salesEnd).toISOString(),
          isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket type");

      setSuccess(`Ticket Type "${name}" created successfully at GH₵ ${pesewasToGhs(priceInPesewas)}.`);
      setName("");
      setDescription("");
      setPriceInGhs("0.00");
      setTotalCapacity(50);
      setIsActive(true);
      router.refresh();

      setTicketTypes((prev) => [
        ...prev,
        {
          ...data.ticketType,
          _count: { orderItems: 0, issuedTickets: 0 },
        },
      ]);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error creating ticket type");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    setActionLoadingId(`toggle-${id}`);
    setError(null);
    setSuccess(null);

    const newActive = !currentActive;
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          isActive: newActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update ticket status");

      setTicketTypes((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isActive: newActive } : t))
      );

      const statusWord = newActive ? "Activated" : "Deactivated";
      setSuccess(`Ticket Type "${data.ticketType.name}" ${statusWord} successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error toggling ticket status");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  function openEditModal(tt: TicketTypeWithCount) {
    setEditingType(tt);
    setEditName(tt.name);
    setEditDesc(tt.description || "");
    setEditPriceInGhs(pesewasToGhs(tt.priceInPesewas));
    setEditCapacity(tt.totalCapacity);
    setEditSalesStart(new Date(tt.salesStart).toISOString().slice(0, 16));
    setEditSalesEnd(new Date(tt.salesEnd).toISOString().slice(0, 16));
    setEditIsActive(tt.isActive);
    setError(null);
    setSuccess(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingType) return;

    setActionLoadingId(`edit-${editingType.id}`);
    setError(null);
    setSuccess(null);

    const priceInPesewas = ghsToPesewas(editPriceInGhs);

    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingType.id,
          eventId,
          name: editName,
          description: editDesc || null,
          priceInPesewas,
          totalCapacity: Number(editCapacity),
          salesStart: new Date(editSalesStart).toISOString(),
          salesEnd: new Date(editSalesEnd).toISOString(),
          isActive: editIsActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update ticket type");

      setTicketTypes((prev) =>
        prev.map((t) =>
          t.id === editingType.id
            ? { ...t, ...data.ticketType, _count: t._count }
            : t
        )
      );

      setSuccess(`Ticket Type "${editName}" updated successfully.`);
      setEditingType(null);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error updating ticket type");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleDelete(id: string, typeName: string) {
    if (!window.confirm(`Are you sure you want to delete "${typeName}"? This action cannot be undone.`)) {
      return;
    }

    setActionLoadingId(`del-${id}`);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/tickets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete ticket type");

      setTicketTypes((prev) => prev.filter((t) => t.id !== id));
      setSuccess(data.message || `Ticket type "${typeName}" deleted successfully.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error deleting ticket type");
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="manager-grid">
      {/* Creation Card */}
      <div className="manager-form-card">
        <h2 className="box-title">Create Ticket Type</h2>
        {error && <div className="admin-alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}
        {success && <div className="admin-alert-success" style={{ marginBottom: "1rem" }}>{success}</div>}

        <div className="admin-info-box" style={{ marginBottom: "1rem", fontSize: "0.825rem", borderLeft: "4px solid var(--color-gold)" }}>
          <strong>Organizer Configuration Notice:</strong> Ticket tiers, official prices, and venue capacity allocations must be confirmed by the event organizing committee before tickets are made publicly available.
        </div>

        <form onSubmit={handleCreate} className="admin-form">
          <div className="form-group">
            <label htmlFor="tt-name">Ticket Type Name *</label>
            <input
              id="tt-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Single, Couple, VIP, or Table"
              className="admin-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tt-desc">Description & Package Details</label>
            <textarea
              id="tt-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Full dinner access, citation ceremony, and gala brochure."
              className="admin-input"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <label htmlFor="tt-price">Price (GH₵) *</label>
              <input
                id="tt-price"
                type="number"
                step="0.50"
                min="0"
                required
                value={priceInGhs}
                onChange={(e) => setPriceInGhs(e.target.value)}
                placeholder="0.00"
                className="admin-input"
              />
              <small style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                Stored in integer pesewas ({ghsToPesewas(priceInGhs)} pesewas)
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="tt-capacity">Total Capacity *</label>
              <input
                id="tt-capacity"
                type="number"
                min="0"
                required
                value={totalCapacity}
                onChange={(e) => setTotalCapacity(Number(e.target.value))}
                placeholder="50"
                className="admin-input"
              />
              <small style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                Hard venue quota limit
              </small>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <label htmlFor="tt-start">Sales Start *</label>
              <input
                id="tt-start"
                type="datetime-local"
                required
                value={salesStart}
                onChange={(e) => setSalesStart(e.target.value)}
                className="admin-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="tt-end">Sales End *</label>
              <input
                id="tt-end"
                type="datetime-local"
                required
                value={salesEnd}
                onChange={(e) => setSalesEnd(e.target.value)}
                className="admin-input"
              />
            </div>
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              id="tt-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
            />
            <label htmlFor="tt-active" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem" }}>
              Active (ready for public display once event is published)
            </label>
          </div>

          <button type="submit" disabled={loading} className="admin-submit-btn">
            {loading ? "Creating..." : "Create Ticket Type"}
          </button>
        </form>
      </div>

      {/* Ticket Types Table Card */}
      <div className="manager-table-card">
        <h2 className="box-title">Configured Ticket Types ({ticketTypes.length})</h2>
        {ticketTypes.length === 0 ? (
          <p className="empty-table-notice">No ticket types configured yet for this event.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tier / Name</th>
                <th>Price (GH₵)</th>
                <th>Capacity & Inventory</th>
                <th>Sales Window</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ticketTypes.map((tt) => {
                const available = Math.max(0, tt.totalCapacity - tt.soldQuantity - tt.reservedQuantity);
                const hasOrders = (tt._count?.orderItems || 0) > 0 || (tt._count?.issuedTickets || 0) > 0;
                return (
                  <tr key={tt.id}>
                    <td>
                      <strong style={{ color: "var(--color-navy-dark)" }}>{tt.name}</strong>
                      {tt.description && (
                        <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                          {tt.description}
                        </p>
                      )}
                    </td>
                    <td>
                      <span style={{ fontWeight: "700", color: "var(--color-navy-dark)" }}>
                        GH₵ {pesewasToGhs(tt.priceInPesewas)}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: "0.8rem", lineHeight: "1.3" }}>
                        <div><strong>Total:</strong> {tt.totalCapacity}</div>
                        <div style={{ color: "var(--color-text-muted)" }}>
                          Sold: {tt.soldQuantity} | Res: {tt.reservedQuantity}
                        </div>
                        <div style={{ color: available > 0 ? "var(--color-success, #059669)" : "var(--color-danger, #dc2626)" }}>
                          Available: {available}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      <div>{new Date(tt.salesStart).toLocaleDateString("en-GB")}</div>
                      <div>to {new Date(tt.salesEnd).toLocaleDateString("en-GB")}</div>
                    </td>
                    <td>
                      <span
                        className="status-pill"
                        style={{
                          backgroundColor: tt.isActive ? "#d1fae5" : "#fee2e2",
                          color: tt.isActive ? "#065f46" : "#991b1b",
                          fontWeight: "600",
                        }}
                      >
                        {tt.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => openEditModal(tt)}
                          className="logout-btn"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          disabled={actionLoadingId === `toggle-${tt.id}`}
                          onClick={() => handleToggleActive(tt.id, tt.isActive)}
                          className="logout-btn"
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.25rem 0.5rem",
                            backgroundColor: tt.isActive ? "#fee2e2" : "#d1fae5",
                            color: tt.isActive ? "#991b1b" : "#065f46",
                          }}
                        >
                          {actionLoadingId === `toggle-${tt.id}`
                            ? "..."
                            : tt.isActive
                            ? "Deactivate"
                            : "Activate"}
                        </button>

                        {!hasOrders && (
                          <button
                            type="button"
                            disabled={actionLoadingId === `del-${tt.id}`}
                            onClick={() => handleDelete(tt.id, tt.name)}
                            className="logout-btn"
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.25rem 0.5rem",
                              color: "#dc2626",
                              borderColor: "#fca5a5",
                            }}
                          >
                            {actionLoadingId === `del-${tt.id}` ? "..." : "Delete"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {editingType && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
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
              maxWidth: "500px",
              width: "100%",
              backgroundColor: "#ffffff",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <h3 className="box-title" style={{ marginTop: 0 }}>
              Edit Ticket Type: {editingType.name}
            </h3>

            {error && <div className="admin-alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}

            <form onSubmit={handleSaveEdit} className="admin-form">
              <div className="form-group">
                <label>Ticket Type Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="form-group">
                  <label>Price (GH₵) *</label>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    required
                    value={editPriceInGhs}
                    onChange={(e) => setEditPriceInGhs(e.target.value)}
                    className="admin-input"
                  />
                </div>

                <div className="form-group">
                  <label>Total Capacity *</label>
                  <input
                    type="number"
                    min={editingType.soldQuantity + editingType.reservedQuantity}
                    required
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(Number(e.target.value))}
                    className="admin-input"
                  />
                  <small style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                    Min: {editingType.soldQuantity + editingType.reservedQuantity} (committed)
                  </small>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="form-group">
                  <label>Sales Start</label>
                  <input
                    type="datetime-local"
                    required
                    value={editSalesStart}
                    onChange={(e) => setEditSalesStart(e.target.value)}
                    className="admin-input"
                  />
                </div>

                <div className="form-group">
                  <label>Sales End</label>
                  <input
                    type="datetime-local"
                    required
                    value={editSalesEnd}
                    onChange={(e) => setEditSalesEnd(e.target.value)}
                    className="admin-input"
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  id="modal-active"
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
                />
                <label htmlFor="modal-active" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem" }}>
                  Active for purchases
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                <button
                  type="button"
                  onClick={() => setEditingType(null)}
                  className="logout-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoadingId === `edit-${editingType.id}`}
                  className="admin-submit-btn"
                  style={{ width: "auto", padding: "0.5rem 1.25rem" }}
                >
                  {actionLoadingId === `edit-${editingType.id}` ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

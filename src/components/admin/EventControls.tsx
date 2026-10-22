"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Event, EventStatus } from "@prisma/client";

interface EventControlsProps {
  event: Event;
}

export default function EventControls({ event }: EventControlsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleStatusChange(newStatus: EventStatus) {
    if (newStatus === EventStatus.PUBLISHED) {
      const confirmPublish = window.confirm(
        "Are you sure you want to PUBLISH this event to the public website? " +
          "All active categories and nominees will become visible to anyone browsing the site."
      );
      if (!confirmPublish) return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/event/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: event.id, status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status.");

      setStatus(newStatus);
      setMessage(`Event status successfully updated to ${newStatus}.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        alert(err.message);
      } else {
        alert("Failed to update status");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="admin-controls-card">
      <div className="controls-header">
        <div>
          <span className="controls-label">CURRENT PUBLISHING STATUS</span>
          <div className="controls-status-row">
            <span
              className={`status-pill ${
                status === EventStatus.PUBLISHED ? "status-published" : "status-draft"
              }`}
            >
              {status}
            </span>
            <span className="status-hint">
              {status === EventStatus.PUBLISHED
                ? "Visible on public website."
                : "Hidden from public website (Draft mode)."}
            </span>
          </div>
        </div>

        <button onClick={handleLogout} className="logout-btn" type="button">
          Sign Out
        </button>
      </div>

      {message && <div className="admin-alert-success">{message}</div>}

      <div className="controls-actions">
        {status === EventStatus.DRAFT ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => handleStatusChange(EventStatus.PUBLISHED)}
            className="btn-publish"
          >
            {loading ? "Updating..." : "Publish Event to Public Portal"}
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => handleStatusChange(EventStatus.DRAFT)}
            className="btn-unpublish"
          >
            {loading ? "Updating..." : "Unpublish (Revert to Draft)"}
          </button>
        )}
      </div>
    </div>
  );
}

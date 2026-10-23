"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Event, EventStatus, Role } from "@prisma/client";

interface EventControlsProps {
  event: Event;
  adminRole?: Role;
}

function toDatetimeLocal(d: Date | string): string {
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  } catch {
    return "";
  }
}

export default function EventControls({ event, adminRole }: EventControlsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [loadingPublish, setLoadingPublish] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  // Form State for Event Editing
  const isSuperAdmin = adminRole === Role.SUPER_ADMIN;
  const [title, setTitle] = useState(event.title);
  const [theme, setTheme] = useState(event.theme || "");
  const [venue, setVenue] = useState(event.venue);
  const [eventDate, setEventDate] = useState(toDatetimeLocal(event.eventDate));
  const [votingStartDate, setVotingStartDate] = useState(toDatetimeLocal(event.votingStartDate));
  const [votingEndDate, setVotingEndDate] = useState(toDatetimeLocal(event.votingEndDate));

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleStatusChange(newStatus: EventStatus) {
    if (newStatus === EventStatus.PUBLISHED) {
      const confirmPublish = window.confirm(
        "Are you sure you want to PUBLISH this event to the public website? " +
          "All active, approved categories and nominees will become visible to anyone browsing the site."
      );
      if (!confirmPublish) return;
    }

    setLoadingPublish(true);
    setPublishMessage(null);

    try {
      const res = await fetch("/api/admin/event/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: event.id, status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status.");

      setStatus(newStatus);
      setPublishMessage(`Event status successfully updated to ${newStatus}.`);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        alert(err.message);
      } else {
        alert("Failed to update status");
      }
    } finally {
      setLoadingPublish(false);
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoadingEdit(true);
    setEditError(null);
    setEditSuccess(null);

    // Client-side validations
    if (new Date(votingStartDate) > new Date(votingEndDate)) {
      setEditError("Voting start date must be on or before voting end date.");
      setLoadingEdit(false);
      return;
    }

    if (new Date(votingEndDate) > new Date(eventDate)) {
      setEditError("Voting must end on or before the event date.");
      setLoadingEdit(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/event", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: event.id,
          title: title.trim(),
          theme: theme.trim() || null,
          venue: venue.trim(),
          eventDate: new Date(eventDate).toISOString(),
          votingStartDate: new Date(votingStartDate).toISOString(),
          votingEndDate: new Date(votingEndDate).toISOString(),
          latePaymentGraceMinutes: 0, // Zero grace period strictly enforced
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update event configuration.");
      }

      setEditSuccess("Event details updated successfully.");
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setEditError(err.message);
      } else {
        setEditError("An unexpected error occurred while saving event details.");
      }
    } finally {
      setLoadingEdit(false);
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

      {publishMessage && <div className="admin-alert-success">{publishMessage}</div>}

      <div className="controls-actions" style={{ marginBottom: "1.5rem" }}>
        {status === EventStatus.DRAFT ? (
          <button
            type="button"
            disabled={loadingPublish}
            onClick={() => handleStatusChange(EventStatus.PUBLISHED)}
            className="btn-publish"
          >
            {loadingPublish ? "Updating..." : "Publish Event to Public Portal"}
          </button>
        ) : (
          <button
            type="button"
            disabled={loadingPublish}
            onClick={() => handleStatusChange(EventStatus.DRAFT)}
            className="btn-unpublish"
          >
            {loadingPublish ? "Updating..." : "Unpublish (Revert to Draft)"}
          </button>
        )}
      </div>

      {/* Super Administrator Event Configuration Editing Form */}
      {isSuperAdmin && (
        <div style={{ borderTop: "1px solid var(--color-border-card)", paddingTop: "1.25rem" }}>
          <h3 className="box-title" style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
            Edit Event Configuration
          </h3>

          {editError && <div className="admin-alert-error" style={{ marginBottom: "1rem" }}>{editError}</div>}
          {editSuccess && <div className="admin-alert-success" style={{ marginBottom: "1rem" }}>{editSuccess}</div>}

          <form onSubmit={handleEditSubmit} className="admin-form">
            <div className="form-group">
              <label htmlFor="evt-title">Event Title *</label>
              <input
                id="evt-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. NUAS KNUST Dinner & Awards Night 2026"
                className="admin-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="evt-theme">Theme (Optional)</label>
              <input
                id="evt-theme"
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g. Celebrating Faith, Leadership and Service"
                className="admin-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="evt-venue">Venue *</label>
              <input
                id="evt-venue"
                type="text"
                required
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Great Hall, KNUST"
                className="admin-input"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div className="form-group">
                <label htmlFor="evt-date">Event Date & Time *</label>
                <input
                  id="evt-date"
                  type="datetime-local"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="evt-vstart">Voting Opens *</label>
                <input
                  id="evt-vstart"
                  type="datetime-local"
                  required
                  value={votingStartDate}
                  onChange={(e) => setVotingStartDate(e.target.value)}
                  className="admin-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="evt-vend">Voting Closes *</label>
                <input
                  id="evt-vend"
                  type="datetime-local"
                  required
                  value={votingEndDate}
                  onChange={(e) => setVotingEndDate(e.target.value)}
                  className="admin-input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loadingEdit}
              className="admin-submit-btn"
              style={{ marginTop: "0.5rem" }}
            >
              {loadingEdit ? "Saving Changes..." : "Save Event Details"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

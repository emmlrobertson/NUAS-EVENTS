import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import EventControls from "@/components/admin/EventControls";
import NuasLogo from "@/components/NuasLogo";
import { resolveAdminAuthoritativeEvent } from "@/lib/event-resolution";

export const dynamic = "force-dynamic";

interface AdminDashboardPageProps {
  searchParams?: {
    eventId?: string;
  };
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    redirect("/admin/login");
  }

  const resolution = await resolveAdminAuthoritativeEvent(searchParams?.eventId);
  const event = resolution.event
    ? await prisma.event.findUnique({
        where: { id: resolution.event.id },
        include: {
          categories: {
            include: {
              nominees: true,
            },
          },
          _count: {
            select: {
              categories: true,
              votingOrders: true,
              ticketOrders: true,
              ticketTypes: true,
            },
          },
        },
      })
    : null;

  const totalCategories = event ? event.categories.length : 0;
  const totalNominees = event
    ? event.categories.reduce((acc, cat) => acc + cat.nominees.length, 0)
    : 0;
  const totalTicketTypes = event ? event._count.ticketTypes : 0;

  return (
    <div className="admin-page-wrapper">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-brand" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <NuasLogo size="sm" variant="admin" href="/admin" showText={false} />
            <span className="brand-badge">NUAS</span>
            <span className="admin-title">Back-Office Dashboard</span>
          </div>
          <div className="admin-user-info">
            <span className="admin-name">{admin.name}</span>
            <span className="admin-role-badge">{admin.role}</span>
          </div>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          <nav className="admin-nav-tabs">
            <Link href={event ? `/admin?eventId=${event.id}` : "/admin"} className="tab-link tab-active">
              Overview
            </Link>
            <Link href={event ? `/admin/categories?eventId=${event.id}` : "/admin/categories"} className="tab-link">
              Categories ({totalCategories})
            </Link>
            <Link href={event ? `/admin/nominees?eventId=${event.id}` : "/admin/nominees"} className="tab-link">
              Nominees ({totalNominees})
            </Link>
            <Link href={event ? `/admin/tickets?eventId=${event.id}` : "/admin/tickets"} className="tab-link">
              Ticket Types ({totalTicketTypes})
            </Link>
            <Link href="/" target="_blank" className="tab-link tab-external">
              View Public Site &rarr;
            </Link>
          </nav>

          {/* Event Selector / Switcher if multiple events exist */}
          {resolution.allEvents.length > 1 && (
            <div
              className="admin-info-box"
              style={{
                marginBottom: "1.5rem",
                padding: "0.75rem 1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong style={{ fontSize: "0.875rem", color: "var(--color-navy-dark)" }}>Active Admin Event:</strong>{" "}
                <span style={{ fontSize: "0.875rem" }}>{event ? event.title : "None selected"}</span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Switch Event:</span>
                {resolution.allEvents.map((e) => (
                  <Link
                    key={e.id}
                    href={`/admin?eventId=${e.id}`}
                    className="logout-btn"
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.25rem 0.5rem",
                      fontWeight: e.id === event?.id ? "700" : "500",
                      borderColor: e.id === event?.id ? "var(--color-gold)" : "var(--color-border-card)",
                      backgroundColor: e.id === event?.id ? "#fef3c7" : "transparent",
                    }}
                  >
                    {e.title} ({e.status})
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Ambiguity Warning Banner */}
          {resolution.isAmbiguous && (
            <div className="admin-alert-error" style={{ marginBottom: "1.5rem" }}>
              <strong>Authoritative Event Ambiguity:</strong> Multiple events are currently marked as PUBLISHED.
              The public portal refuses to arbitrarily choose one. Please unpublish non-authoritative events or specify{" "}
              <code>AUTHORITATIVE_EVENT_SLUG</code> in the server configuration.
            </div>
          )}

          {!event ? (
            <div className="admin-alert-error">
              No active event found. Please select an event above or seed an event.
            </div>
          ) : (
            <div className="admin-grid">
              {/* Publishing & Editing Controls Card */}
              <EventControls event={event} adminRole={admin.role} />

              {/* Event Metadata Card */}
              <div className="admin-info-box">
                <h2 className="box-title">Event Configuration</h2>
                <div className="info-meta-list">
                  <div className="meta-item">
                    <span className="meta-label">Event Title:</span>
                    <span className="meta-val">{event.title}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Theme:</span>
                    <span className="meta-val">{event.theme || "None set"}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Venue:</span>
                    <span className="meta-val">{event.venue}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Event Date:</span>
                    <span className="meta-val">
                      {event.eventDate.toLocaleDateString("en-GB", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Voting Schedule:</span>
                    <span className="meta-val">
                      {event.votingStartDate.toLocaleDateString("en-GB")} to{" "}
                      {event.votingEndDate.toLocaleDateString("en-GB")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Navigation Cards */}
              <div className="admin-cards-row">
                <div className="stats-card">
                  <h3 className="stats-title">Award Categories</h3>
                  <p className="stats-number">{totalCategories}</p>
                  <Link href={`/admin/categories?eventId=${event.id}`} className="stats-link">
                    Manage Categories &rarr;
                  </Link>
                </div>

                <div className="stats-card">
                  <h3 className="stats-title">Nominees Total</h3>
                  <p className="stats-number">{totalNominees}</p>
                  <Link href={`/admin/nominees?eventId=${event.id}`} className="stats-link">
                    Manage Nominees &rarr;
                  </Link>
                </div>

                <div className="stats-card">
                  <h3 className="stats-title">Ticket Tiers</h3>
                  <p className="stats-number">{totalTicketTypes}</p>
                  <Link href={`/admin/tickets?eventId=${event.id}`} className="stats-link">
                    Manage Tickets &rarr;
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

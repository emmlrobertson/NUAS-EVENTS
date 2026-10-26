import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import TicketTypeManager from "@/components/admin/TicketTypeManager";
import NuasLogo from "@/components/NuasLogo";
import { resolveAdminAuthoritativeEvent } from "@/lib/event-resolution";

export const dynamic = "force-dynamic";

interface AdminTicketsPageProps {
  searchParams?: {
    eventId?: string;
  };
}

export default async function AdminTicketsPage({ searchParams }: AdminTicketsPageProps) {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    redirect("/admin/login");
  }

  const resolution = await resolveAdminAuthoritativeEvent(searchParams?.eventId);
  const event = resolution.event
    ? await prisma.event.findUnique({
        where: { id: resolution.event.id },
        include: {
          ticketTypes: {
            orderBy: { createdAt: "asc" },
            include: {
              _count: {
                select: {
                  orderItems: true,
                  issuedTickets: true,
                },
              },
            },
          },
        },
      })
    : null;

  return (
    <div className="admin-page-wrapper">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-brand" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <NuasLogo size="sm" variant="admin" href="/admin" showText={false} />
            <span className="admin-title">NUAS Back-Office: Ticket Types</span>
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
            <Link href={event ? `/admin?eventId=${event.id}` : "/admin"} className="tab-link">
              Overview
            </Link>
            <Link href={event ? `/admin/categories?eventId=${event.id}` : "/admin/categories"} className="tab-link">
              Categories
            </Link>
            <Link href={event ? `/admin/nominees?eventId=${event.id}` : "/admin/nominees"} className="tab-link">
              Nominees
            </Link>
            <Link
              href={event ? `/admin/tickets?eventId=${event.id}` : "/admin/tickets"}
              className="tab-link tab-active"
            >
              Ticket Types ({event?.ticketTypes.length || 0})
            </Link>
            <Link href="/" target="_blank" className="tab-link tab-external">
              View Public Site &rarr;
            </Link>
          </nav>

          {/* Event Switcher */}
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
                <strong style={{ fontSize: "0.875rem", color: "var(--color-navy-dark)" }}>Active Event:</strong>{" "}
                <span style={{ fontSize: "0.875rem" }}>{event ? event.title : "None selected"}</span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Switch Event:</span>
                {resolution.allEvents.map((e) => (
                  <Link
                    key={e.id}
                    href={`/admin/tickets?eventId=${e.id}`}
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

          {resolution.isAmbiguous && (
            <div className="admin-alert-error" style={{ marginBottom: "1.5rem" }}>
              <strong>Authoritative Event Ambiguity:</strong> Multiple published events exist. Please select an event above.
            </div>
          )}

          {!event ? (
            <div className="admin-alert-error">
              No active event found. Please select an event above to manage ticket types.
            </div>
          ) : (
            <TicketTypeManager
              eventId={event.id}
              initialTicketTypes={event.ticketTypes.map((tt) => ({
                id: tt.id,
                eventId: tt.eventId,
                name: tt.name,
                description: tt.description,
                priceInPesewas: tt.priceInPesewas,
                totalCapacity: tt.totalCapacity,
                soldQuantity: tt.soldQuantity,
                reservedQuantity: tt.reservedQuantity,
                salesStart: tt.salesStart.toISOString(),
                salesEnd: tt.salesEnd.toISOString(),
                isActive: tt.isActive,
                createdAt: tt.createdAt.toISOString(),
                _count: {
                  orderItems: tt._count.orderItems,
                  issuedTickets: tt._count.issuedTickets,
                },
              }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}

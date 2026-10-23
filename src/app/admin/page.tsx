import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import EventControls from "@/components/admin/EventControls";
import NuasLogo from "@/components/NuasLogo";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    redirect("/admin/login");
  }

  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
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
        },
      },
    },
  });

  const totalCategories = event ? event.categories.length : 0;
  const totalNominees = event
    ? event.categories.reduce((acc, cat) => acc + cat.nominees.length, 0)
    : 0;

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
            <Link href="/admin" className="tab-link tab-active">
              Overview
            </Link>
            <Link href="/admin/categories" className="tab-link">
              Categories ({totalCategories})
            </Link>
            <Link href="/admin/nominees" className="tab-link">
              Nominees ({totalNominees})
            </Link>
            <Link href="/" target="_blank" className="tab-link tab-external">
              View Public Site &rarr;
            </Link>
          </nav>

          {!event ? (
            <div className="admin-alert-error">
              No event found in the database. Please run migrations or seed scripts.
            </div>
          ) : (
            <div className="admin-grid">
              {/* Publishing Control Card */}
              <EventControls event={event} />

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
                  <Link href="/admin/categories" className="stats-link">
                    Manage Categories &rarr;
                  </Link>
                </div>

                <div className="stats-card">
                  <h3 className="stats-title">Nominees Total</h3>
                  <p className="stats-number">{totalNominees}</p>
                  <Link href="/admin/nominees" className="stats-link">
                    Manage Nominees &rarr;
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

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import NomineeManager from "@/components/admin/NomineeManager";
import NuasLogo from "@/components/NuasLogo";

export const dynamic = "force-dynamic";

export default async function AdminNomineesPage() {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    redirect("/admin/login");
  }

  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      categories: {
        orderBy: { displayOrder: "asc" },
      },
    },
  });

  const nominees = await prisma.nominee.findMany({
    orderBy: { displayOrder: "asc" },
    include: {
      category: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  return (
    <div className="admin-page-wrapper">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-brand" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <NuasLogo size="sm" variant="admin" href="/admin" showText={false} />
            <span className="brand-badge">NUAS</span>
            <span className="admin-title">Back-Office: Nominees</span>
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
            <Link href="/admin" className="tab-link">
              Overview
            </Link>
            <Link href="/admin/categories" className="tab-link">
              Categories
            </Link>
            <Link href="/admin/nominees" className="tab-link tab-active">
              Nominees ({nominees.length})
            </Link>
            <Link href="/" target="_blank" className="tab-link tab-external">
              View Public Site &rarr;
            </Link>
          </nav>

          {!event ? (
            <div className="admin-alert-error">No event found.</div>
          ) : (
            <NomineeManager categories={event.categories} initialNominees={nominees} />
          )}
        </div>
      </main>
    </div>
  );
}

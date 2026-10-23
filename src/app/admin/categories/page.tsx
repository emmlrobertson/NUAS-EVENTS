import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import CategoryManager from "@/components/admin/CategoryManager";
import NuasLogo from "@/components/NuasLogo";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    redirect("/admin/login");
  }

  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      categories: {
        orderBy: { displayOrder: "asc" },
        include: {
          _count: {
            select: { nominees: true },
          },
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
            <span className="admin-title">Back-Office: Categories</span>
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
            <Link href="/admin/categories" className="tab-link tab-active">
              Categories ({event?.categories.length || 0})
            </Link>
            <Link href="/admin/nominees" className="tab-link">
              Nominees
            </Link>
            <Link href="/" target="_blank" className="tab-link tab-external">
              View Public Site &rarr;
            </Link>
          </nav>

          {!event ? (
            <div className="admin-alert-error">No event found.</div>
          ) : (
            <CategoryManager eventId={event.id} initialCategories={event.categories} />
          )}
        </div>
      </main>
    </div>
  );
}

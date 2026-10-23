import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicCategoryById } from "@/lib/public-data";
import NuasLogo from "@/components/NuasLogo";

export const revalidate = 30;

interface CategoryPageProps {
  params: {
    id: string;
  };
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const category = await getPublicCategoryById(params.id);

  if (!category) {
    return {
      title: "Award Category Not Found — NUAS KNUST Awards 2026",
    };
  }

  return {
    title: `${category.title} Nominees — NUAS KNUST Awards 2026`,
    description:
      category.description ||
      `Official award category and vetted nominees for ${category.title} at the NUAS KNUST Dinner and Awards Night.`,
  };
}

export default async function CategoryDetailPage({ params }: CategoryPageProps) {
  const category = await getPublicCategoryById(params.id);

  if (!category) {
    notFound();
  }

  const nomineeCount = category.nominees.length;

  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <NuasLogo size="sm" variant="header" href="/" />
          <nav className="header-nav" aria-label="Main Navigation">
            <Link href="/" className="nav-link">
              Home
            </Link>
            <Link href="/categories" className="nav-link">
              Categories
            </Link>
            <Link href="/vote" className="nav-vote-cta">
              Vote Now &rarr;
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <div className="categories-container">
          {/* Breadcrumb Navigation */}
          <nav className="breadcrumb-nav" aria-label="Breadcrumb" style={{ marginBottom: "1.5rem" }}>
            <Link href="/">Home</Link>
            <span className="breadcrumb-separator">/</span>
            <Link href="/categories">Categories</Link>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{category.title}</span>
          </nav>

          {/* Category Banner Card */}
          <div className="category-hero-banner">
            <span className="category-hero-badge">OFFICIAL AWARD CATEGORY</span>
            <h1 className="category-hero-title">{category.title}</h1>
            {category.description ? (
              <p className="category-hero-desc">{category.description}</p>
            ) : (
              <p className="category-hero-desc" style={{ fontStyle: "italic", opacity: 0.85 }}>
                Official criteria and citation guidelines confirmed by the NUAS KNUST Awards Committee.
              </p>
            )}

            <div className="category-hero-meta">
              <span className="category-hero-count">
                {nomineeCount} {nomineeCount === 1 ? "Recognized Nominee" : "Recognized Nominees"}
              </span>
              <Link href="/vote" className="btn-primary-inline" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }}>
                Cast Votes (GH₵1.50 each) &rarr;
              </Link>
            </div>
          </div>

          {/* Nominees Grid / Empty State */}
          <section aria-labelledby="category-nominees-heading">
            <div className="section-header" style={{ marginBottom: "1.75rem", textAlign: "left" }}>
              <span className="section-badge">OFFICIAL NOMINEES</span>
              <h2 id="category-nominees-heading" className="section-title" style={{ fontSize: "1.75rem" }}>
                Nominees in this Category
              </h2>
            </div>

            {nomineeCount === 0 ? (
              <div className="announcement-card" style={{ maxWidth: "600px", margin: "0 auto" }}>
                <div className="announcement-icon" aria-hidden="true">&#9733;</div>
                <h3 className="announcement-title">No Published Nominees Yet</h3>
                <p className="announcement-text">
                  Approved nominations for <strong>&ldquo;{category.title}&rdquo;</strong> are currently under review by the awards vetting committee and will be announced once finalized.
                </p>
                <div className="announcement-meta">
                  <Link href="/categories" className="btn-secondary-inline">
                    &larr; Browse All Categories
                  </Link>
                </div>
              </div>
            ) : (
              <div className="nominees-grid">
                {category.nominees.map((nominee) => (
                  <article key={nominee.id} className="nominee-card">
                    <div className="nominee-card-top">
                      <div className="nominee-avatar-container">
                        {nominee.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={nominee.avatarUrl}
                            alt={nominee.name}
                            className="nominee-avatar-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="nominee-avatar-placeholder" aria-hidden="true">
                            {nominee.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="nominee-code-badge">{nominee.nomineeCode}</div>
                    </div>

                    <div className="nominee-card-body">
                      <span className="nominee-category-tag">{category.title}</span>
                      <h3 className="nominee-name">{nominee.name}</h3>
                      {nominee.bio && <p className="nominee-bio-preview">{nominee.bio}</p>}
                    </div>

                    <div className="nominee-card-footer">
                      <Link
                        href={`/nominees/${encodeURIComponent(nominee.nomineeCode)}`}
                        className="nominee-profile-btn"
                        aria-label={`View profile of ${nominee.name}`}
                      >
                        Profile
                      </Link>
                      <Link
                        href={`/vote?nominee=${encodeURIComponent(nominee.nomineeCode)}`}
                        className="nominee-vote-cta-btn"
                        aria-label={`Vote for ${nominee.name}`}
                      >
                        Vote &rarr;
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Bottom Navigation */}
          <div style={{ marginTop: "3rem", textAlign: "center" }}>
            <Link href="/categories" className="btn-secondary-inline">
              &larr; View All Award Categories
            </Link>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-brand-wrap">
          <NuasLogo size="md" variant="footer" showText={true} showMotto={true} />
        </div>
        <p>&copy; {new Date().getFullYear()} National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.</p>
      </footer>
    </div>
  );
}

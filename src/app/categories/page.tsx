import Link from "next/link";
import type { Metadata } from "next";
import { getPublicCategories, getPublishedEvent } from "@/lib/public-data";
import NuasLogo from "@/components/NuasLogo";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Official Award Categories — NUAS KNUST Awards 2026",
  description:
    "Explore the official award categories and vetted student nominees for the National Union of Anglican Students (NUAS) KNUST Chapter Annual Gala and Awards Night.",
};

export default async function CategoriesListingPage() {
  const publishedEvent = await getPublishedEvent();
  const categories = await getPublicCategories();

  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <NuasLogo size="sm" variant="header" href="/" />
          <nav className="header-nav" aria-label="Main Navigation">
            <Link href="/" className="nav-link">
              Home
            </Link>
            <Link href="/vote" className="nav-vote-cta">
              Vote Now &rarr;
            </Link>
            <Link href="/admin/login" className="nav-admin-link">
              Admin Login
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <div className="categories-container">
          {/* Header */}
          <div className="section-header" style={{ marginTop: "1rem" }}>
            <span className="section-badge">HONORS & CITATIONS</span>
            <h1 className="section-title">Official Award Categories</h1>
            <p className="section-subtitle">
              {publishedEvent
                ? `Explore the recognized categories for ${publishedEvent.title}. Select any category to view its vetted student nominees and profile citations.`
                : "Explore the recognized categories for the NUAS KNUST Annual Gala & Awards Night."}
            </p>
          </div>

          {!publishedEvent || categories.length === 0 ? (
            <div className="announcement-card" style={{ maxWidth: "680px", margin: "2rem auto" }}>
              <div className="announcement-icon" aria-hidden="true">&#9733;</div>
              <h2 className="announcement-title">Award Categories Under Committee Review</h2>
              <p className="announcement-text">
                The NUAS KNUST awards vetting committee is currently finalizing the official lineup of award categories and vetted nominees. Please check back shortly for the public announcement.
              </p>
              <div className="announcement-meta">
                <Link href="/" className="btn-primary-inline">
                  &larr; Return to Home
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="categories-grid">
                {categories.map((cat) => {
                  const count = cat.nominees.length;
                  return (
                    <Link
                      key={cat.id}
                      href={`/categories/${cat.id}`}
                      className="category-card"
                      aria-label={`View ${cat.title} category nominees`}
                    >
                      <div className="category-card-top">
                        <span className="category-card-badge">AWARD CATEGORY</span>
                        <span className="category-card-count">
                          {count} {count === 1 ? "Nominee" : "Nominees"}
                        </span>
                      </div>

                      <h2 className="category-card-title">{cat.title}</h2>

                      <p className="category-card-desc">
                        {cat.description || "Official nomination criteria and citation guidelines confirmed by the committee."}
                      </p>

                      <div className="category-card-footer">
                        <span>View Nominees</span>
                        <span aria-hidden="true">&rarr;</span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div style={{ marginTop: "3.5rem", textAlign: "center" }}>
                <Link href="/vote" className="btn-primary-inline">
                  Cast Your Votes (GH₵1.50 each) &rarr;
                </Link>
              </div>
            </>
          )}
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

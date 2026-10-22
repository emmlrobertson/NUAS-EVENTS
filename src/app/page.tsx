import Link from "next/link";
import { getPublishedEvent } from "@/lib/public-data";
import Countdown from "@/components/Countdown";
import NomineeShowcase from "@/components/NomineeShowcase";

export const revalidate = 60; // ISR cache revalidation every 60s for high mobile performance

export default async function HomePage() {
  const publishedEvent = await getPublishedEvent();

  // If no published event exists, render a dignified coming-soon state without leaking draft data
  if (!publishedEvent) {
    return (
      <div className="page-wrapper">
        <header className="site-header">
          <div className="header-inner">
            <div className="brand">
              <span className="brand-badge">NUAS</span>
              <span className="brand-text">KNUST AWARDS 2026</span>
            </div>
            <nav className="header-nav" aria-label="Main Navigation">
              <Link href="/admin/login" className="nav-admin-link">
                Executive Portal
              </Link>
            </nav>
          </div>
        </header>

        <main className="main-content">
          <section className="hero-section" aria-labelledby="hero-title">
            <span className="hero-kicker">ANNUAL GALA & CITATION CEREMONY</span>
            <h1 id="hero-title" className="hero-title">
              NUAS KNUST Dinner & Awards Night
            </h1>
            <p className="hero-description">
              Celebrating faith, leadership, and outstanding service within the National Union of Adventist Students, Kwame Nkrumah University of Science and Technology Chapter.
            </p>

            <div className="hero-countdown-wrap">
              <Countdown targetDateIso="2026-11-21T00:00:00Z" label="Countdown to Gala Night" />
            </div>

            <div className="announcement-card" role="region" aria-label="Official Notice">
              <div className="announcement-icon" aria-hidden="true">&#9733;</div>
              <h2 className="announcement-title">Official Lineup Coming Soon</h2>
              <p className="announcement-text">
                The NUAS KNUST planning committee has not yet published the official award categories, nominees, or venue details. Please check back shortly for the official public announcement.
              </p>
              <div className="announcement-meta">
                <span>Date: Saturday, 21 November 2026</span>
                <span>•</span>
                <span>Location: KNUST Campus, Kumasi</span>
              </div>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <p>&copy; 2026 National Union of Adventist Students (NUAS), KNUST Chapter. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  // Published event is available
  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-badge">NUAS</span>
            <span className="brand-text">KNUST AWARDS 2026</span>
          </div>
          <nav className="header-nav" aria-label="Main Navigation">
            <a href="#about" className="nav-link">Event Info</a>
            <a href="#awards" className="nav-link">Nominees</a>
            <Link href="/admin/login" className="nav-admin-link">
              Admin Login
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        {/* Hero Section */}
        <section className="hero-section" aria-labelledby="hero-title">
          <span className="hero-kicker">ANNUAL GALA & AWARDS CEREMONY</span>
          <h1 id="hero-title" className="hero-title">
            {publishedEvent.title}
          </h1>
          {publishedEvent.theme && (
            <div className="theme-banner">
              <span className="theme-label">Official Theme</span>
              <p className="theme-text">&ldquo;{publishedEvent.theme}&rdquo;</p>
            </div>
          )}

          <p className="hero-description">
            Join the fellowship of believers, student leaders, and alumni for an unforgettable evening honoring dedication, ministry excellence, and academic achievement.
          </p>

          <div className="hero-countdown-wrap">
            <Countdown
              targetDateIso={publishedEvent.eventDate.toISOString()}
              label="Countdown to 21 November 2026"
            />
          </div>
        </section>

        {/* Event Details Section */}
        <section className="info-section" id="about" aria-labelledby="info-heading">
          <div className="section-header">
            <span className="section-badge">GALA DETAILS</span>
            <h2 id="info-heading" className="section-title">Event Information</h2>
          </div>

          <div className="info-cards-grid">
            <div className="info-card">
              <div className="info-card-icon" aria-hidden="true">&#128197;</div>
              <h3 className="info-card-title">Date & Schedule</h3>
              <p className="info-card-value">
                {publishedEvent.eventDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p className="info-card-sub">Saturday Evening • KNUST Campus</p>
            </div>

            <div className="info-card">
              <div className="info-card-icon" aria-hidden="true">&#128205;</div>
              <h3 className="info-card-title">Venue</h3>
              <p className="info-card-value">{publishedEvent.venue || "To be officially announced"}</p>
              <p className="info-card-sub">Kwame Nkrumah University of Science and Technology</p>
            </div>

            <div className="info-card">
              <div className="info-card-icon" aria-hidden="true">&#127942;</div>
              <h3 className="info-card-title">Voting & Honors</h3>
              <p className="info-card-value">
                {publishedEvent.categories.length} Award Categories
              </p>
              <p className="info-card-sub">Votes verified authoritatively at GH₵1.50 each</p>
            </div>
          </div>
        </section>

        {/* Categories & Nominees Showcase */}
        <NomineeShowcase categories={publishedEvent.categories} />
      </main>

      <footer className="site-footer">
        <p>&copy; 2026 National Union of Adventist Students (NUAS), KNUST Chapter. All rights reserved.</p>
        <p className="footer-sub">A community dedicated to excellence, spiritual growth, and servant leadership.</p>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { getPublishedEvent } from "@/lib/public-data";
import Countdown from "@/components/Countdown";
import NomineeShowcase from "@/components/NomineeShowcase";
import NuasLogo from "@/components/NuasLogo";

export const revalidate = 60; // ISR cache revalidation every 60s for high mobile performance

export default async function HomePage() {
  const publishedEvent = await getPublishedEvent();

  // If no published event exists, render a dignified coming-soon state without leaking draft data
  if (!publishedEvent) {
    return (
      <div className="page-wrapper">
        <header className="site-header">
          <div className="header-inner">
            <NuasLogo size="sm" variant="header" href="/" />
            <nav className="header-nav" aria-label="Main Navigation">
              <Link href="/admin/login" className="nav-admin-link">
                Executive Portal
              </Link>
            </nav>
          </div>
        </header>

        <main className="main-content">
          <section className="hero-section" aria-labelledby="hero-title">
            <div className="hero-badge-group">
              <div className="hero-crest-badge">
                <NuasLogo size="xl" variant="hero" showText={false} />
              </div>
              <div className="hero-kicker-wrap">
                <span className="hero-kicker">ANNUAL GALA & CITATION CEREMONY</span>
              </div>
            </div>
            <h1 id="hero-title" className="hero-title">
              NUAS KNUST Dinner & Awards Night
            </h1>
            <p className="hero-description">
              Celebrating faith, leadership, and outstanding service within the National Union of Anglican Students, Kwame Nkrumah University of Science and Technology Chapter.
            </p>

            <div className="hero-countdown-wrap">
              <Countdown targetDateIso={null} label="Official Date Coming Soon" />
            </div>

            <div className="announcement-card" role="region" aria-label="Official Notice">
              <div className="announcement-icon" aria-hidden="true">&#9733;</div>
              <h2 className="announcement-title">Official Lineup Coming Soon</h2>
              <p className="announcement-text">
                The NUAS KNUST planning committee has not yet published the official award categories, nominees, or venue details. Please check back shortly for the official public announcement.
              </p>
              <div className="announcement-meta">
                <span>Date: To be announced by the planning committee</span>
                <span>•</span>
                <span>Location: KNUST Campus, Kumasi</span>
              </div>
            </div>
          </section>
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

  // Authoritative published event is available
  const formattedEventDate = publishedEvent.eventDate.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const weekdayName = publishedEvent.eventDate.toLocaleDateString("en-GB", { weekday: "long" });

  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <NuasLogo size="sm" variant="header" href="/" />
          <nav className="header-nav" aria-label="Main Navigation">
            <a href="#about" className="nav-link">Event Info</a>
            <a href="#awards" className="nav-link">Nominees</a>
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
        {/* Hero Section */}
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-badge-group">
            <div className="hero-crest-badge">
              <NuasLogo size="xl" variant="hero" showText={false} />
            </div>
            <div className="hero-kicker-wrap">
              <span className="hero-kicker">ANNUAL GALA & AWARDS CEREMONY</span>
            </div>
          </div>
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

          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", margin: "1.5rem 0", flexWrap: "wrap" }}>
            <Link href="/vote" className="btn-primary-inline">
              Cast Your Votes (GH₵1.50) &rarr;
            </Link>
            <a href="#awards" className="btn-secondary-inline">
              Explore Nominees
            </a>
          </div>

          <div className="hero-countdown-wrap">
            <Countdown
              targetDateIso={publishedEvent.eventDate.toISOString()}
              label={`Countdown to ${formattedEventDate}`}
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
              <p className="info-card-value">{formattedEventDate}</p>
              <p className="info-card-sub">{weekdayName} • {publishedEvent.venue || "KNUST Campus"}</p>
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
        <div className="footer-brand-wrap">
          <NuasLogo size="md" variant="footer" showText={true} showMotto={true} />
        </div>
        <p>&copy; {new Date().getFullYear()} National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.</p>
        <p className="footer-sub">A community dedicated to excellence, spiritual growth, and servant leadership.</p>
      </footer>
    </div>
  );
}

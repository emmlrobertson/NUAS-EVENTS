import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublishedEvent } from "@/lib/public-data";
import VotingClient from "./VotingClient";
import NuasLogo from "@/components/NuasLogo";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Cast Your Votes — NUAS KNUST Awards 2026",
  description:
    "Official multi-category voting portal for the NUAS KNUST Dinner and Awards Night. Votes are verified authoritatively at GH₵1.50 each.",
};

interface VotePageProps {
  searchParams: {
    nominee?: string;
  };
}

export default async function VotePage({ searchParams }: VotePageProps) {
  const publishedEvent = await getPublishedEvent();

  if (!publishedEvent) {
    return (
      <div className="page-wrapper">
        <header className="site-header">
          <div className="header-inner">
            <NuasLogo size="sm" variant="header" href="/" />
            <nav className="header-nav" aria-label="Main Navigation">
              <Link href="/" className="nav-link">
                Home
              </Link>
            </nav>
          </div>
        </header>

        <main className="main-content">
          <div className="announcement-card">
            <div className="announcement-icon" aria-hidden="true">&#9733;</div>
            <h1 className="announcement-title">Voting Portal Not Yet Available</h1>
            <p className="announcement-text">
              The NUAS KNUST Awards Committee has not yet published an official event lineup. Please return once the official categories and nominees are published.
            </p>
            <div className="announcement-meta">
              <Link href="/" className="btn-primary-inline">
                &larr; Return to Home
              </Link>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          <div className="footer-brand-wrap">
            <NuasLogo size="md" variant="footer" showText={true} showMotto={true} />
          </div>
          <p>&copy; 2026 National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  const now = new Date();
  const votingNotStarted = now < publishedEvent.votingStartDate;
  const votingClosed = now > publishedEvent.votingEndDate;

  if (votingNotStarted || votingClosed) {
    return (
      <div className="page-wrapper">
        <header className="site-header">
          <div className="header-inner">
            <NuasLogo size="sm" variant="header" href="/" />
            <nav className="header-nav" aria-label="Main Navigation">
              <Link href="/" className="nav-link">
                Home
              </Link>
            </nav>
          </div>
        </header>

        <main className="main-content">
          <div className="announcement-card">
            <div className="announcement-icon" aria-hidden="true">&#128337;</div>
            <h1 className="announcement-title">
              {votingNotStarted ? "Voting Has Not Opened Yet" : "Voting Has Concluded"}
            </h1>
            <p className="announcement-text">
              {votingNotStarted
                ? `Official voting for the ${publishedEvent.title} will open on ${publishedEvent.votingStartDate.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`
                : `Official voting closed on ${publishedEvent.votingEndDate.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Results are currently being authoritatively reconciled.`}
            </p>
            <div className="announcement-meta">
              <Link href="/" className="btn-primary-inline">
                &larr; Back to Event Showcase
              </Link>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          <div className="footer-brand-wrap">
            <NuasLogo size="md" variant="footer" showText={true} showMotto={true} />
          </div>
          <p>&copy; 2026 National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <NuasLogo size="sm" variant="header" href="/" />
          <nav className="header-nav" aria-label="Main Navigation">
            <Link href="/" className="nav-link">
              Home
            </Link>
            <Link href="/#awards" className="nav-link">
              Nominees
            </Link>
            <Link href="/vote" className="nav-link nav-link-active">
              Voting Portal
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <VotingClient event={publishedEvent} initialNomineeCode={searchParams.nominee} />
      </main>

      <footer className="site-footer">
        <div className="footer-brand-wrap">
          <NuasLogo size="md" variant="footer" showText={true} showMotto={true} />
        </div>
        <p>&copy; 2026 National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.</p>
        <p className="footer-sub">All voting revenue supports official citation awards, event logistics, and fellowship development.</p>
      </footer>
    </div>
  );
}

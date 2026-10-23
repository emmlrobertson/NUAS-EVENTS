import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getApprovedNomineeByCode } from "@/lib/public-data";

interface NomineePageProps {
  params: {
    code: string;
  };
}

export async function generateMetadata({ params }: NomineePageProps): Promise<Metadata> {
  const nominee = await getApprovedNomineeByCode(decodeURIComponent(params.code));

  if (!nominee) {
    return {
      title: "Nominee Not Found — NUAS KNUST Awards 2026",
    };
  }

  return {
    title: `${nominee.name} (${nominee.nomineeCode}) — NUAS KNUST Awards 2026`,
    description: nominee.bio || `Official nominee for ${nominee.category.title} at the NUAS KNUST Dinner and Awards Night.`,
  };
}

export default async function NomineeDetailPage({ params }: NomineePageProps) {
  const code = decodeURIComponent(params.code);
  const nominee = await getApprovedNomineeByCode(code);

  if (!nominee) {
    notFound();
  }

  return (
    <div className="page-wrapper">
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <span className="brand-badge">NUAS</span>
            <span className="brand-text">KNUST AWARDS 2026</span>
          </Link>
          <nav className="header-nav" aria-label="Breadcrumb Navigation">
            <Link href="/#awards" className="nav-link">
              &larr; Back to Nominees
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <div className="nominee-profile-container">
          <nav className="breadcrumb-nav" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="breadcrumb-separator">/</span>
            <Link href="/#awards">Categories</Link>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{nominee.name}</span>
          </nav>

          <article className="nominee-profile-card">
            <div className="profile-header">
              <div className="profile-avatar-wrapper">
                {nominee.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={nominee.avatarUrl}
                    alt={nominee.name}
                    className="profile-avatar-img"
                  />
                ) : (
                  <div className="profile-avatar-fallback">
                    {nominee.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                )}
              </div>
              <div className="profile-header-info">
                <span className="profile-category-badge">{nominee.category.title}</span>
                <h1 className="profile-name">{nominee.name}</h1>
                <div className="profile-code-row">
                  <span className="profile-code-label">Nominee Code:</span>
                  <span className="profile-code-pill">{nominee.nomineeCode}</span>
                </div>
              </div>
            </div>

            <div className="profile-body">
              <h2 className="profile-section-title">Biography & Citation</h2>
              {nominee.bio ? (
                <p className="profile-bio-text">{nominee.bio}</p>
              ) : (
                <p className="profile-bio-empty">
                  Citation details for this nominee will be published following final committee review.
                </p>
              )}
            </div>

            <div className="profile-voting-notice" role="note">
              <div className="notice-icon" aria-hidden="true">&#9432;</div>
              <div className="notice-content">
                <h3 className="notice-title">Voting Information</h3>
                <p className="notice-text">
                  Voting is conducted authoritatively at <strong>GH₵1.50 per vote (150 pesewas)</strong>. You can allocate multiple votes to {nominee.name} and other nominees in a single checkout order.
                </p>
                <div style={{ marginTop: "1.25rem" }}>
                  <Link
                    href={`/vote?nominee=${encodeURIComponent(nominee.nomineeCode)}`}
                    className="btn-primary-inline"
                  >
                    Vote for {nominee.name} &rarr;
                  </Link>
                </div>
              </div>
            </div>

            <div className="profile-footer">
              <Link href="/#awards" className="back-showcase-btn">
                &larr; Return to All Nominees
              </Link>
            </div>
          </article>
        </div>
      </main>

      <footer className="site-footer">
        <p>&copy; 2026 National Union of Adventist Students (NUAS), KNUST Chapter. All rights reserved.</p>
      </footer>
    </div>
  );
}

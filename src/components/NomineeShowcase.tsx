"use client";

import { useState } from "react";
import Link from "next/link";
import { PublicCategory } from "@/lib/public-data";

interface NomineeShowcaseProps {
  categories: PublicCategory[];
}

export default function NomineeShowcase({ categories }: NomineeShowcaseProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");

  const allNominees = categories.flatMap((cat) => cat.nominees);

  const displayedNominees =
    selectedCategoryId === "all"
      ? allNominees
      : categories.find((c) => c.id === selectedCategoryId)?.nominees || [];

  return (
    <section className="showcase-section" id="awards" aria-labelledby="awards-heading">
      <div className="section-header">
        <span className="section-badge">OFFICIAL NOMINEES</span>
        <h2 id="awards-heading" className="section-title">
          Award Categories & Nominees
        </h2>
        <p className="section-subtitle">
          Explore the recognized student leaders, innovators, and dedicated members nominated for the 2026 Dinner and Awards Night.
        </p>
        <div style={{ marginTop: "0.75rem", textAlign: "center" }}>
          <Link
            href="/categories"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.85rem",
              color: "var(--gold)",
              textDecoration: "none",
              fontWeight: 500,
              padding: "0.3rem 0.8rem",
              borderRadius: "9999px",
              background: "rgba(212, 175, 55, 0.08)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
            }}
          >
            <span>Browse Full Award Categories Directory &rarr;</span>
          </Link>
        </div>
      </div>

      {/* Category Filter Navigation */}
      <div className="category-filter-bar" role="tablist" aria-label="Award Categories">
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategoryId === "all"}
          className={`filter-pill ${selectedCategoryId === "all" ? "filter-pill-active" : ""}`}
          onClick={() => setSelectedCategoryId("all")}
        >
          All Categories ({allNominees.length})
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={selectedCategoryId === category.id}
            className={`filter-pill ${selectedCategoryId === category.id ? "filter-pill-active" : ""}`}
            onClick={() => setSelectedCategoryId(category.id)}
          >
            {category.title} ({category.nominees.length})
          </button>
        ))}
      </div>

      {/* Nominee Cards Grid */}
      {displayedNominees.length === 0 ? (
        <div className="empty-state-box">
          <p className="empty-state-title">No nominees in this category</p>
          <p className="empty-state-text">
            Approved nominees for this category will appear once vetted by the awards committee.
          </p>
        </div>
      ) : (
        <div className="nominees-grid">
          {displayedNominees.map((nominee) => (
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
                <span className="nominee-category-tag">{nominee.category.title}</span>
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
  );
}

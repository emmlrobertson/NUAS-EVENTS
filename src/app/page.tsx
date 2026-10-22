export default function HomePage() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: "700px",
          backgroundColor: "var(--color-navy-card)",
          border: "1px solid rgba(212, 175, 55, 0.2)",
          borderRadius: "16px",
          padding: "3rem 2rem",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "0.35rem 1rem",
            backgroundColor: "rgba(212, 175, 55, 0.15)",
            color: "var(--color-gold-base)",
            borderRadius: "999px",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "0.05em",
            marginBottom: "1.5rem",
          }}
        >
          21 NOVEMBER 2026
        </span>
        <h1
          style={{
            fontSize: "2.25rem",
            fontWeight: 700,
            color: "var(--color-text-main)",
            marginBottom: "1rem",
            lineHeight: 1.2,
          }}
        >
          NUAS KNUST Dinner & Awards Night
        </h1>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: "1.1rem",
            marginBottom: "2rem",
          }}
        >
          Platform Foundation Initialized. Official event schedule, award categories, and ticket details will be published once confirmed by the planning committee.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            fontSize: "0.875rem",
            color: "var(--color-gold-light)",
          }}
        >
          <span>Milestone 1 Active</span>
          <span>•</span>
          <a href="/api/health" style={{ textDecoration: "underline" }}>
            API Health Check
          </a>
        </div>
      </div>
    </main>
  );
}

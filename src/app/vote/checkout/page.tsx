import Link from "next/link";
import type { Metadata } from "next";
import CheckoutClient from "./CheckoutClient";
import NuasLogo from "@/components/NuasLogo";

export const metadata: Metadata = {
  title: "Voting Checkout — NUAS KNUST Awards 2026",
  description: "Review and authorize your voting order allocations.",
};

interface CheckoutPageProps {
  searchParams: {
    orderNumber?: string;
  };
}

export default function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const orderNumber = searchParams.orderNumber;

  if (!orderNumber) {
    return (
      <div className="page-wrapper">
        <header className="site-header">
          <div className="header-inner">
            <NuasLogo size="sm" variant="header" href="/" />
          </div>
        </header>

        <main className="main-content">
          <div className="announcement-card">
            <div className="announcement-icon" aria-hidden="true">&#9888;</div>
            <h1 className="announcement-title">Order Number Missing</h1>
            <p className="announcement-text">
              No order number was provided in the checkout request. Please select your nominees and initiate checkout from the voting portal.
            </p>
            <div className="announcement-meta">
              <Link href="/vote" className="btn-primary-inline">
                &larr; Go to Voting Portal
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
            <Link href="/vote" className="nav-link">
              &larr; Back to Cart
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <CheckoutClient orderNumber={orderNumber} />
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

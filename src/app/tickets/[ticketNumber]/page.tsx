import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NuasLogo from "@/components/NuasLogo";
import TicketPassCard from "@/components/tickets/TicketPassCard";
import TicketUnlockModal from "@/components/tickets/TicketUnlockModal";
import { getTicketForAttendeeView } from "@/lib/ticketing/ticket-access";
import { getCurrentAdminUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface TicketPageProps {
  params: {
    ticketNumber: string;
  };
  searchParams?: {
    key?: string;
    orderKey?: string;
  };
}

export async function generateMetadata({ params }: TicketPageProps): Promise<Metadata> {
  const cleanNumber = params.ticketNumber ? decodeURIComponent(params.ticketNumber).toUpperCase() : "";
  return {
    title: `Digital Gala Pass — ${cleanNumber} | NUAS KNUST Awards 2026`,
    description: "Official Admission Pass for the NUAS KNUST Annual Dinner and Awards Night.",
  };
}

export default async function AttendeeTicketPage({
  params,
  searchParams,
}: TicketPageProps) {
  const rawTicketNumber = params.ticketNumber;
  if (!rawTicketNumber) {
    notFound();
  }

  const ticketNumber = decodeURIComponent(rawTicketNumber).trim().toUpperCase();
  const accessKey = searchParams?.key?.trim() || null;
  const orderKey = searchParams?.orderKey?.trim() || null;

  // Check if current user is an authorized admin
  const admin = await getCurrentAdminUser();
  const isAdmin = !!admin;

  const ticketView = await getTicketForAttendeeView({
    ticketNumber,
    accessKey,
    orderKey,
    isAdmin,
  });

  if (!ticketView.ticket) {
    return (
      <div className="ticket-page-shell">
        <header className="ticket-page-nav no-print">
          <div className="ticket-nav-inner">
            <NuasLogo size="sm" variant="header" href="/" />
          </div>
        </header>
        <main className="ticket-page-main">
          <div className="ticket-not-found-card">
            <div className="not-found-icon">&#9888;</div>
            <h1 className="not-found-title">Ticket Pass Not Found</h1>
            <p className="not-found-desc">
              We could not find an admission pass with serial number{" "}
              <strong>&ldquo;{ticketNumber}&rdquo;</strong>. Please ensure the serial number was entered
              correctly or contact the NUAS Dinner Committee.
            </p>
            <Link href="/" className="ticket-btn ticket-btn-primary">
              &larr; Return to Gala Home
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ticket-page-shell">
      {/* Top Navbar (Hidden when printing) */}
      <header className="ticket-page-nav no-print">
        <div className="ticket-nav-inner">
          <NuasLogo size="sm" variant="header" href="/" />
          <div className="ticket-nav-right">
            {isAdmin && (
              <span className="admin-view-badge" title="Viewing in administrator mode">
                ADMIN ACCESS ({admin.role})
              </span>
            )}
            <Link href="/" className="nav-home-link">
              Gala Portal &rarr;
            </Link>
          </div>
        </div>
      </header>

      {/* Main Ticket Interface */}
      <main className="ticket-page-main">
        {ticketView.authorized ? (
          <TicketPassCard ticket={ticketView.ticket} />
        ) : (
          <TicketUnlockModal
            ticketNumber={ticketView.ticket.ticketNumber}
            ticketTypeName={ticketView.ticket.ticketTypeName}
            eventTitle={ticketView.ticket.eventTitle}
            eventVenue={ticketView.ticket.eventVenue}
          />
        )}
      </main>

      {/* Footer (Hidden when printing) */}
      <footer className="ticket-page-footer no-print">
        <div className="ticket-footer-inner">
          <p>
            &copy; 2026 National Union of Anglican Students (NUAS), KNUST Chapter. All rights reserved.
          </p>
          <p className="footer-motto">&ldquo;FOR CHRIST &amp; MANKIND&rdquo;</p>
        </div>
      </footer>
    </div>
  );
}

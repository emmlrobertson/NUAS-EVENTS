"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TicketStatus } from "@prisma/client";

interface SiblingTicket {
  ticketNumber: string;
  attendeeName: string;
  ticketTypeName: string;
  accessKey: string;
  isCurrent: boolean;
}

interface TicketPassCardProps {
  ticket: {
    id: string;
    ticketNumber: string;
    status: TicketStatus;
    attendeeName: string;
    attendeeEmail: string | null;
    ticketTypeName: string;
    ticketTypeDescription: string | null;
    priceInPesewas: number;
    orderNumber: string;
    eventTitle: string;
    eventTheme: string | null;
    eventVenue: string;
    eventDate: Date | string;
    qrCodeDataUrl: string;
    qrCodeSvg: string;
    accessKey: string;
    siblingTickets?: SiblingTicket[];
    checkInDetails?: {
      scannedAt: Date | string;
      gateLocation: string | null;
      scannedByName?: string;
    };
  };
}

export default function TicketPassCard({ ticket }: TicketPassCardProps) {
  const [downloading, setDownloading] = useState(false);

  // Format date and time
  const eventDateObj = new Date(ticket.eventDate);
  const formattedDate = eventDateObj.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedTime = eventDateObj.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadImage = () => {
    setDownloading(true);
    try {
      const link = document.createElement("a");
      link.href = ticket.qrCodeDataUrl;
      link.download = `NUAS-Ticket-${ticket.ticketNumber}-QR.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to download QR code image", err);
    } finally {
      setDownloading(false);
    }
  };

  // Determine status color and text
  const isCheckedIn = ticket.status === TicketStatus.CHECKED_IN;
  const isVoided = ticket.status === TicketStatus.VOIDED;
  const isValid = ticket.status === TicketStatus.ISSUED;

  return (
    <div className="ticket-view-container">
      {/* Sibling Tickets Banner if Multi-Ticket Order */}
      {ticket.siblingTickets && ticket.siblingTickets.length > 1 && (
        <div className="no-print sibling-tickets-bar">
          <span className="sibling-tickets-label">
            Order Passes ({ticket.siblingTickets.length} tickets):
          </span>
          <div className="sibling-tickets-list">
            {ticket.siblingTickets.map((sib, idx) => (
              <Link
                key={sib.ticketNumber}
                href={`/tickets/${sib.ticketNumber}?key=${sib.accessKey}`}
                className={`sibling-ticket-pill ${
                  sib.isCurrent ? "sibling-ticket-active" : ""
                }`}
              >
                Pass #{idx + 1} ({sib.ticketTypeName})
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Main Gala Admission Badge / Pass */}
      <div className="gala-ticket-card" id="printable-ticket">
        {/* Pass Top Border Header */}
        <div className="ticket-header-band">
          <div className="ticket-brand-row">
            <div className="ticket-crest-badge">
              <Image
                src="/images/nuas-logo.png"
                alt="NUAS KNUST Crest"
                width={40}
                height={40}
                className="ticket-crest-img"
              />
            </div>
            <div className="ticket-brand-text">
              <span className="ticket-brand-org">NUAS KNUST CHAPTER</span>
              <span className="ticket-brand-event">ANNUAL DINNER &amp; AWARDS NIGHT</span>
            </div>
          </div>
          <div className="ticket-serial-badge">
            <span className="ticket-serial-label">SERIAL NUMBER</span>
            <span className="ticket-serial-value">{ticket.ticketNumber}</span>
          </div>
        </div>

        {/* Status Notification Banner */}
        <div className={`ticket-status-banner ticket-status-${ticket.status.toLowerCase()}`}>
          {isValid && (
            <>
              <span className="status-indicator-dot dot-valid" />
              <strong>VALID ADMISSION PASS &bull; ADMIT ONE</strong>
            </>
          )}
          {isCheckedIn && (
            <>
              <span className="status-indicator-dot dot-checked-in" />
              <strong>
                ALREADY CHECKED IN &bull;{" "}
                {ticket.checkInDetails?.scannedAt
                  ? `Admitted at ${new Date(ticket.checkInDetails.scannedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                  : "Admitted"}
                {ticket.checkInDetails?.gateLocation ? ` (${ticket.checkInDetails.gateLocation})` : ""}
              </strong>
            </>
          )}
          {isVoided && (
            <>
              <span className="status-indicator-dot dot-voided" />
              <strong>VOIDED &bull; CANCELLED TICKET</strong>
            </>
          )}
        </div>

        {/* Ticket Main Content Grid */}
        <div className="ticket-body-grid">
          {/* Left Column: Attendee & Event Logistics */}
          <div className="ticket-info-col">
            <div className="ticket-section-group">
              <span className="ticket-field-label">HONORED GUEST / ATTENDEE</span>
              <h2 className="ticket-attendee-name">{ticket.attendeeName}</h2>
              {ticket.attendeeEmail && (
                <span className="ticket-attendee-email">{ticket.attendeeEmail}</span>
              )}
            </div>

            <div className="ticket-section-group">
              <span className="ticket-field-label">TIER / CATEGORY</span>
              <div className="ticket-type-tag">{ticket.ticketTypeName}</div>
              {ticket.ticketTypeDescription && (
                <p className="ticket-type-desc">{ticket.ticketTypeDescription}</p>
              )}
            </div>

            <div className="ticket-details-row">
              <div className="ticket-detail-item">
                <span className="ticket-field-label">DATE</span>
                <span className="ticket-detail-value">{formattedDate}</span>
              </div>
              <div className="ticket-detail-item">
                <span className="ticket-field-label">TIME</span>
                <span className="ticket-detail-value">{formattedTime}</span>
              </div>
            </div>

            <div className="ticket-section-group">
              <span className="ticket-field-label">VENUE &amp; LOCATION</span>
              <span className="ticket-detail-value venue-value">{ticket.eventVenue}</span>
            </div>

            {ticket.eventTheme && (
              <div className="ticket-theme-box">
                <span className="theme-label">GALA THEME</span>
                <p className="theme-text">&ldquo;{ticket.eventTheme}&rdquo;</p>
              </div>
            )}
          </div>

          {/* Right Column: Scannable QR Code & Security Seal */}
          <div className="ticket-qr-col">
            <div className="qr-frame-box">
              <div className="qr-code-wrapper">
                <Image
                  src={ticket.qrCodeDataUrl}
                  alt={`QR Verification Pass for Ticket ${ticket.ticketNumber}`}
                  width={220}
                  height={220}
                  priority
                  className="qr-image"
                />
                {isCheckedIn && (
                  <div className="qr-overlay-stamp stamp-admitted">
                    <span>CHECKED IN</span>
                  </div>
                )}
                {isVoided && (
                  <div className="qr-overlay-stamp stamp-voided">
                    <span>VOIDED</span>
                  </div>
                )}
              </div>
              <span className="qr-scan-hint">
                {isValid
                  ? "Present this QR pass to the usher at the entrance gate"
                  : isCheckedIn
                  ? "This pass has already been presented and verified"
                  : "This pass has been cancelled"}
              </span>
            </div>

            <div className="ticket-security-footer">
              <span className="security-tag">AUTHENTIC DIGITAL CREDENTIAL</span>
              <span className="security-sub">HMAC-SHA256 SIGNED &bull; EVENT ID VERIFIED</span>
            </div>
          </div>
        </div>

        {/* Pass Perforated Bottom Bar */}
        <div className="ticket-perforated-edge" />
        <div className="ticket-bottom-bar">
          <div className="ticket-legal-text">
            <span>
              Order #{ticket.orderNumber} &bull; National Union of Anglican Students (NUAS), KNUST
            </span>
            <span className="ticket-disclaimer">
              Non-transferable once checked in. Please arrive 30 minutes prior to call to dinner.
            </span>
          </div>
        </div>
      </div>

      {/* Action Bar (Hidden when Printing) */}
      <div className="no-print ticket-actions-bar">
        <button
          type="button"
          onClick={handlePrint}
          className="ticket-btn ticket-btn-primary"
          title="Print ticket pass or save as PDF"
        >
          <svg
            className="btn-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            width={18}
            height={18}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            />
          </svg>
          Print / Save as PDF
        </button>

        <button
          type="button"
          onClick={handleDownloadImage}
          disabled={downloading}
          className="ticket-btn ticket-btn-secondary"
          title="Download the QR pass image to your device"
        >
          <svg
            className="btn-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            width={18}
            height={18}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          {downloading ? "Saving..." : "Save QR Image"}
        </button>

        <Link href="/" className="ticket-btn ticket-btn-ghost">
          &larr; Back to Gala Home
        </Link>
      </div>
    </div>
  );
}

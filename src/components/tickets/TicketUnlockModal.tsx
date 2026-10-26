"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import NuasLogo from "@/components/NuasLogo";

interface TicketUnlockModalProps {
  ticketNumber: string;
  ticketTypeName: string;
  eventTitle: string;
  eventVenue: string;
}

export default function TicketUnlockModal({
  ticketNumber,
  ticketTypeName,
  eventTitle,
  eventVenue,
}: TicketUnlockModalProps) {
  const router = useRouter();
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) {
      setError("Please enter your buyer email address or order number.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/tickets/verify-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticketNumber,
          verificationInput: inputVal.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(
          data.error ||
            "Verification failed. Please check your email or order number and try again."
        );
        setLoading(false);
        return;
      }

      // Successful verification: redirect with granted capability access key
      router.push(`/tickets/${ticketNumber}?key=${data.accessKey}`);
    } catch (err) {
      console.error("[Ticket Unlock Error]", err);
      setError("An unexpected network error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="ticket-unlock-wrapper">
      <div className="ticket-unlock-card">
        <div className="unlock-header">
          <div className="unlock-crest">
            <NuasLogo size="md" showText={false} variant="header" />
          </div>
          <span className="unlock-badge">PROTECTED GALA PASS</span>
          <h1 className="unlock-title">{eventTitle}</h1>
          <p className="unlock-subtitle">
            Tier: <strong>{ticketTypeName}</strong> &bull; Venue: {eventVenue}
          </p>
          <div className="unlock-serial">
            <span>Ticket Serial: </span>
            <code>{ticketNumber}</code>
          </div>
        </div>

        <div className="unlock-body">
          <div className="unlock-notice">
            <svg
              className="unlock-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              width={24}
              height={24}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <p>
              To protect attendee privacy and prevent unauthorized duplication, please enter the{" "}
              <strong>purchaser email address</strong> or <strong>order number</strong> to unlock
              and view this admission pass.
            </p>
          </div>

          {error && <div className="unlock-error-banner">{error}</div>}

          <form onSubmit={handleUnlock} className="unlock-form">
            <div className="form-group">
              <label htmlFor="unlock-input" className="form-label">
                Purchaser Email or Order Number
              </label>
              <input
                id="unlock-input"
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="e.g. buyer@example.com or TKT-261121-..."
                className="unlock-text-input"
                disabled={loading}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="unlock-submit-btn"
            >
              {loading ? "Verifying Credentials..." : "Unlock Digital Pass &rarr;"}
            </button>
          </form>

          <div className="unlock-footer-hint">
            <span>
              If you purchased this ticket, check your email confirmation for the direct one-click pass link.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

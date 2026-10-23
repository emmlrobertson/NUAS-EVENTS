"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { VotingOrderDto } from "@/lib/voting/types";
import NuasLogo from "@/components/NuasLogo";

interface CheckoutClientProps {
  orderNumber: string;
}

export default function CheckoutClient({ orderNumber }: CheckoutClientProps) {
  const [order, setOrder] = useState<VotingOrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/voting/orders/${encodeURIComponent(orderNumber)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Order not found.");
      } else {
        setOrder(data.order);
      }
    } catch {
      setError("Network error while retrieving order details.");
    } finally {
      setLoading(false);
    }
  }, [orderNumber]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const handleSimulatePayment = async (outcome: "SUCCESS" | "FAILED" | "CANCELLED") => {
    setSimulating(true);
    setSimulationMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/voting/sandbox/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          outcome,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Simulation failed.");
      } else {
        setSimulationMessage(data.message);
        // Refresh order details to reflect authoritative database state
        await fetchOrder();
      }
    } catch {
      setError("Network error during payment simulation.");
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return (
      <div className="checkout-loading-card">
        <div className="loading-spinner" aria-hidden="true" />
        <p className="loading-text">Loading authoritative order details...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="announcement-card">
        <div className="announcement-icon" aria-hidden="true">&#9888;</div>
        <h1 className="announcement-title">Order Retrieval Failed</h1>
        <p className="announcement-text">{error || "The requested voting order could not be located."}</p>
        <div className="announcement-meta">
          <Link href="/vote" className="btn-primary-inline">
            &larr; Return to Voting Portal
          </Link>
        </div>
      </div>
    );
  }

  const isPaid = order.status === "PAID";
  const isPending = order.status === "PENDING";
  const isFailed = order.status === "FAILED" || order.status === "EXPIRED";
  const totalGhs = (order.totalAmountInPesewas / 100).toFixed(2);

  return (
    <div className="checkout-view-wrapper">
      <div className="checkout-card">
        {/* Header & Status */}
        <div className="checkout-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <NuasLogo size="sm" showText={false} variant="header" />
            <div>
              <span className="order-kicker">VOTING ORDER SUMMARY</span>
              <h1 className="order-title">{order.orderNumber}</h1>
            </div>
          </div>
          <div className={`status-pill status-pill-${order.status.toLowerCase()}`}>
            {order.status === "PAID"
              ? "✓ Payment Verified & Credited"
              : order.status === "PENDING"
              ? "⏱ Pending Payment"
              : `✕ ${order.status}`}
          </div>
        </div>

        {/* Order Details Grid */}
        <div className="order-meta-grid">
          <div className="order-meta-item">
            <span className="order-meta-label">Voter Contact (Masked)</span>
            <span className="order-meta-value">{order.maskedPhone}</span>
          </div>
          <div className="order-meta-item">
            <span className="order-meta-label">Total Allocated Votes</span>
            <span className="order-meta-value">{order.totalVotes} vote(s)</span>
          </div>
          <div className="order-meta-item">
            <span className="order-meta-label">Rate per Vote</span>
            <span className="order-meta-value">GH₵1.50 (150 pesewas)</span>
          </div>
          <div className="order-meta-item">
            <span className="order-meta-label">Order Total</span>
            <span className="order-meta-value order-amount-highlight">GH₵{totalGhs}</span>
          </div>
        </div>

        {/* Allocations Table */}
        <div className="order-allocations-table-wrap">
          <h2 className="allocations-table-heading">Allocated Nominees</h2>
          <table className="allocations-table">
            <thead>
              <tr>
                <th scope="col">Award Category</th>
                <th scope="col">Nominee</th>
                <th scope="col">Code</th>
                <th scope="col" className="text-right">Quantity</th>
                <th scope="col" className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.allocations.map((alloc) => (
                <tr key={alloc.id}>
                  <td>
                    <span className="category-cell-pill">{alloc.categoryTitle}</span>
                  </td>
                  <td className="nominee-cell-name">{alloc.nomineeName}</td>
                  <td>
                    <code className="nominee-cell-code">{alloc.nomineeCode}</code>
                  </td>
                  <td className="text-right font-medium">{alloc.numberOfVotes}</td>
                  <td className="text-right font-semibold">
                    GH₵{(alloc.subtotalInPesewas / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Simulation Feedback Alert */}
        {simulationMessage && (
          <div className="simulation-success-alert" role="status">
            <span className="alert-icon" aria-hidden="true">&#10003;</span>
            <div>
              <strong>Authoritative Database Update:</strong> {simulationMessage}
            </div>
          </div>
        )}

        {/* Paid Confirmation Banner */}
        {isPaid && (
          <div className="payment-confirmed-banner">
            <div className="confirmed-icon" aria-hidden="true">&#127881;</div>
            <h3 className="confirmed-title">Thank You For Your Support!</h3>
            <p className="confirmed-text">
              Your payment has been authoritatively verified. <strong>{order.totalVotes} votes</strong> have been credited to the respective nominee tallies.
            </p>
            {order.voterEmail && (
              <p className="confirmed-sub">
                A digital receipt has been queued for delivery to <code>{order.voterEmail}</code>.
              </p>
            )}
            <div className="confirmed-actions">
              <Link href="/vote" className="btn-primary-inline">
                Cast More Votes
              </Link>
              <Link href="/" className="btn-secondary-inline">
                Return to Gala Home
              </Link>
            </div>
          </div>
        )}

        {/* Sandbox Mock Payment Simulator */}
        {isPending && (
          <div className="sandbox-panel" role="region" aria-label="Payment Simulation">
            <div className="sandbox-panel-header">
              <span className="sandbox-badge">MILESTONE 3 SANDBOX GATEWAY</span>
              <h3 className="sandbox-title">Simulate Payment Provider Callback</h3>
              <p className="sandbox-text">
                Live aggregator payment processing (Paystack / Hubtel) is strictly gated pending organizer merchant setup. Use the buttons below to test the atomic order lifecycle and vote-crediting engine.
              </p>
            </div>

            <div className="sandbox-actions-grid">
              <button
                type="button"
                disabled={simulating}
                className="btn-sandbox-success"
                onClick={() => handleSimulatePayment("SUCCESS")}
              >
                {simulating ? "Processing..." : "✓ Simulate Successful Mobile Money Payment"}
              </button>

              <button
                type="button"
                disabled={simulating}
                className="btn-sandbox-failure"
                onClick={() => handleSimulatePayment("FAILED")}
              >
                {simulating ? "Processing..." : "✕ Simulate Insufficient Balance / Gateway Failure"}
              </button>

              <button
                type="button"
                disabled={simulating}
                className="btn-sandbox-cancel"
                onClick={() => handleSimulatePayment("CANCELLED")}
              >
                {simulating ? "Processing..." : "Cancel Checkout Session"}
              </button>
            </div>

            <p className="sandbox-footnote">
              * Note: In production with live payments enabled, sandbox routes are strictly disabled and blocked at the HTTP layer.
            </p>
          </div>
        )}

        {/* Failed State */}
        {isFailed && (
          <div className="payment-failed-banner">
            <div className="failed-icon" aria-hidden="true">&#9888;</div>
            <h3 className="failed-title">Payment Did Not Complete</h3>
            <p className="failed-text">
              This checkout order reached status &ldquo;{order.status}&rdquo; and cannot be credited. Please return to the voting portal to submit a new allocation.
            </p>
            <div className="failed-actions">
              <Link href="/vote" className="btn-primary-inline">
                Return to Voting Portal
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

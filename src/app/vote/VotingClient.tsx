"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicEvent, PublicNominee } from "@/lib/public-data";
import { VOTE_UNIT_PRICE_PESEWAS } from "@/lib/constants";

interface VotingClientProps {
  event: PublicEvent;
  initialNomineeCode?: string;
}

interface CartItem {
  nominee: PublicNominee;
  numberOfVotes: number;
}

export default function VotingClient({ event, initialNomineeCode }: VotingClientProps) {
  const router = useRouter();

  const allNominees = useMemo(() => {
    return event.categories.flatMap((cat) => cat.nominees);
  }, [event]);

  // Initial nominee pre-selection
  const initialCart = useMemo(() => {
    if (!initialNomineeCode) return new Map<string, number>();
    const found = allNominees.find((n) => n.nomineeCode === initialNomineeCode);
    if (found) {
      const map = new Map<string, number>();
      map.set(found.id, 5); // default 5 votes
      return map;
    }
    return new Map<string, number>();
  }, [initialNomineeCode, allNominees]);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [cartMap, setCartMap] = useState<Map<string, number>>(initialCart);
  const [voterPhone, setVoterPhone] = useState("");
  const [voterEmail, setVoterEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const displayedNominees = useMemo(() => {
    if (selectedCategoryId === "all") return allNominees;
    return event.categories.find((c) => c.id === selectedCategoryId)?.nominees || [];
  }, [allNominees, event.categories, selectedCategoryId]);

  // Convert map to list of cart items
  const cartItems: CartItem[] = useMemo(() => {
    const list: CartItem[] = [];
    cartMap.forEach((qty, nomineeId) => {
      const nominee = allNominees.find((n) => n.id === nomineeId);
      if (nominee && qty > 0) {
        list.push({ nominee, numberOfVotes: qty });
      }
    });
    return list;
  }, [cartMap, allNominees]);

  // Totals calculations in integer pesewas
  const totalVotes = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.numberOfVotes, 0);
  }, [cartItems]);

  const totalAmountInPesewas = totalVotes * VOTE_UNIT_PRICE_PESEWAS;
  const totalAmountGhs = (totalAmountInPesewas / 100).toFixed(2);

  // Cart operations
  const setNomineeVotes = (nomineeId: string, votes: number) => {
    setCartMap((prev) => {
      const next = new Map(prev);
      if (votes <= 0) {
        next.delete(nomineeId);
      } else {
        next.set(nomineeId, Math.min(votes, 10000));
      }
      return next;
    });
    setErrorMessage(null);
  };

  const removeNominee = (nomineeId: string) => {
    setCartMap((prev) => {
      const next = new Map(prev);
      next.delete(nomineeId);
      return next;
    });
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (cartItems.length === 0) {
      setErrorMessage("Please select at least one nominee to vote for.");
      return;
    }

    if (!voterPhone.trim()) {
      setErrorMessage("Please enter your mobile phone number for receipt & payment.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        eventId: event.id,
        voterPhone: voterPhone.trim(),
        voterEmail: voterEmail.trim() || undefined,
        allocations: cartItems.map((item) => ({
          nomineeId: item.nominee.id,
          numberOfVotes: item.numberOfVotes,
        })),
        idempotencyKey: `CART-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      };

      const res = await fetch("/api/voting/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Failed to initialize voting checkout.");
        setIsSubmitting(false);
        return;
      }

      // Navigate to checkout view
      router.push(`/vote/checkout?orderNumber=${encodeURIComponent(data.order.orderNumber)}`);
    } catch {
      setErrorMessage("Network error occurred while preparing your checkout. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="voting-layout">
      {/* Catalog Column */}
      <div className="voting-catalog-column">
        <div className="catalog-header">
          <span className="section-badge">MULTI-CATEGORY VOTING</span>
          <h1 className="catalog-title">Allocate Your Votes</h1>
          <p className="catalog-subtitle">
            Support student leaders, gospel ministers, and peer mentors across multiple categories in a single checkout.
          </p>
          <div className="price-callout-pill">
            <span className="price-pill-tag">OFFICIAL RATE</span>
            <span className="price-pill-value">GH₵1.50 per vote (150 pesewas)</span>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="category-filter-bar" role="tablist" aria-label="Filter Categories">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategoryId === "all"}
            className={`filter-pill ${selectedCategoryId === "all" ? "filter-pill-active" : ""}`}
            onClick={() => setSelectedCategoryId("all")}
          >
            All Categories ({allNominees.length})
          </button>
          {event.categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={selectedCategoryId === cat.id}
              className={`filter-pill ${selectedCategoryId === cat.id ? "filter-pill-active" : ""}`}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              {cat.title} ({cat.nominees.length})
            </button>
          ))}
        </div>

        {/* Nominees Grid */}
        <div className="voting-nominees-grid">
          {displayedNominees.map((nominee) => {
            const currentVotes = cartMap.get(nominee.id) || 0;
            const isInCart = currentVotes > 0;

            return (
              <div
                key={nominee.id}
                className={`nominee-select-card ${isInCart ? "nominee-card-selected" : ""}`}
              >
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
                      <div className="nominee-avatar-placeholder">
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

                <div className="nominee-allocation-action">
                  {isInCart ? (
                    <div className="vote-counter-wrap">
                      <button
                        type="button"
                        aria-label="Decrease votes"
                        className="counter-btn"
                        onClick={() => setNomineeVotes(nominee.id, currentVotes - 1)}
                      >
                        &minus;
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={currentVotes}
                        aria-label={`Votes for ${nominee.name}`}
                        className="counter-input"
                        onChange={(e) =>
                          setNomineeVotes(nominee.id, parseInt(e.target.value, 10) || 0)
                        }
                      />
                      <button
                        type="button"
                        aria-label="Increase votes"
                        className="counter-btn"
                        onClick={() => setNomineeVotes(nominee.id, currentVotes + 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title="Remove from cart"
                        className="counter-remove-btn"
                        onClick={() => removeNominee(nominee.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="add-to-cart-btn"
                      onClick={() => setNomineeVotes(nominee.id, 5)}
                    >
                      + Add 5 Votes (GH₵7.50)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart Drawer / Sidebar Column */}
      <aside className="voting-cart-sidebar" aria-label="Voting Cart Summary">
        <div className="cart-card">
          <div className="cart-card-header">
            <h2 className="cart-card-title">Voting Cart</h2>
            <span className="cart-count-badge">{cartItems.length} Nominee(s)</span>
          </div>

          {cartItems.length === 0 ? (
            <div className="empty-cart-state">
              <div className="empty-cart-icon" aria-hidden="true">&#127915;</div>
              <p className="empty-cart-title">Your Voting Cart is Empty</p>
              <p className="empty-cart-text">
                Select nominees from the catalog to build your voting ticket across one or multiple categories.
              </p>
            </div>
          ) : (
            <div className="cart-items-list">
              {cartItems.map((item) => {
                const subtotalPesewas = item.numberOfVotes * VOTE_UNIT_PRICE_PESEWAS;
                const subtotalGhs = (subtotalPesewas / 100).toFixed(2);

                return (
                  <div key={item.nominee.id} className="cart-item-row">
                    <div className="cart-item-info">
                      <span className="cart-item-category">{item.nominee.category.title}</span>
                      <h4 className="cart-item-name">{item.nominee.name}</h4>
                      <span className="cart-item-rate">
                        {item.numberOfVotes} &times; GH₵1.50 = <strong>GH₵{subtotalGhs}</strong>
                      </span>
                    </div>

                    <div className="cart-item-actions">
                      <div className="stepper-mini">
                        <button
                          type="button"
                          className="stepper-mini-btn"
                          onClick={() => setNomineeVotes(item.nominee.id, item.numberOfVotes - 1)}
                          aria-label={`Decrease votes for ${item.nominee.name}`}
                        >
                          &minus;
                        </button>
                        <span className="stepper-mini-qty">{item.numberOfVotes}</span>
                        <button
                          type="button"
                          className="stepper-mini-btn"
                          onClick={() => setNomineeVotes(item.nominee.id, item.numberOfVotes + 1)}
                          aria-label={`Increase votes for ${item.nominee.name}`}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="item-trash-btn"
                        onClick={() => removeNominee(item.nominee.id)}
                        aria-label={`Remove ${item.nominee.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cart Pricing Breakdown */}
          <div className="cart-pricing-summary">
            <div className="pricing-row">
              <span className="pricing-label">Total Allocated Votes</span>
              <span className="pricing-value">{totalVotes} vote(s)</span>
            </div>
            <div className="pricing-row">
              <span className="pricing-label">Unit Price per Vote</span>
              <span className="pricing-value">GH₵1.50</span>
            </div>
            <div className="pricing-row pricing-row-total">
              <span className="pricing-total-label">Payable Total</span>
              <span className="pricing-total-amount">GH₵{totalAmountGhs}</span>
            </div>
          </div>

          {/* Voter Contact Form */}
          <form onSubmit={handleCheckout} className="checkout-form">
            <div className="form-group">
              <label htmlFor="voterPhone" className="form-label">
                Mobile Money Phone Number <span className="field-required">*</span>
              </label>
              <input
                id="voterPhone"
                type="tel"
                required
                placeholder="e.g. 024XXXXXXX or +233..."
                value={voterPhone}
                onChange={(e) => setVoterPhone(e.target.value)}
                className="form-input"
              />
              <span className="field-help">Required for payment authorization & SMS confirmation</span>
            </div>

            <div className="form-group">
              <label htmlFor="voterEmail" className="form-label">
                Email Address <span className="field-optional">(Optional)</span>
              </label>
              <input
                id="voterEmail"
                type="email"
                placeholder="you@example.com"
                value={voterEmail}
                onChange={(e) => setVoterEmail(e.target.value)}
                className="form-input"
              />
              <span className="field-help">Receive official digital voting receipt</span>
            </div>

            {errorMessage && (
              <div className="form-error-alert" role="alert">
                <span className="error-icon" aria-hidden="true">&#9888;</span>
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || cartItems.length === 0}
              className="checkout-submit-btn"
            >
              {isSubmitting
                ? "Preparing Order..."
                : `Proceed to Checkout • GH₵${totalAmountGhs}`}
            </button>

            <p className="checkout-terms-note">
              By proceeding, you confirm that your vote allocation is final upon authoritative payment verification.
            </p>
          </form>
        </div>
      </aside>
    </div>
  );
}

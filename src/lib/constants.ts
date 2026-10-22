/**
 * NUAS KNUST DINNER & AWARDS NIGHT — CORE CONSTANTS
 * All monetary amounts are represented as integer Ghanaian Pesewas (100 pesewas = GH₵1.00)
 */

// Voting configuration
export const VOTE_UNIT_PRICE_PESEWAS = 150; // GH₵1.50 per vote
export const CURRENCY_CODE = "GHS";

// Inventory & Reservation Hold
export const TICKET_RESERVATION_HOLD_MINUTES = 15;
export const DEFAULT_LATE_PAYMENT_GRACE_MINUTES = 15;

// Order number prefixes
export const ORDER_PREFIX = {
  VOTING: "VOTE",
  TICKET: "TKT",
} as const;

// Roles
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  EVENT_ADMIN: "EVENT_ADMIN",
  CHECKIN_AGENT: "CHECKIN_AGENT",
} as const;

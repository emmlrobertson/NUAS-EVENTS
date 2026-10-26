import { TicketStatus, OrderStatus } from "@prisma/client";

export type TicketVerificationStatus =
  | "VALID_UNUSED"
  | "ALREADY_CHECKED_IN"
  | "INVALID_CREDENTIAL"
  | "VOIDED"
  | "WRONG_EVENT"
  | "UNPAID_ORDER";

export interface TicketVerificationResult {
  success: boolean;
  status: TicketVerificationStatus;
  message: string;
  ticket?: {
    id: string;
    ticketNumber: string;
    ticketTypeName: string;
    attendeeName: string;
    status: TicketStatus;
    eventId: string;
    eventTitle: string;
    issuedAt: Date;
  };
  checkIn?: {
    scannedAt: Date;
    scannedById: string;
    gateLocation: string | null;
    deviceInfo: string | null;
  };
}

export interface ClaimTicketCheckInParams {
  qrPayload: string;
  expectedEventId: string;
  scannedById: string;
  gateLocation?: string;
  deviceInfo?: string;
}

export interface ClaimTicketCheckInResult {
  success: boolean;
  status: TicketVerificationStatus;
  message: string;
  ticket?: {
    id: string;
    ticketNumber: string;
    ticketTypeName: string;
    attendeeName: string;
    status: TicketStatus;
  };
  checkIn?: {
    id: string;
    scannedAt: Date;
    gateLocation: string | null;
    deviceInfo: string | null;
  };
}

export interface IssueTicketsOptions {
  attendeeOverrides?: Array<{ attendeeName: string; attendeeEmail?: string }>;
}

export interface IssueTicketsResult {
  orderId: string;
  orderNumber: string;
  tickets: Array<{
    id: string;
    ticketNumber: string;
    ticketTypeId: string;
    ticketTypeName: string;
    attendeeName: string;
    attendeeEmail: string | null;
    qrSecurityHash: string;
    status: TicketStatus;
    issuedAt: Date;
  }>;
  isNewIssuance: boolean;
}

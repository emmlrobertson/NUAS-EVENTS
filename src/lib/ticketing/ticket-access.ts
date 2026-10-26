import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus } from "@prisma/client";
import {
  verifyTicketAccessKey,
  verifyOrderAccessKey,
  generateTicketAccessKey,
  generateOrderAccessKey,
  generateQrCodeDataUrl,
  generateQrCodeSvg,
} from "./ticket-identity";

export interface AttendeeTicketViewData {
  authorized: boolean;
  requiresVerification?: boolean;
  error?: string;
  ticket?: {
    id: string;
    ticketNumber: string;
    status: TicketStatus;
    attendeeName: string;
    attendeeEmail: string | null;
    ticketTypeName: string;
    ticketTypeDescription: string | null;
    priceInPesewas: number;
    orderNumber: string;
    orderStatus: OrderStatus;
    eventTitle: string;
    eventTheme: string | null;
    eventVenue: string;
    eventDate: Date;
    qrCodeDataUrl: string;
    qrCodeSvg: string;
    accessKey: string;
    siblingTickets?: Array<{
      ticketNumber: string;
      attendeeName: string;
      ticketTypeName: string;
      accessKey: string;
      isCurrent: boolean;
    }>;
    checkInDetails?: {
      scannedAt: Date;
      gateLocation: string | null;
      scannedByName?: string;
    };
  };
}

/**
 * Retrieves ticket details for attendee display, strictly enforcing authorization.
 *
 * Authorization rules:
 * 1. Admin sessions (SUPER_ADMIN, EVENT_ADMIN, CHECKIN_AGENT) are authorized.
 * 2. An unguessable ticket-level accessKey matching the HMAC signature is authorized.
 * 3. An unguessable order-level orderKey matching the order's HMAC signature is authorized.
 * 4. Otherwise, access is locked: sensitive fields, PII, and the QR code are withheld.
 */
export async function getTicketForAttendeeView(params: {
  ticketNumber: string;
  accessKey?: string | null;
  orderKey?: string | null;
  isAdmin?: boolean;
}): Promise<AttendeeTicketViewData> {
  const { ticketNumber, accessKey, orderKey, isAdmin } = params;

  if (!ticketNumber || typeof ticketNumber !== "string" || ticketNumber.trim().length === 0) {
    return {
      authorized: false,
      error: "Missing ticket number.",
    };
  }

  const cleanTicketNumber = ticketNumber.trim().toUpperCase();

  const ticket = await prisma.issuedTicket.findUnique({
    where: { ticketNumber: cleanTicketNumber },
    include: {
      ticketType: true,
      ticketOrder: {
        include: {
          event: true,
          issuedTickets: {
            include: {
              ticketType: true,
            },
            orderBy: { ticketNumber: "asc" },
          },
        },
      },
      checkIn: {
        include: {
          scannedBy: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!ticket) {
    return {
      authorized: false,
      error: "Ticket not found. Please verify your ticket serial number.",
    };
  }

  // Check authorization
  let isAuthorized = false;

  if (isAdmin) {
    isAuthorized = true;
  } else if (accessKey && verifyTicketAccessKey(ticket.id, ticket.ticketNumber, accessKey)) {
    isAuthorized = true;
  } else if (
    orderKey &&
    verifyOrderAccessKey(ticket.ticketOrder.id, ticket.ticketOrder.orderNumber, orderKey)
  ) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return {
      authorized: false,
      requiresVerification: true,
      ticket: {
        id: "",
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        attendeeName: "",
        attendeeEmail: null,
        ticketTypeName: ticket.ticketType.name,
        ticketTypeDescription: null,
        priceInPesewas: 0,
        orderNumber: "",
        orderStatus: ticket.ticketOrder.status,
        eventTitle: ticket.ticketOrder.event.title,
        eventTheme: ticket.ticketOrder.event.theme,
        eventVenue: ticket.ticketOrder.event.venue,
        eventDate: ticket.ticketOrder.event.eventDate,
        qrCodeDataUrl: "",
        qrCodeSvg: "",
        accessKey: "",
      },
    };
  }

  // Generate QR code encoding the exact cryptographically signed qrSecurityHash
  const qrCodeDataUrl = await generateQrCodeDataUrl(ticket.qrSecurityHash);
  const qrCodeSvg = await generateQrCodeSvg(ticket.qrSecurityHash);
  const currentAccessKey = generateTicketAccessKey(ticket.id, ticket.ticketNumber);

  // Compute sibling tickets in the same order if multi-ticket order
  const siblingTickets = ticket.ticketOrder.issuedTickets.map((sib) => ({
    ticketNumber: sib.ticketNumber,
    attendeeName: sib.attendeeName || ticket.ticketOrder.buyerName,
    ticketTypeName: sib.ticketType.name,
    accessKey: generateTicketAccessKey(sib.id, sib.ticketNumber),
    isCurrent: sib.id === ticket.id,
  }));

  const attendeeName = ticket.attendeeName || ticket.ticketOrder.buyerName || "Valued Attendee";

  return {
    authorized: true,
    ticket: {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      attendeeName,
      attendeeEmail: ticket.attendeeEmail || ticket.ticketOrder.buyerEmail,
      ticketTypeName: ticket.ticketType.name,
      ticketTypeDescription: ticket.ticketType.description,
      priceInPesewas: ticket.ticketType.priceInPesewas,
      orderNumber: ticket.ticketOrder.orderNumber,
      orderStatus: ticket.ticketOrder.status,
      eventTitle: ticket.ticketOrder.event.title,
      eventTheme: ticket.ticketOrder.event.theme,
      eventVenue: ticket.ticketOrder.event.venue,
      eventDate: ticket.ticketOrder.event.eventDate,
      qrCodeDataUrl,
      qrCodeSvg,
      accessKey: currentAccessKey,
      siblingTickets: siblingTickets.length > 1 ? siblingTickets : undefined,
      checkInDetails: ticket.checkIn
        ? {
            scannedAt: ticket.checkIn.scannedAt,
            gateLocation: ticket.checkIn.gateLocation,
            scannedByName: ticket.checkIn.scannedBy.name,
          }
        : undefined,
    },
  };
}

/**
 * Recovers access to a ticket by verifying purchaser email or order number.
 */
export async function verifyTicketOwnershipAndGrantAccess(params: {
  ticketNumber: string;
  verificationInput: string;
}): Promise<{ success: boolean; accessKey?: string; error?: string }> {
  const { ticketNumber, verificationInput } = params;

  if (!ticketNumber || !verificationInput) {
    return {
      success: false,
      error: "Both ticket number and verification input are required.",
    };
  }

  const cleanTicketNumber = ticketNumber.trim().toUpperCase();
  const cleanInput = verificationInput.trim().toLowerCase();

  const ticket = await prisma.issuedTicket.findUnique({
    where: { ticketNumber: cleanTicketNumber },
    include: {
      ticketOrder: true,
    },
  });

  if (!ticket) {
    return {
      success: false,
      error: "Ticket not found.",
    };
  }

  const buyerEmail = ticket.ticketOrder.buyerEmail.trim().toLowerCase();
  const attendeeEmail = ticket.attendeeEmail?.trim().toLowerCase() || "";
  const orderNumber = ticket.ticketOrder.orderNumber.trim().toLowerCase();
  const buyerPhone = ticket.ticketOrder.buyerPhone.trim().toLowerCase();

  const matches =
    cleanInput === buyerEmail ||
    cleanInput === attendeeEmail ||
    cleanInput === orderNumber ||
    cleanInput === buyerPhone;

  if (!matches) {
    return {
      success: false,
      error: "The provided detail does not match the purchaser or attendee on record.",
    };
  }

  const accessKey = generateTicketAccessKey(ticket.id, ticket.ticketNumber);

  return {
    success: true,
    accessKey,
  };
}

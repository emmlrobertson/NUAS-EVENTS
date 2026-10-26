import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus, Prisma } from "@prisma/client";
import { parseAndVerifyQrCredential } from "./ticket-identity";
import {
  TicketVerificationResult,
  ClaimTicketCheckInParams,
  ClaimTicketCheckInResult,
} from "./types";

/**
 * Server-side verification contract for ticket validation.
 *
 * Checks:
 * 1. Cryptographic HMAC signature validity (prevents fabricated/tampered payloads).
 * 2. Database existence of the issued ticket.
 * 3. Event identity matching (prevents tickets from other events being accepted).
 * 4. Order status verification (must be confirmed PAID).
 * 5. Lifecycle states: VOIDED, ALREADY_CHECKED_IN, VALID_UNUSED.
 *
 * Never returns sensitive buyer PII (phone number, payment secrets) to unauthorized callers.
 */
export async function verifyTicketCredential(
  qrPayload: string,
  expectedEventId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<TicketVerificationResult> {
  // Step 1: Cryptographic signature validation (no DB leak on forged payloads)
  const cryptoCheck = parseAndVerifyQrCredential(qrPayload);
  if (!cryptoCheck.valid || !cryptoCheck.ticketId) {
    return {
      success: false,
      status: "INVALID_CREDENTIAL",
      message: cryptoCheck.error || "Ticket credential is invalid or has been tampered with.",
    };
  }

  // Step 2: Database lookup by the unique qrSecurityHash
  const cleanPayload = qrPayload.trim();
  const ticket = await tx.issuedTicket.findUnique({
    where: { qrSecurityHash: cleanPayload },
    include: {
      ticketOrder: {
        include: {
          event: true,
        },
      },
      ticketType: true,
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

  if (!ticket || ticket.id !== cryptoCheck.ticketId) {
    return {
      success: false,
      status: "INVALID_CREDENTIAL",
      message: "Ticket record not found in event database.",
    };
  }

  const ticketSummary = {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    ticketTypeName: ticket.ticketType.name,
    attendeeName: ticket.attendeeName,
    status: ticket.status,
    eventId: ticket.ticketOrder.eventId,
    eventTitle: ticket.ticketOrder.event.title,
    issuedAt: ticket.issuedAt,
  };

  // Step 3: Event association check
  if (ticket.ticketOrder.eventId !== expectedEventId) {
    return {
      success: false,
      status: "WRONG_EVENT",
      message: `Ticket belongs to "${ticket.ticketOrder.event.title}", which is a different event.`,
      ticket: ticketSummary,
    };
  }

  // Step 4: Parent order status verification
  if (ticket.ticketOrder.status !== OrderStatus.PAID) {
    return {
      success: false,
      status: "UNPAID_ORDER",
      message: `Parent order "${ticket.ticketOrder.orderNumber}" is in ${ticket.ticketOrder.status} status, not confirmed PAID.`,
      ticket: ticketSummary,
    };
  }

  // Step 5: Check if ticket has been VOIDED
  if (ticket.status === TicketStatus.VOIDED) {
    return {
      success: false,
      status: "VOIDED",
      message: "This ticket has been voided by event administrators and cannot be admitted.",
      ticket: ticketSummary,
    };
  }

  // Step 6: Check if ticket has ALREADY BEEN CHECKED IN
  if (ticket.status === TicketStatus.CHECKED_IN || ticket.checkIn) {
    return {
      success: false,
      status: "ALREADY_CHECKED_IN",
      message: "Ticket has already been checked in.",
      ticket: ticketSummary,
      checkIn: ticket.checkIn
        ? {
            scannedAt: ticket.checkIn.scannedAt,
            scannedById: ticket.checkIn.scannedById,
            gateLocation: ticket.checkIn.gateLocation,
            deviceInfo: ticket.checkIn.deviceInfo,
          }
        : undefined,
    };
  }

  // Step 7: Eligible, valid, unused ticket
  return {
    success: true,
    status: "VALID_UNUSED",
    message: "Ticket is authentic, confirmed, and ready for entry.",
    ticket: ticketSummary,
  };
}

/**
 * Atomically checks in an eligible ticket.
 *
 * Concurrency Safety:
 * Protected by PostgreSQL unique constraint on check_ins(issuedTicketId).
 * If two scanner devices attempt to scan the exact same ticket simultaneously,
 * exactly one transaction succeeds, and the other receives a unique constraint
 * collision (code P2002) which is safely handled as ALREADY_CHECKED_IN.
 */
export async function claimTicketCheckIn(
  params: ClaimTicketCheckInParams
): Promise<ClaimTicketCheckInResult> {
  const { qrPayload, expectedEventId, scannedById, gateLocation, deviceInfo } = params;

  try {
    return await prisma.$transaction(async (tx) => {
      // Step 1: Verify credential eligibility inside transaction
      const verification = await verifyTicketCredential(qrPayload, expectedEventId, tx);
      if (!verification.success || verification.status !== "VALID_UNUSED" || !verification.ticket) {
        return {
          success: false,
          status: verification.status,
          message: verification.message,
          ticket: verification.ticket
            ? {
                id: verification.ticket.id,
                ticketNumber: verification.ticket.ticketNumber,
                ticketTypeName: verification.ticket.ticketTypeName,
                attendeeName: verification.ticket.attendeeName,
                status: verification.ticket.status,
              }
            : undefined,
        };
      }

      const ticketId = verification.ticket.id;

      // Step 2: Insert CheckIn record (protected by unique index on issuedTicketId)
      const checkInRecord = await tx.checkIn.create({
        data: {
          issuedTicketId: ticketId,
          scannedById,
          gateLocation: gateLocation || null,
          deviceInfo: deviceInfo || null,
        },
      });

      // Step 3: Transition ticket status to CHECKED_IN
      const updatedTicket = await tx.issuedTicket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.CHECKED_IN },
        include: { ticketType: true },
      });

      // Step 4: Audit log entry
      await tx.auditLog.create({
        data: {
          userId: scannedById,
          action: "TICKET_CHECKED_IN",
          entity: "IssuedTicket",
          entityId: ticketId,
          details: {
            ticketNumber: updatedTicket.ticketNumber,
            gateLocation,
            deviceInfo,
          },
        },
      });

      return {
        success: true,
        status: "VALID_UNUSED",
        message: "Check-in successful. Attendee admitted.",
        ticket: {
          id: updatedTicket.id,
          ticketNumber: updatedTicket.ticketNumber,
          ticketTypeName: updatedTicket.ticketType.name,
          attendeeName: updatedTicket.attendeeName,
          status: updatedTicket.status,
        },
        checkIn: {
          id: checkInRecord.id,
          scannedAt: checkInRecord.scannedAt,
          gateLocation: checkInRecord.gateLocation,
          deviceInfo: checkInRecord.deviceInfo,
        },
      };
    });
  } catch (error) {
    // Detect race condition collision where parallel transaction checked in moments ago
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        status: "ALREADY_CHECKED_IN",
        message: "Duplicate scan detected: ticket was already checked in moments ago.",
      };
    }
    throw error;
  }
}

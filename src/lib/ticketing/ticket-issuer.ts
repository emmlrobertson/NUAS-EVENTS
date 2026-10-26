import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus, Prisma } from "@prisma/client";
import { generateTicketNumber, createQrCredential } from "./ticket-identity";
import { IssueTicketsOptions, IssueTicketsResult } from "./types";
import crypto from "crypto";

/**
 * Idempotently issues individual tickets for a confirmed (PAID) TicketOrder.
 *
 * Guarantees:
 * 1. Exactly one IssuedTicket record is created per ticket count in the order.
 * 2. Each IssuedTicket receives its own persistent unique identifier, human-readable serial, and cryptographically signed QR credential.
 * 3. Processing the same order multiple times returns existing tickets without generating duplicates.
 * 4. Venue quotas and inventory invariants are safely maintained.
 * 5. Structured audit log entry is recorded for administrative tracking.
 */
export async function issueTicketsForOrder(
  ticketOrderId: string,
  options?: IssueTicketsOptions,
  customTx?: Prisma.TransactionClient
): Promise<IssueTicketsResult> {
  if (!ticketOrderId || typeof ticketOrderId !== "string" || ticketOrderId.trim().length === 0) {
    throw new Error("Cannot issue tickets: valid ticketOrderId is required.");
  }

  const runWithTx = async (tx: Prisma.TransactionClient): Promise<IssueTicketsResult> => {
    // 1. Fetch order with items and ticket types
    const order = await tx.ticketOrder.findUnique({
      where: { id: ticketOrderId },
      include: {
        event: true,
        items: {
          include: {
            ticketType: true,
          },
        },
        issuedTickets: {
          include: {
            ticketType: true,
          },
          orderBy: { ticketNumber: "asc" },
        },
      },
    });

    if (!order) {
      throw new Error(`TicketOrder "${ticketOrderId}" not found.`);
    }

    // 2. Strict status gate: Tickets can ONLY be issued for PAID orders
    if (order.status !== OrderStatus.PAID) {
      throw new Error(
        `Cannot issue tickets for order "${order.orderNumber}": status is "${order.status}", expected "${OrderStatus.PAID}".`
      );
    }

    // 3. Idempotency Check: If tickets are already issued, return existing records
    if (order.issuedTickets && order.issuedTickets.length > 0) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tickets: order.issuedTickets.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          ticketTypeId: t.ticketTypeId,
          ticketTypeName: t.ticketType.name,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail,
          qrSecurityHash: t.qrSecurityHash,
          status: t.status,
          issuedAt: t.issuedAt,
        })),
        isNewIssuance: false,
      };
    }

    // Double check if any tickets were created by a parallel call in this transaction window
    const raceCheck = await tx.issuedTicket.findMany({
      where: { ticketOrderId: order.id },
      include: { ticketType: true },
      orderBy: { ticketNumber: "asc" },
    });

    if (raceCheck.length > 0) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tickets: raceCheck.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          ticketTypeId: t.ticketTypeId,
          ticketTypeName: t.ticketType.name,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail,
          qrSecurityHash: t.qrSecurityHash,
          status: t.status,
          issuedAt: t.issuedAt,
        })),
        isNewIssuance: false,
      };
    }

    // 4. Create individual tickets for each order item
    const createdTickets = [];
    let attendeeIndex = 0;

    for (const item of order.items) {
      const quantity = item.quantity;
      if (quantity <= 0) continue;

      for (let i = 0; i < quantity; i++) {
        // Derive attendee details (allowing optional overrides if specified)
        const override = options?.attendeeOverrides?.[attendeeIndex];
        const attendeeName =
          override?.attendeeName?.trim() ||
          (quantity > 1 ? `${order.buyerName} (Guest ${i + 1})` : order.buyerName);
        const attendeeEmail = override?.attendeeEmail?.trim() || order.buyerEmail;

        attendeeIndex++;

        // Pre-generate unique ticket cuid-like ID
        const ticketId = `tkt_${crypto.randomBytes(12).toString("hex")}`;
        const ticketNumber = generateTicketNumber(item.ticketType.name);
        const { qrPayload } = createQrCredential(ticketId);

        const newTicket = await tx.issuedTicket.create({
          data: {
            id: ticketId,
            ticketNumber,
            ticketOrderId: order.id,
            ticketTypeId: item.ticketTypeId,
            attendeeName,
            attendeeEmail,
            qrSecurityHash: qrPayload,
            status: TicketStatus.ISSUED,
          },
          include: {
            ticketType: true,
          },
        });

        createdTickets.push(newTicket);
      }

      // Update TicketType soldQuantity and reservedQuantity safely respecting DB check constraint
      const currentReserved = item.ticketType.reservedQuantity;
      const decrementAmount = Math.min(currentReserved, item.quantity);

      await tx.ticketType.update({
        where: { id: item.ticketTypeId },
        data: {
          soldQuantity: { increment: item.quantity },
          reservedQuantity: { decrement: decrementAmount },
        },
      });
    }

    // 5. Create structured audit log entry
    await tx.auditLog.create({
      data: {
        action: "TICKETS_ISSUED",
        entity: "TicketOrder",
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          ticketCount: createdTickets.length,
          ticketNumbers: createdTickets.map((t) => t.ticketNumber),
        },
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tickets: createdTickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        ticketTypeId: t.ticketTypeId,
        ticketTypeName: t.ticketType.name,
        attendeeName: t.attendeeName,
        attendeeEmail: t.attendeeEmail,
        qrSecurityHash: t.qrSecurityHash,
        status: t.status,
        issuedAt: t.issuedAt,
      })),
      isNewIssuance: true,
    };
  };

  if (customTx) {
    return await runWithTx(customTx);
  }

  return await prisma.$transaction(runWithTx);
}

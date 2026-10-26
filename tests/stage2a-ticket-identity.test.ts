import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { EventStatus, OrderStatus, TicketStatus, Role } from "@prisma/client";
import {
  generateTicketNumber,
  createQrCredential,
  parseAndVerifyQrCredential,
} from "@/lib/ticketing/ticket-identity";
import { issueTicketsForOrder } from "@/lib/ticketing/ticket-issuer";
import {
  verifyTicketCredential,
  claimTicketCheckIn,
} from "@/lib/ticketing/ticket-verifier";

describe("Stage 2A — Secure Unique Ticket Identity and QR Foundation", () => {
  let testEvent: { id: string; slug: string };
  let secondEvent: { id: string; slug: string };
  let vipTicketType: { id: string; name: string };
  let regularTicketType: { id: string; name: string };
  let testStaffUser: { id: string; email: string };

  beforeAll(async () => {
    // 1. Create primary authoritative test event
    testEvent = await prisma.event.upsert({
      where: { slug: "stage2a-gala-2026" },
      update: { status: EventStatus.PUBLISHED },
      create: {
        slug: "stage2a-gala-2026",
        title: "Stage 2A Gala Dinner & Awards",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });

    // 2. Create secondary event for cross-event boundary validation
    secondEvent = await prisma.event.upsert({
      where: { slug: "stage2a-cross-event-2026" },
      update: { status: EventStatus.PUBLISHED },
      create: {
        slug: "stage2a-cross-event-2026",
        title: "Stage 2A Other Event",
        venue: "CCB Auditorium, KNUST",
        eventDate: new Date("2026-12-05T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-12-05T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });

    // 3. Create ticket types for primary event
    vipTicketType = await prisma.ticketType.create({
      data: {
        eventId: testEvent.id,
        name: "VIP Dinner Access",
        priceInPesewas: 15000,
        totalCapacity: 50,
        soldQuantity: 0,
        reservedQuantity: 0,
        salesStart: new Date("2026-10-01T00:00:00Z"),
        salesEnd: new Date("2026-11-21T18:00:00Z"),
        isActive: true,
      },
    });

    regularTicketType = await prisma.ticketType.create({
      data: {
        eventId: testEvent.id,
        name: "Regular Single",
        priceInPesewas: 7500,
        totalCapacity: 200,
        soldQuantity: 0,
        reservedQuantity: 0,
        salesStart: new Date("2026-10-01T00:00:00Z"),
        salesEnd: new Date("2026-11-21T18:00:00Z"),
        isActive: true,
      },
    });

    // 4. Create check-in staff user
    testStaffUser = await prisma.user.upsert({
      where: { email: "stage2a-staff@nuasknust.org" },
      update: { role: Role.CHECKIN_AGENT, isActive: true },
      create: {
        email: "stage2a-staff@nuasknust.org",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890",
        name: "Stage 2A Gate Usher",
        role: Role.CHECKIN_AGENT,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data safely in reverse dependency order
    const eventIds = [testEvent?.id, secondEvent?.id].filter(Boolean);
    if (eventIds.length > 0) {
      await prisma.checkIn.deleteMany({
        where: {
          issuedTicket: {
            ticketOrder: { eventId: { in: eventIds } },
          },
        },
      });
      await prisma.issuedTicket.deleteMany({
        where: {
          ticketOrder: { eventId: { in: eventIds } },
        },
      });
      await prisma.ticketOrderItem.deleteMany({
        where: {
          ticketOrder: { eventId: { in: eventIds } },
        },
      });
      await prisma.ticketOrder.deleteMany({
        where: { eventId: { in: eventIds } },
      });
      await prisma.ticketType.deleteMany({
        where: { eventId: { in: eventIds } },
      });
      await prisma.event.deleteMany({
        where: { id: { in: eventIds } },
      });
    }

    if (testStaffUser?.id) {
      await prisma.user.deleteMany({
        where: { id: testStaffUser.id },
      });
    }
  });

  // =========================================================================
  // SECTION 1: QR Credential Design & Cryptographic Integrity
  // =========================================================================
  describe("Cryptographic QR Credential Security", () => {
    it("generates an unguessable QR credential with 128-bit CSPRNG entropy and HMAC signature", () => {
      const ticketId = "tkt_test_sample_01";
      const cred1 = createQrCredential(ticketId);
      const cred2 = createQrCredential(ticketId);

      // Verify structure: NUAS-TKT-V1.<ticketId>.<nonce>.<signature>
      const parts1 = cred1.qrPayload.split(".");
      expect(parts1).toHaveLength(4);
      expect(parts1[0]).toBe("NUAS-TKT-V1");
      expect(parts1[1]).toBe(ticketId);
      expect(parts1[2]).toHaveLength(32); // 16 bytes hex = 32 chars
      expect(parts1[3].length).toBeGreaterThanOrEqual(40); // Base64url HMAC-SHA256

      // Distinct nonces generate completely different signatures even for the same ticketId
      expect(cred1.qrPayload).not.toBe(cred2.qrPayload);
      expect(cred1.nonce).not.toBe(cred2.nonce);
      expect(cred1.signature).not.toBe(cred2.signature);
    });

    it("never encodes PII (phone number, buyer email, credit info) in the QR credential", () => {
      const ticketId = "tkt_sample_pii_check";
      const { qrPayload } = createQrCredential(ticketId);

      // Verify no PII markers
      expect(qrPayload).not.toContain("@");
      expect(qrPayload).not.toContain("024");
      expect(qrPayload).not.toContain("020");
      expect(qrPayload).not.toContain("055");
      expect(qrPayload).not.toContain("nuasknust");
      expect(qrPayload).not.toContain("buyer");
    });

    it("successfully validates authentic QR credentials", () => {
      const ticketId = "tkt_authentic_123";
      const { qrPayload } = createQrCredential(ticketId);

      const result = parseAndVerifyQrCredential(qrPayload);
      expect(result.valid).toBe(true);
      expect(result.ticketId).toBe(ticketId);
      expect(result.error).toBeUndefined();
    });

    it("rejects tampered or forged QR payloads", () => {
      const ticketId = "tkt_real_ticket";
      const { qrPayload } = createQrCredential(ticketId);
      const parts = qrPayload.split(".");

      // 1. Altered ticket ID
      const forgedTicketId = `${parts[0]}.tkt_hacked_id.${parts[2]}.${parts[3]}`;
      expect(parseAndVerifyQrCredential(forgedTicketId).valid).toBe(false);

      // 2. Altered nonce
      const forgedNonce = `${parts[0]}.${parts[1]}.00000000000000000000000000000000.${parts[3]}`;
      expect(parseAndVerifyQrCredential(forgedNonce).valid).toBe(false);

      // 3. Altered signature
      const forgedSignature = `${parts[0]}.${parts[1]}.${parts[2]}.invalidSignature123456789`;
      expect(parseAndVerifyQrCredential(forgedSignature).valid).toBe(false);

      // 4. Random guess / malformed payload
      expect(parseAndVerifyQrCredential("random-guess-credential").valid).toBe(false);
      expect(parseAndVerifyQrCredential("").valid).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: Multi-Ticket Order Issuance & Unique Identity
  // =========================================================================
  describe("Multi-Ticket Identity & Idempotent Issuance", () => {
    let multiTicketOrder: { id: string; orderNumber: string };

    beforeAll(async () => {
      // Create confirmed PAID order with 2 VIP tickets and 1 Regular ticket
      const order = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-MULTI-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "Hon. Sarah Mensah",
          buyerEmail: "sarah.mensah@nuasknust.org",
          buyerPhone: "0241234567",
          totalAmountInPesewas: 15000 * 2 + 7500 * 1,
          status: OrderStatus.PAID,
          paidAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: [
              {
                ticketTypeId: vipTicketType.id,
                quantity: 2,
                unitPriceInPesewas: 15000,
                subtotalInPesewas: 30000,
              },
              {
                ticketTypeId: regularTicketType.id,
                quantity: 1,
                unitPriceInPesewas: 7500,
                subtotalInPesewas: 7500,
              },
            ],
          },
        },
      });
      multiTicketOrder = { id: order.id, orderNumber: order.orderNumber };
    });

    it("issues distinct, unique tickets for every count in a multi-ticket order", async () => {
      const issuance = await issueTicketsForOrder(multiTicketOrder.id);

      expect(issuance.isNewIssuance).toBe(true);
      expect(issuance.tickets).toHaveLength(3);

      const [t1, t2, t3] = issuance.tickets;

      // 1. Each ticket has its own distinct persistent identifier
      expect(t1.id).not.toBe(t2.id);
      expect(t2.id).not.toBe(t3.id);
      expect(t1.id).not.toBe(t3.id);

      // 2. Each ticket has a distinct human-readable serial
      expect(t1.ticketNumber).not.toBe(t2.ticketNumber);
      expect(t2.ticketNumber).not.toBe(t3.ticketNumber);

      // 3. Each ticket has a distinct cryptographically signed QR credential
      expect(t1.qrSecurityHash).not.toBe(t2.qrSecurityHash);
      expect(t2.qrSecurityHash).not.toBe(t3.qrSecurityHash);

      // 4. All QR credentials are valid and unguessable
      expect(parseAndVerifyQrCredential(t1.qrSecurityHash).valid).toBe(true);
      expect(parseAndVerifyQrCredential(t2.qrSecurityHash).valid).toBe(true);
      expect(parseAndVerifyQrCredential(t3.qrSecurityHash).valid).toBe(true);

      // 5. Each ticket correctly maps to its respective ticket type
      const vipTickets = issuance.tickets.filter((t) => t.ticketTypeId === vipTicketType.id);
      const regTickets = issuance.tickets.filter((t) => t.ticketTypeId === regularTicketType.id);
      expect(vipTickets).toHaveLength(2);
      expect(regTickets).toHaveLength(1);

      // 6. Attendee naming supports primary buyer and distinct guests
      expect(vipTickets[0].attendeeName).toBe("Hon. Sarah Mensah (Guest 1)");
      expect(vipTickets[1].attendeeName).toBe("Hon. Sarah Mensah (Guest 2)");
      expect(regTickets[0].attendeeName).toBe("Hon. Sarah Mensah");
    });

    it("enforces idempotency: repeated processing of confirmed order does NOT create duplicate tickets", async () => {
      // 1. Query ticket count in DB before second issuance attempt
      const countBefore = await prisma.issuedTicket.count({
        where: { ticketOrderId: multiTicketOrder.id },
      });
      expect(countBefore).toBe(3);

      // 2. Process order second time
      const secondRun = await issueTicketsForOrder(multiTicketOrder.id);
      expect(secondRun.isNewIssuance).toBe(false);
      expect(secondRun.tickets).toHaveLength(3);

      // 3. Count in DB remains strictly 3 (no duplication)
      const countAfter = await prisma.issuedTicket.count({
        where: { ticketOrderId: multiTicketOrder.id },
      });
      expect(countAfter).toBe(3);

      // 4. Stable ticket numbers and QR credentials across retries
      const firstTickets = await prisma.issuedTicket.findMany({
        where: { ticketOrderId: multiTicketOrder.id },
        orderBy: { ticketNumber: "asc" },
      });
      const returnedTickets = [...secondRun.tickets].sort((a, b) =>
        a.ticketNumber.localeCompare(b.ticketNumber)
      );

      for (let i = 0; i < firstTickets.length; i++) {
        expect(returnedTickets[i].id).toBe(firstTickets[i].id);
        expect(returnedTickets[i].ticketNumber).toBe(firstTickets[i].ticketNumber);
        expect(returnedTickets[i].qrSecurityHash).toBe(firstTickets[i].qrSecurityHash);
      }
    });

    it("refuses ticket issuance for unpaid or non-confirmed orders", async () => {
      const pendingOrder = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-PENDING-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "Pending Buyer",
          buyerEmail: "pending@nuasknust.org",
          buyerPhone: "0240000000",
          totalAmountInPesewas: 7500,
          status: OrderStatus.PENDING,
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: regularTicketType.id,
              quantity: 1,
              unitPriceInPesewas: 7500,
              subtotalInPesewas: 7500,
            },
          },
        },
      });

      await expect(issueTicketsForOrder(pendingOrder.id)).rejects.toThrowError(
        /expected "PAID"/
      );

      // Clean up pending order
      await prisma.ticketOrderItem.deleteMany({ where: { ticketOrderId: pendingOrder.id } });
      await prisma.ticketOrder.delete({ where: { id: pendingOrder.id } });
    });
  });

  // =========================================================================
  // SECTION 3: Server-Side Verification Contract & Lifecycle States
  // =========================================================================
  describe("Server-Side Verification Contract & State Distinctions", () => {
    let testOrder: { id: string };
    let validTicket: { id: string; qrSecurityHash: string };

    beforeAll(async () => {
      const order = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-VERIFY-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "Verification Tester",
          buyerEmail: "verify@nuasknust.org",
          buyerPhone: "0245556677",
          totalAmountInPesewas: 7500,
          status: OrderStatus.PAID,
          paidAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: regularTicketType.id,
              quantity: 1,
              unitPriceInPesewas: 7500,
              subtotalInPesewas: 7500,
            },
          },
        },
      });
      testOrder = { id: order.id };

      const issuance = await issueTicketsForOrder(order.id);
      validTicket = issuance.tickets[0];
    });

    it("verifies a valid, unused ticket as VALID_UNUSED with sanitized metadata", async () => {
      const result = await verifyTicketCredential(validTicket.qrSecurityHash, testEvent.id);

      expect(result.success).toBe(true);
      expect(result.status).toBe("VALID_UNUSED");
      expect(result.ticket).toBeDefined();
      expect(result.ticket?.id).toBe(validTicket.id);
      expect(result.ticket?.eventId).toBe(testEvent.id);
      expect(result.ticket?.ticketTypeName).toBe(regularTicketType.name);
      expect(result.ticket?.attendeeName).toBe("Verification Tester");
      expect(result.checkIn).toBeUndefined();
    });

    it("detects cross-event ticket presentation and rejects with WRONG_EVENT", async () => {
      // Verifying ticket against secondEvent instead of testEvent
      const result = await verifyTicketCredential(validTicket.qrSecurityHash, secondEvent.id);

      expect(result.success).toBe(false);
      expect(result.status).toBe("WRONG_EVENT");
      expect(result.message).toMatch(/different event/i);
    });

    it("rejects invalid, unknown, or tampered credentials with INVALID_CREDENTIAL", async () => {
      const forged = createQrCredential("tkt_nonexistent_id").qrPayload;
      const result = await verifyTicketCredential(forged, testEvent.id);

      expect(result.success).toBe(false);
      expect(result.status).toBe("INVALID_CREDENTIAL");
      expect(result.message).toMatch(/not found/i);
    });

    it("identifies voided tickets and rejects entry with VOIDED state", async () => {
      // Create a ticket and void it
      const voidOrder = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-VOID-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "Void Tester",
          buyerEmail: "void@nuasknust.org",
          buyerPhone: "0241112222",
          totalAmountInPesewas: 7500,
          status: OrderStatus.PAID,
          paidAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: regularTicketType.id,
              quantity: 1,
              unitPriceInPesewas: 7500,
              subtotalInPesewas: 7500,
            },
          },
        },
      });

      const issuance = await issueTicketsForOrder(voidOrder.id);
      const ticketToVoid = issuance.tickets[0];

      // Void ticket administratively
      await prisma.issuedTicket.update({
        where: { id: ticketToVoid.id },
        data: { status: TicketStatus.VOIDED },
      });

      const result = await verifyTicketCredential(ticketToVoid.qrSecurityHash, testEvent.id);
      expect(result.success).toBe(false);
      expect(result.status).toBe("VOIDED");
      expect(result.message).toMatch(/voided/i);
    });
  });

  // =========================================================================
  // SECTION 4: Atomic Check-In & Race Condition Safeguard
  // =========================================================================
  describe("Atomic Event-Day Check-In & Concurrency Safety", () => {
    let checkInTicket: { id: string; qrSecurityHash: string };

    beforeAll(async () => {
      const order = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-CHECKIN-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "Check-in Attendee",
          buyerEmail: "attendee@nuasknust.org",
          buyerPhone: "0243334444",
          totalAmountInPesewas: 15000,
          status: OrderStatus.PAID,
          paidAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: vipTicketType.id,
              quantity: 1,
              unitPriceInPesewas: 15000,
              subtotalInPesewas: 15000,
            },
          },
        },
      });

      const issuance = await issueTicketsForOrder(order.id);
      checkInTicket = issuance.tickets[0];
    });

    it("atomically checks in an eligible ticket on the first scan", async () => {
      const checkInResult = await claimTicketCheckIn({
        qrPayload: checkInTicket.qrSecurityHash,
        expectedEventId: testEvent.id,
        scannedById: testStaffUser.id,
        gateLocation: "Main VIP Hall Gate",
        deviceInfo: "Scanner Tablet Alpha (iPad Air)",
      });

      expect(checkInResult.success).toBe(true);
      expect(checkInResult.status).toBe("VALID_UNUSED");
      expect(checkInResult.ticket?.status).toBe(TicketStatus.CHECKED_IN);
      expect(checkInResult.checkIn?.gateLocation).toBe("Main VIP Hall Gate");

      // Verify DB record
      const dbTicket = await prisma.issuedTicket.findUnique({
        where: { id: checkInTicket.id },
        include: { checkIn: true },
      });
      expect(dbTicket?.status).toBe(TicketStatus.CHECKED_IN);
      expect(dbTicket?.checkIn).toBeDefined();
      expect(dbTicket?.checkIn?.scannedById).toBe(testStaffUser.id);
    });

    it("rejects duplicate scan attempts for an already checked-in ticket with ALREADY_CHECKED_IN", async () => {
      const duplicateResult = await claimTicketCheckIn({
        qrPayload: checkInTicket.qrSecurityHash,
        expectedEventId: testEvent.id,
        scannedById: testStaffUser.id,
        gateLocation: "East Gate",
        deviceInfo: "Scanner Mobile Beta",
      });

      expect(duplicateResult.success).toBe(false);
      expect(duplicateResult.status).toBe("ALREADY_CHECKED_IN");
      expect(duplicateResult.message).toMatch(/already.*checked in/i);
    });

    it("enforces database-level uniqueness constraint preventing parallel check-in race conditions", async () => {
      // Direct insertion of a duplicate CheckIn record must fail PostgreSQL unique constraint
      await expect(
        prisma.checkIn.create({
          data: {
            issuedTicketId: checkInTicket.id,
            scannedById: testStaffUser.id,
            gateLocation: "Side Door",
          },
        })
      ).rejects.toThrowError(/Unique constraint failed on the fields: \(`issuedTicketId`\)/);
    });
  });

  // =========================================================================
  // SECTION 5: Historical Record Preservation
  // =========================================================================
  describe("Historical Data Preservation", () => {
    it("preserves historical records and relations across all ticket states", async () => {
      const order = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-2A-HISTORY-${Date.now()}`,
          eventId: testEvent.id,
          buyerName: "History Preservation Tester",
          buyerEmail: "history@nuasknust.org",
          buyerPhone: "0249998877",
          totalAmountInPesewas: 7500,
          status: OrderStatus.PAID,
          paidAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: regularTicketType.id,
              quantity: 1,
              unitPriceInPesewas: 7500,
              subtotalInPesewas: 7500,
            },
          },
        },
      });

      const issuance = await issueTicketsForOrder(order.id);
      const ticket = issuance.tickets[0];

      // Check-in the ticket
      await claimTicketCheckIn({
        qrPayload: ticket.qrSecurityHash,
        expectedEventId: testEvent.id,
        scannedById: testStaffUser.id,
      });

      // Verify relations are intact
      const preserved = await prisma.issuedTicket.findUnique({
        where: { id: ticket.id },
        include: {
          ticketOrder: {
            include: {
              event: true,
              items: true,
            },
          },
          ticketType: true,
          checkIn: {
            include: {
              scannedBy: true,
            },
          },
        },
      });

      expect(preserved).not.toBeNull();
      expect(preserved?.ticketOrder.id).toBe(order.id);
      expect(preserved?.ticketOrder.event.id).toBe(testEvent.id);
      expect(preserved?.ticketType.id).toBe(regularTicketType.id);
      expect(preserved?.checkIn?.scannedBy.id).toBe(testStaffUser.id);
      expect(preserved?.status).toBe(TicketStatus.CHECKED_IN);
    });
  });
});

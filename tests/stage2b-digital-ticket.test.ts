import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { EventStatus, OrderStatus, TicketStatus, Role } from "@prisma/client";
import {
  getTicketSigningSecret,
  generateTicketAccessKey,
  verifyTicketAccessKey,
  generateOrderAccessKey,
  verifyOrderAccessKey,
  generateQrCodeDataUrl,
} from "@/lib/ticketing/ticket-identity";
import { issueTicketsForOrder } from "@/lib/ticketing/ticket-issuer";
import {
  getTicketForAttendeeView,
  verifyTicketOwnershipAndGrantAccess,
} from "@/lib/ticketing/ticket-access";
import { claimTicketCheckIn, verifyTicketCredential } from "@/lib/ticketing/ticket-verifier";
import { POST as verifyAccessPost } from "@/app/api/tickets/verify-access/route";
import { NextRequest } from "next/server";

describe("Stage 2B — NUAS KNUST Digital Ticket Interface & Security", () => {
  let testEvent: { id: string };
  let vipTicketType: { id: string; name: string };
  let testStaffUser: { id: string };
  let paidOrder: { id: string; orderNumber: string; buyerEmail: string; buyerPhone: string };
  let issuedTicket1: { id: string; ticketNumber: string; qrSecurityHash: string };
  let issuedTicket2: { id: string; ticketNumber: string; qrSecurityHash: string };

  beforeAll(async () => {
    // 1. Create test event
    testEvent = await prisma.event.upsert({
      where: { slug: "stage2b-gala-2026" },
      update: { status: EventStatus.PUBLISHED },
      create: {
        slug: "stage2b-gala-2026",
        title: "Stage 2B Gala Dinner & Awards",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });

    // 2. Create ticket type
    vipTicketType = await prisma.ticketType.create({
      data: {
        eventId: testEvent.id,
        name: "VIP Executive Pass",
        priceInPesewas: 25000,
        totalCapacity: 50,
        salesStart: new Date("2026-10-01T00:00:00Z"),
        salesEnd: new Date("2026-11-21T18:00:00Z"),
        isActive: true,
      },
    });

    // 3. Create check-in agent
    testStaffUser = await prisma.user.upsert({
      where: { email: "stage2b-usher@nuasknust.org" },
      update: { role: Role.CHECKIN_AGENT, isActive: true },
      create: {
        email: "stage2b-usher@nuasknust.org",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890",
        name: "Stage 2B Usher",
        role: Role.CHECKIN_AGENT,
        isActive: true,
      },
    });

    // 4. Create confirmed paid order with 2 tickets
    const order = await prisma.ticketOrder.create({
      data: {
        orderNumber: `TKT-2B-ORD-${Date.now()}`,
        eventId: testEvent.id,
        buyerName: "Justice Kwame Asante",
        buyerEmail: "kwame.asante@nuasknust.org",
        buyerPhone: "0249876543",
        totalAmountInPesewas: 50000,
        status: OrderStatus.PAID,
        paidAt: new Date(),
        reservationExpiresAt: new Date(Date.now() + 900000),
        items: {
          create: {
            ticketTypeId: vipTicketType.id,
            quantity: 2,
            unitPriceInPesewas: 25000,
            subtotalInPesewas: 50000,
          },
        },
      },
    });
    paidOrder = {
      id: order.id,
      orderNumber: order.orderNumber,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
    };

    // 5. Issue tickets
    const issuance = await issueTicketsForOrder(order.id);
    issuedTicket1 = issuance.tickets[0];
    issuedTicket2 = issuance.tickets[1];
  });

  afterAll(async () => {
    if (testEvent?.id) {
      await prisma.checkIn.deleteMany({
        where: { issuedTicket: { ticketOrder: { eventId: testEvent.id } } },
      });
      await prisma.issuedTicket.deleteMany({
        where: { ticketOrder: { eventId: testEvent.id } },
      });
      await prisma.ticketOrderItem.deleteMany({
        where: { ticketOrder: { eventId: testEvent.id } },
      });
      await prisma.ticketOrder.deleteMany({
        where: { eventId: testEvent.id },
      });
      await prisma.ticketType.deleteMany({
        where: { eventId: testEvent.id },
      });
      await prisma.event.delete({
        where: { id: testEvent.id },
      });
    }

    if (testStaffUser?.id) {
      await prisma.user.delete({
        where: { id: testStaffUser.id },
      });
    }
  });

  // =========================================================================
  // SECTION 1: Production Secret Configuration & No Silent Fallback
  // =========================================================================
  describe("Production Secret Security Gate", () => {
    it("prohibits silent fallback to SESSION_SECRET in production", () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.TICKET_SIGNING_SECRET;

      try {
        (process.env as any).NODE_ENV = "production";
        delete process.env.TICKET_SIGNING_SECRET;

        expect(() => getTicketSigningSecret()).toThrowError(
          /Dedicated TICKET_SIGNING_SECRET must be explicitly configured.*Silent fallback to SESSION_SECRET is strictly forbidden/
        );
      } finally {
        (process.env as any).NODE_ENV = originalEnv;
        if (originalSecret) {
          process.env.TICKET_SIGNING_SECRET = originalSecret;
        }
      }
    });

    it("accepts valid TICKET_SIGNING_SECRET in production", () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.TICKET_SIGNING_SECRET;

      try {
        (process.env as any).NODE_ENV = "production";
        process.env.TICKET_SIGNING_SECRET = "production-ticket-signing-secret-minimum-32-chars-long";

        const secret = getTicketSigningSecret();
        expect(secret).toBe("production-ticket-signing-secret-minimum-32-chars-long");
      } finally {
        (process.env as any).NODE_ENV = originalEnv;
        if (originalSecret) {
          process.env.TICKET_SIGNING_SECRET = originalSecret;
        }
      }
    });
  });

  // =========================================================================
  // SECTION 2: Ticket Access Authorization & Protection
  // =========================================================================
  describe("Secure Attendee Access Control", () => {
    it("denies access and withholds QR code and PII when no access key is provided", async () => {
      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
      });

      expect(result.authorized).toBe(false);
      expect(result.requiresVerification).toBe(true);
      // Sensitive fields must be withheld
      expect(result.ticket?.id).toBe("");
      expect(result.ticket?.attendeeName).toBe("");
      expect(result.ticket?.qrCodeDataUrl).toBe("");
      expect(result.ticket?.orderNumber).toBe("");
    });

    it("denies access when an invalid or forged access key is provided", async () => {
      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        accessKey: "forged-invalid-access-key-123456",
      });

      expect(result.authorized).toBe(false);
      expect(result.requiresVerification).toBe(true);
      expect(result.ticket?.qrCodeDataUrl).toBe("");
    });

    it("prevents changing URL parameter to view another ticket without its specific key", async () => {
      // Key generated for ticket 1
      const keyForTicket1 = generateTicketAccessKey(issuedTicket1.id, issuedTicket1.ticketNumber);

      // Attempting to use ticket 1's key to access ticket 2 must fail
      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket2.ticketNumber,
        accessKey: keyForTicket1,
      });

      expect(result.authorized).toBe(false);
      expect(result.requiresVerification).toBe(true);
    });

    it("grants full access when a valid ticket capability key is provided", async () => {
      const validKey = generateTicketAccessKey(issuedTicket1.id, issuedTicket1.ticketNumber);

      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        accessKey: validKey,
      });

      expect(result.authorized).toBe(true);
      expect(result.ticket).toBeDefined();
      expect(result.ticket?.ticketNumber).toBe(issuedTicket1.ticketNumber);
      expect(result.ticket?.attendeeName).toBe("Justice Kwame Asante (Guest 1)");
      expect(result.ticket?.ticketTypeName).toBe("VIP Executive Pass");
      expect(result.ticket?.eventVenue).toBe("Great Hall, KNUST");
      expect(result.ticket?.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.ticket?.qrCodeSvg).toContain("<svg");
      expect(result.ticket?.siblingTickets).toHaveLength(2);
    });

    it("grants full access when a valid order capability key is provided", async () => {
      const validOrderKey = generateOrderAccessKey(paidOrder.id, paidOrder.orderNumber);

      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        orderKey: validOrderKey,
      });

      expect(result.authorized).toBe(true);
      expect(result.ticket?.ticketNumber).toBe(issuedTicket1.ticketNumber);
      expect(result.ticket?.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("grants immediate access to administrators with active sessions without requiring keys", async () => {
      const result = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        isAdmin: true,
      });

      expect(result.authorized).toBe(true);
      expect(result.ticket?.ticketNumber).toBe(issuedTicket1.ticketNumber);
    });

    it("gracefully handles requests for non-existent ticket numbers", async () => {
      const result = await getTicketForAttendeeView({
        ticketNumber: "NUAS26-NON-EXISTENT",
        accessKey: "some-key",
      });

      expect(result.authorized).toBe(false);
      expect(result.ticket).toBeUndefined();
      expect(result.error).toMatch(/not found/i);
    });
  });

  // =========================================================================
  // SECTION 3: QR Credential Rendering & Verification Consistency
  // =========================================================================
  describe("QR Credential Rendering & Server Contract Consistency", () => {
    it("renders QR code that encodes the exact persistent qrSecurityHash token", async () => {
      const validKey = generateTicketAccessKey(issuedTicket1.id, issuedTicket1.ticketNumber);
      const view = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        accessKey: validKey,
      });

      expect(view.authorized).toBe(true);
      // The QR code data URL is generated from issuedTicket1.qrSecurityHash
      const generatedDataUrl = await generateQrCodeDataUrl(issuedTicket1.qrSecurityHash);
      expect(view.ticket?.qrCodeDataUrl).toBe(generatedDataUrl);

      // Verify that the payload stored in the database is verified by server verifier
      const verification = await verifyTicketCredential(
        issuedTicket1.qrSecurityHash,
        testEvent.id
      );
      expect(verification.success).toBe(true);
      expect(verification.status).toBe("VALID_UNUSED");
      expect(verification.ticket?.ticketNumber).toBe(issuedTicket1.ticketNumber);
    });

    it("retains consistent QR credentials across repeated renders and refreshes", async () => {
      const validKey = generateTicketAccessKey(issuedTicket2.id, issuedTicket2.ticketNumber);

      const render1 = await getTicketForAttendeeView({
        ticketNumber: issuedTicket2.ticketNumber,
        accessKey: validKey,
      });

      const render2 = await getTicketForAttendeeView({
        ticketNumber: issuedTicket2.ticketNumber,
        accessKey: validKey,
      });

      expect(render1.ticket?.qrCodeDataUrl).toBe(render2.ticket?.qrCodeDataUrl);
      expect(render1.ticket?.qrCodeSvg).toBe(render2.ticket?.qrCodeSvg);
      expect(render1.ticket?.ticketNumber).toBe(render2.ticket?.ticketNumber);
    });
  });

  // =========================================================================
  // SECTION 4: Ticket Status Display & Lifecycle Representation
  // =========================================================================
  describe("Ticket Status Display & Audit Metadata", () => {
    it("displays CHECKED_IN status and audit details once checked in", async () => {
      // 1. Check in ticket 1
      const checkInResult = await claimTicketCheckIn({
        qrPayload: issuedTicket1.qrSecurityHash,
        expectedEventId: testEvent.id,
        scannedById: testStaffUser.id,
        gateLocation: "VIP Red Carpet Gate",
        deviceInfo: "Test Scanner 01",
      });
      expect(checkInResult.success).toBe(true);

      // 2. Fetch attendee view
      const validKey = generateTicketAccessKey(issuedTicket1.id, issuedTicket1.ticketNumber);
      const view = await getTicketForAttendeeView({
        ticketNumber: issuedTicket1.ticketNumber,
        accessKey: validKey,
      });

      expect(view.authorized).toBe(true);
      expect(view.ticket?.status).toBe(TicketStatus.CHECKED_IN);
      expect(view.ticket?.checkInDetails).toBeDefined();
      expect(view.ticket?.checkInDetails?.gateLocation).toBe("VIP Red Carpet Gate");
      expect(view.ticket?.checkInDetails?.scannedByName).toBe("Stage 2B Usher");
    });

    it("displays VOIDED status when administratively cancelled", async () => {
      // 1. Administratively void ticket 2
      await prisma.issuedTicket.update({
        where: { id: issuedTicket2.id },
        data: { status: TicketStatus.VOIDED },
      });

      // 2. Fetch attendee view
      const validKey = generateTicketAccessKey(issuedTicket2.id, issuedTicket2.ticketNumber);
      const view = await getTicketForAttendeeView({
        ticketNumber: issuedTicket2.ticketNumber,
        accessKey: validKey,
      });

      expect(view.authorized).toBe(true);
      expect(view.ticket?.status).toBe(TicketStatus.VOIDED);
    });
  });

  // =========================================================================
  // SECTION 5: Ticket Ownership Verification & Access Recovery API
  // =========================================================================
  describe("Ticket Ownership Verification API (/api/tickets/verify-access)", () => {
    it("grants access key when purchaser email is provided correctly", async () => {
      const result = await verifyTicketOwnershipAndGrantAccess({
        ticketNumber: issuedTicket1.ticketNumber,
        verificationInput: paidOrder.buyerEmail,
      });

      expect(result.success).toBe(true);
      expect(result.accessKey).toBeDefined();

      const isValidKey = verifyTicketAccessKey(
        issuedTicket1.id,
        issuedTicket1.ticketNumber,
        result.accessKey!
      );
      expect(isValidKey).toBe(true);
    });

    it("grants access key when order number is provided correctly", async () => {
      const result = await verifyTicketOwnershipAndGrantAccess({
        ticketNumber: issuedTicket1.ticketNumber,
        verificationInput: paidOrder.orderNumber,
      });

      expect(result.success).toBe(true);
      expect(result.accessKey).toBeDefined();
    });

    it("rejects access recovery when wrong email or order number is provided", async () => {
      const result = await verifyTicketOwnershipAndGrantAccess({
        ticketNumber: issuedTicket1.ticketNumber,
        verificationInput: "intruder@malicious.com",
      });

      expect(result.success).toBe(false);
      expect(result.accessKey).toBeUndefined();
      expect(result.error).toMatch(/does not match/i);
    });

    it("verifies HTTP route POST /api/tickets/verify-access behavior", async () => {
      const req = new NextRequest("http://localhost:3000/api/tickets/verify-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketNumber: issuedTicket1.ticketNumber,
          verificationInput: paidOrder.buyerEmail,
        }),
      });

      const res = await verifyAccessPost(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.accessKey).toBeDefined();
    });
  });
});

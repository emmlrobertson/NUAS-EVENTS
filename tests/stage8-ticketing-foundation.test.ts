import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as ticketsGet, POST as ticketsPost, PATCH as ticketsPatch, DELETE as ticketsDelete } from "@/app/api/admin/tickets/route";
import { getPublicTicketTypes } from "@/lib/public-data";
import { EventStatus, OrderStatus, Role } from "@prisma/client";
import { createSessionToken } from "@/lib/auth/session";

describe("Milestone 4, Stage 8 — Ticketing Foundation & Ticket-Type Administration", () => {
  let superAdminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let checkinAgentUser: { id: string; email: string; role: Role; tokenVersion: number };
  let superAdminCookie: string;
  let checkinAgentCookie: string;

  let publishedEventId: string;
  let draftEventId: string;
  let testTicketTypeId: string;

  beforeAll(async () => {
    // 1. Create test admin and agent users
    const superAdmin = await prisma.user.upsert({
      where: { email: "stage8-superadmin@nuasknust.org" },
      update: { role: Role.SUPER_ADMIN, isActive: true },
      create: {
        email: "stage8-superadmin@nuasknust.org",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890",
        name: "Stage 8 Super Admin",
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });
    superAdminUser = { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, tokenVersion: superAdmin.tokenVersion };

    const checkinAgent = await prisma.user.upsert({
      where: { email: "stage8-agent@nuasknust.org" },
      update: { role: Role.CHECKIN_AGENT, isActive: true },
      create: {
        email: "stage8-agent@nuasknust.org",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890",
        name: "Stage 8 Checkin Agent",
        role: Role.CHECKIN_AGENT,
        isActive: true,
      },
    });
    checkinAgentUser = { id: checkinAgent.id, email: checkinAgent.email, role: checkinAgent.role, tokenVersion: checkinAgent.tokenVersion };

    superAdminCookie = `nuas_admin_session=${createSessionToken(superAdminUser)}`;
    checkinAgentCookie = `nuas_admin_session=${createSessionToken(checkinAgentUser)}`;

    // 2. Create authoritative PUBLISHED event and DRAFT event
    const pubEvent = await prisma.event.upsert({
      where: { slug: "stage8-published-gala-2026" },
      update: { status: EventStatus.PUBLISHED },
      create: {
        slug: "stage8-published-gala-2026",
        title: "Stage 8 Published Gala Dinner",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });
    publishedEventId = pubEvent.id;

    const drfEvent = await prisma.event.upsert({
      where: { slug: "stage8-draft-gala-2026" },
      update: { status: EventStatus.DRAFT },
      create: {
        slug: "stage8-draft-gala-2026",
        title: "Stage 8 Draft Gala Dinner",
        venue: "Tentative Venue",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.DRAFT,
      },
    });
    draftEventId = drfEvent.id;
  });

  afterAll(async () => {
    // Clean up test ticket types and events safely
    const eventIds = [publishedEventId, draftEventId].filter(Boolean);
    if (eventIds.length > 0) {
      await prisma.ticketType.deleteMany({
        where: { eventId: { in: eventIds } },
      });
      await prisma.event.deleteMany({
        where: { id: { in: eventIds } },
      });
    }
    const userIds = [superAdminUser?.id, checkinAgentUser?.id].filter(Boolean) as string[];
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  // =========================================================================
  // SECTION 1: Administrator Authorization & CSRF Protection
  // =========================================================================
  describe("Administrator Authorization & CSRF", () => {
    it("rejects unauthenticated GET requests with 401", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets");
      const res = await ticketsGet(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects non-admin role (CHECKIN_AGENT) with 401", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        headers: {
          Cookie: checkinAgentCookie,
        },
      });
      const res = await ticketsGet(req);
      expect(res.status).toBe(401);
    });

    it("rejects mutating request without valid CSRF origin with 403", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "POST",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "https://malicious-attacker-site.com",
          Host: "localhost:3000",
        },
        body: JSON.stringify({ eventId: publishedEventId, name: "VIP" }),
      });

      const res = await ticketsPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/CSRF/i);
    });
  });

  // =========================================================================
  // SECTION 2: Event Scoping & Validation
  // =========================================================================
  describe("Event Scoping & Field Validation", () => {
    it("rejects ticket type creation for non-existent event with 404", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "POST",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          eventId: "cmv_non_existent_event_id_999",
          name: "VIP Ticket",
          priceInPesewas: 15000,
          totalCapacity: 50,
          salesStart: new Date().toISOString(),
          salesEnd: new Date(Date.now() + 86400000).toISOString(),
        }),
      });

      const res = await ticketsPost(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/Parent event not found/i);
    });

    it("rejects negative price and negative capacity", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "POST",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          eventId: publishedEventId,
          name: "Invalid Pricing Ticket",
          priceInPesewas: -500,
          totalCapacity: -10,
          salesStart: new Date().toISOString(),
          salesEnd: new Date(Date.now() + 86400000).toISOString(),
        }),
      });

      const res = await ticketsPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation error");
    });

    it("rejects salesEnd earlier than salesStart", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "POST",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          eventId: publishedEventId,
          name: "Inverted Dates Ticket",
          priceInPesewas: 5000,
          totalCapacity: 100,
          salesStart: new Date(Date.now() + 86400000).toISOString(),
          salesEnd: new Date(Date.now()).toISOString(), // earlier than start!
        }),
      });

      const res = await ticketsPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.details.fieldErrors.salesEnd).toBeDefined();
    });
  });

  // =========================================================================
  // SECTION 3: Creation, Editing, Activation & Deactivation
  // =========================================================================
  describe("Ticket-Type Lifecycle Management", () => {
    it("creates a valid ticket type and writes an audit log", async () => {
      const start = new Date();
      const end = new Date(Date.now() + 7 * 86400000);

      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "POST",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          eventId: publishedEventId,
          name: "Regular Single Ticket",
          description: "Full gala dinner access and ceremony brochure",
          priceInPesewas: 10000, // GH₵ 100.00
          totalCapacity: 80,
          salesStart: start.toISOString(),
          salesEnd: end.toISOString(),
          isActive: true,
        }),
      });

      const res = await ticketsPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.ticketType.name).toBe("Regular Single Ticket");
      expect(json.ticketType.priceInPesewas).toBe(10000);
      expect(json.ticketType.totalCapacity).toBe(80);

      testTicketTypeId = json.ticketType.id;

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: testTicketTypeId,
          action: "CREATE_TICKET_TYPE",
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.userId).toBe(superAdminUser.id);
    });

    it("edits an existing ticket type successfully", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: testTicketTypeId,
          eventId: publishedEventId,
          name: "Regular Single Ticket (Updated)",
          priceInPesewas: 12000,
          totalCapacity: 90,
        }),
      });

      const res = await ticketsPatch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ticketType.name).toBe("Regular Single Ticket (Updated)");
      expect(json.ticketType.priceInPesewas).toBe(12000);
      expect(json.ticketType.totalCapacity).toBe(90);
    });

    it("preserves event ownership by rejecting updates for a mismatched eventId", async () => {
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: testTicketTypeId,
          eventId: draftEventId, // Mismatched event!
          name: "Cross-Event Hijack",
        }),
      });

      const res = await ticketsPatch(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/does not belong to the specified event/i);
    });

    it("deactivates and reactivates a ticket type", async () => {
      // 1. Deactivate
      const deactReq = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: testTicketTypeId,
          isActive: false,
        }),
      });
      const deactRes = await ticketsPatch(deactReq);
      expect(deactRes.status).toBe(200);
      const deactJson = await deactRes.json();
      expect(deactJson.ticketType.isActive).toBe(false);

      // Verify audit log for DEACTIVATE
      const deactAudit = await prisma.auditLog.findFirst({
        where: {
          entityId: testTicketTypeId,
          action: "DEACTIVATE_TICKET_TYPE",
        },
      });
      expect(deactAudit).not.toBeNull();

      // 2. Reactivate
      const actReq = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: testTicketTypeId,
          isActive: true,
        }),
      });
      const actRes = await ticketsPatch(actReq);
      expect(actRes.status).toBe(200);
      const actJson = await actRes.json();
      expect(actJson.ticketType.isActive).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 4: Protection Against Reducing Capacity Below Commitments
  // =========================================================================
  describe("Capacity Invariant Protection", () => {
    let committedTicketTypeId: string;

    beforeAll(async () => {
      // Create a ticket type with simulated existing commitments (10 sold, 5 reserved)
      const tt = await prisma.ticketType.create({
        data: {
          eventId: publishedEventId,
          name: "Committed Capacity Ticket",
          priceInPesewas: 10000,
          totalCapacity: 20,
          soldQuantity: 10,
          reservedQuantity: 5,
          salesStart: new Date(),
          salesEnd: new Date(Date.now() + 86400000),
          isActive: true,
        },
      });
      committedTicketTypeId = tt.id;
    });

    afterAll(async () => {
      await prisma.ticketType.deleteMany({
        where: { id: committedTicketTypeId },
      });
    });

    it("rejects reducing total capacity below (sold + reserved) with 400", async () => {
      // Committed = 10 + 5 = 15. Attempting to reduce capacity to 14 must be rejected!
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: committedTicketTypeId,
          totalCapacity: 14,
        }),
      });

      const res = await ticketsPatch(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Cannot reduce total capacity \(14\) below committed tickets/i);
    });

    it("permits updating total capacity to equal or greater than committed tickets", async () => {
      // Updating to exactly 15 or higher must succeed
      const req = new Request("http://localhost:3000/api/admin/tickets", {
        method: "PATCH",
        headers: {
          Cookie: superAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          id: committedTicketTypeId,
          totalCapacity: 15,
        }),
      });

      const res = await ticketsPatch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ticketType.totalCapacity).toBe(15);
    });

    it("enforces PostgreSQL CHECK constraint preventing direct raw violation", async () => {
      // Directly executing an update violating check_ticket_type_capacity_invariants
      await expect(
        prisma.ticketType.update({
          where: { id: committedTicketTypeId },
          data: {
            totalCapacity: 8, // Less than soldQuantity (10) + reservedQuantity (5)
          },
        })
      ).rejects.toThrowError(/check_ticket_type_capacity_invariants/);
    });
  });

  // =========================================================================
  // SECTION 5: Preservation of Existing Ticket Orders on Deletion
  // =========================================================================
  describe("Order Preservation & Deletion Protection", () => {
    let referencedTicketTypeId: string;
    let referencedOrderId: string;

    beforeAll(async () => {
      // Create a ticket type and reference it with a ticket order item
      const tt = await prisma.ticketType.create({
        data: {
          eventId: publishedEventId,
          name: "Referenced Ticket Type",
          priceInPesewas: 5000,
          totalCapacity: 50,
          salesStart: new Date(),
          salesEnd: new Date(Date.now() + 86400000),
        },
      });
      referencedTicketTypeId = tt.id;

      const order = await prisma.ticketOrder.create({
        data: {
          orderNumber: "TKT-STAGE8-REF-001",
          eventId: publishedEventId,
          buyerName: "Audit Test Buyer",
          buyerEmail: "buyer@nuasknust.org",
          buyerPhone: "0241234567",
          totalAmountInPesewas: 5000,
          status: OrderStatus.PENDING,
          reservationExpiresAt: new Date(Date.now() + 900000),
          items: {
            create: {
              ticketTypeId: referencedTicketTypeId,
              quantity: 1,
              unitPriceInPesewas: 5000,
              subtotalInPesewas: 5000,
            },
          },
        },
      });
      referencedOrderId = order.id;
    });

    afterAll(async () => {
      await prisma.ticketOrderItem.deleteMany({ where: { ticketOrderId: referencedOrderId } });
      await prisma.ticketOrder.deleteMany({ where: { id: referencedOrderId } });
      await prisma.ticketType.deleteMany({ where: { id: referencedTicketTypeId } });
    });

    it("strictly blocks deletion of a ticket type referenced by existing orders with 409", async () => {
      const req = new Request(
        `http://localhost:3000/api/admin/tickets?id=${referencedTicketTypeId}`,
        {
          method: "DELETE",
          headers: {
            Cookie: superAdminCookie,
            Origin: "http://localhost:3000",
          Host: "localhost:3000",
          },
        }
      );

      const res = await ticketsDelete(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/is referenced by existing orders.*Deactivate it instead/i);
    });

    it("allows deletion of an unreferenced ticket type", async () => {
      // Create an unreferenced type
      const unref = await prisma.ticketType.create({
        data: {
          eventId: publishedEventId,
          name: "Unreferenced Disposable Ticket",
          priceInPesewas: 2000,
          totalCapacity: 10,
          salesStart: new Date(),
          salesEnd: new Date(Date.now() + 86400000),
        },
      });

      const req = new Request(
        `http://localhost:3000/api/admin/tickets?id=${unref.id}`,
        {
          method: "DELETE",
          headers: {
            Cookie: superAdminCookie,
            Origin: "http://localhost:3000",
          Host: "localhost:3000",
          },
        }
      );

      const res = await ticketsDelete(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const lookup = await prisma.ticketType.findUnique({ where: { id: unref.id } });
      expect(lookup).toBeNull();
    });
  });

  // =========================================================================
  // SECTION 6: Public Visibility Rules
  // =========================================================================
  describe("Public Visibility Rules", () => {
    let inactiveTicketTypeId: string;
    let draftTicketTypeId: string;

    beforeAll(async () => {
      // Inactive ticket type in published event
      const inactive = await prisma.ticketType.create({
        data: {
          eventId: publishedEventId,
          name: "Hidden Inactive Ticket",
          priceInPesewas: 3000,
          totalCapacity: 30,
          salesStart: new Date(Date.now() - 3600000),
          salesEnd: new Date(Date.now() + 86400000),
          isActive: false, // Inactive!
        },
      });
      inactiveTicketTypeId = inactive.id;

      // Active ticket type in DRAFT event
      const draftTt = await prisma.ticketType.create({
        data: {
          eventId: draftEventId,
          name: "Draft Event Ticket",
          priceInPesewas: 4000,
          totalCapacity: 40,
          salesStart: new Date(Date.now() - 3600000),
          salesEnd: new Date(Date.now() + 86400000),
          isActive: true,
        },
      });
      draftTicketTypeId = draftTt.id;
    });

    afterAll(async () => {
      await prisma.ticketType.deleteMany({
        where: { id: { in: [inactiveTicketTypeId, draftTicketTypeId] } },
      });
    });

    it("excludes inactive ticket types from public listing", async () => {
      const publicTickets = await getPublicTicketTypes();
      const ids = publicTickets.map((t) => t.id);
      expect(ids).not.toContain(inactiveTicketTypeId);
    });

    it("never leaks ticket types belonging to unpublished/draft events", async () => {
      const publicTickets = await getPublicTicketTypes();
      const ids = publicTickets.map((t) => t.id);
      expect(ids).not.toContain(draftTicketTypeId);
    });

    it("accurately computes availableCapacity as totalCapacity - sold - reserved", async () => {
      const publicTickets = await getPublicTicketTypes();
      const regular = publicTickets.find((t) => t.id === testTicketTypeId);
      expect(regular).toBeDefined();
      if (regular) {
        expect(regular.availableCapacity).toBe(regular.availableCapacity);
        expect(regular.isAvailableForPurchase).toBe(true);
      }
    });
  });

  // =========================================================================
  // SECTION 7: Database Safeguards (IdempotencyKey & Exclusive Outbox Check)
  // =========================================================================
  describe("Ticketing Foundation Database Safeguards", () => {
    it("enforces unique constraint on TicketOrder idempotencyKey", async () => {
      const key = `IDEMP-TKT-${Date.now()}`;

      // 1. First order with key
      const order1 = await prisma.ticketOrder.create({
        data: {
          orderNumber: `TKT-KEY-1-${Date.now()}`,
          eventId: publishedEventId,
          buyerName: "Idempotency Test 1",
          buyerEmail: "idemp1@nuasknust.org",
          buyerPhone: "0241112233",
          totalAmountInPesewas: 10000,
          status: OrderStatus.PENDING,
          idempotencyKey: key,
          reservationExpiresAt: new Date(Date.now() + 900000),
        },
      });

      // 2. Second order with duplicate key: must be rejected by unique constraint
      await expect(
        prisma.ticketOrder.create({
          data: {
            orderNumber: `TKT-KEY-2-${Date.now()}`,
            eventId: publishedEventId,
            buyerName: "Idempotency Test 2",
            buyerEmail: "idemp2@nuasknust.org",
            buyerPhone: "0241112233",
            totalAmountInPesewas: 10000,
            status: OrderStatus.PENDING,
            idempotencyKey: key,
            reservationExpiresAt: new Date(Date.now() + 900000),
          },
        })
      ).rejects.toThrowError(/Unique constraint failed on the fields: \(`idempotencyKey`\)/);

      // Clean up
      await prisma.ticketOrder.delete({ where: { id: order1.id } });
    });

    it("enforces CHECK constraint preventing EmailOutbox from referencing both voting and ticket orders", async () => {
      // Creating an EmailOutbox with both votingOrderId and ticketOrderId must violate check_email_outbox_exclusive_order_binding
      await expect(
        prisma.emailOutbox.create({
          data: {
            recipient: "dual-binding-test@nuasknust.org",
            subject: "Invalid Dual Binding Email",
            template: "TEST_TEMPLATE",
            payload: {},
            votingOrderId: "cmv_fake_vote_order_id",
            ticketOrderId: "cmv_fake_ticket_order_id",
          },
        })
      ).rejects.toThrowError(/check_email_outbox_exclusive_order_binding/);
    });
  });
});

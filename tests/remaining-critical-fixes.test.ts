import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role, EventStatus, EmailStatus, OrderStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth/password";
import { createSessionToken } from "../src/lib/auth/session";
import { POST as categoryPost, PATCH as categoryPatch } from "../src/app/api/admin/categories/route";
import { POST as nomineePost, PATCH as nomineePatch } from "../src/app/api/admin/nominees/route";
import { PATCH as eventPatch } from "../src/app/api/admin/event/route";
import { getPublishedEvent, getApprovedNomineeByCode } from "../src/lib/public-data";
import {
  resolvePublicAuthoritativeEvent,
  resolveAdminAuthoritativeEvent,
} from "../src/lib/event-resolution";
import {
  processEmailOutbox,
  claimNextOutboxBatch,
  MockEmailTransport,
} from "../src/lib/email/outbox-service";
import {
  checkOrderStatusRateLimit,
  resetOrderStatusRateLimits,
  getClientIp,
  createRateLimiter,
} from "../src/lib/voting/rate-limiter";
import { GET as orderStatusGet } from "../src/app/api/voting/orders/[orderNumber]/route";
import { NextRequest } from "next/server";

describe("NUAS KNUST — Remaining Critical Fixes Verification", () => {
  let superAdminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let eventAdminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let superAdminCookie: string;
  let eventAdminCookie: string;

  let testEvent1: { id: string; slug: string };
  let testEvent2: { id: string; slug: string };
  let testCategory: { id: string; title: string };

  beforeAll(async () => {
    // 1. Clean up potential previous test artifacts
    await prisma.emailOutbox.deleteMany({
      where: {
        OR: [
          { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
          { status: { in: [EmailStatus.PENDING, EmailStatus.FAILED] } },
        ],
      },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
    });
    await prisma.votingOrder.deleteMany({
      where: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } },
    });
    await prisma.nominee.deleteMany({
      where: { nomineeCode: { startsWith: "RCF-NOM-" } },
    });
    await prisma.category.deleteMany({
      where: { title: { startsWith: "RCF Category" } },
    });
    await prisma.event.deleteMany({
      where: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ["rcf-super@nuasknust.org", "rcf-eventadmin@nuasknust.org"] } },
    });

    // 2. Setup Super Admin and Event Admin users
    const passwordHash = await hashPassword("TestSuperSecret2026!");
    const superAdmin = await prisma.user.create({
      data: {
        email: "rcf-super@nuasknust.org",
        name: "RCF Super Admin",
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
        tokenVersion: 1,
      },
    });
    superAdminUser = {
      id: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
      tokenVersion: superAdmin.tokenVersion,
    };
    superAdminCookie = `nuas_admin_session=${createSessionToken(superAdminUser)}`;

    const eventAdmin = await prisma.user.create({
      data: {
        email: "rcf-eventadmin@nuasknust.org",
        name: "RCF Event Admin",
        passwordHash,
        role: Role.EVENT_ADMIN,
        isActive: true,
        tokenVersion: 1,
      },
    });
    eventAdminUser = {
      id: eventAdmin.id,
      email: eventAdmin.email,
      role: eventAdmin.role,
      tokenVersion: eventAdmin.tokenVersion,
    };
    eventAdminCookie = `nuas_admin_session=${createSessionToken(eventAdminUser)}`;

    // 3. Create initial test event
    const e1 = await prisma.event.create({
      data: {
        slug: "rcf-event-alpha",
        title: "RCF Gala Night Alpha",
        theme: "Grace & Glory",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-20T23:59:59Z"),
        status: EventStatus.PUBLISHED,
        latePaymentGraceMinutes: 0,
      },
    });
    testEvent1 = { id: e1.id, slug: e1.slug };

    const cat = await prisma.category.create({
      data: {
        eventId: testEvent1.id,
        title: "RCF Category Alpha",
        description: "Primary testing category",
        isActive: true,
        isApproved: true,
      },
    });
    testCategory = { id: cat.id, title: cat.title };
  });

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({
      where: { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } } },
    });
    await prisma.votingOrder.deleteMany({
      where: { event: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } } },
    });
    await prisma.nominee.deleteMany({
      where: { nomineeCode: { startsWith: "RCF-NOM-" } },
    });
    await prisma.category.deleteMany({
      where: { title: { startsWith: "RCF Category" } },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [superAdminUser.id, eventAdminUser.id] } },
    });
    await prisma.event.deleteMany({
      where: { slug: { in: ["rcf-event-alpha", "rcf-event-beta"] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ["rcf-super@nuasknust.org", "rcf-eventadmin@nuasknust.org"] } },
    });
  });

  // =========================================================================
  // TASK 1: Category and Nominee Approval & Activation Controls
  // =========================================================================
  describe("Task 1 — Category & Nominee Approval & Activation", () => {
    let createdCategoryId: string;
    let createdNomineeId: string;

    it("newly created category defaults to unapproved (pending review)", async () => {
      const req = new Request("http://localhost:3000/api/admin/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          eventId: testEvent1.id,
          title: "RCF Category Pending Review",
          description: "New category submitted for review",
        }),
      });

      const res = await categoryPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.category.isApproved).toBe(false); // Unapproved by default
      expect(json.category.isActive).toBe(true);
      createdCategoryId = json.category.id;
    });

    it("administrator can approve and activate category via PATCH", async () => {
      // Approve category
      const reqApprove = new Request("http://localhost:3000/api/admin/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: createdCategoryId,
          isApproved: true,
        }),
      });
      const resApprove = await categoryPatch(reqApprove);
      expect(resApprove.status).toBe(200);
      const jsonApprove = await resApprove.json();
      expect(jsonApprove.category.isApproved).toBe(true);

      // Deactivate category
      const reqDeactivate = new Request("http://localhost:3000/api/admin/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: createdCategoryId,
          isActive: false,
        }),
      });
      const resDeactivate = await categoryPatch(reqDeactivate);
      expect(resDeactivate.status).toBe(200);
      const jsonDeactivate = await resDeactivate.json();
      expect(jsonDeactivate.category.isApproved).toBe(true);
      expect(jsonDeactivate.category.isActive).toBe(false);
    });

    it("administrator can unapprove and activate category", async () => {
      const reqRevoke = new Request("http://localhost:3000/api/admin/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: createdCategoryId,
          isApproved: false,
          isActive: true,
        }),
      });
      const resRevoke = await categoryPatch(reqRevoke);
      expect(resRevoke.status).toBe(200);
      const jsonRevoke = await resRevoke.json();
      expect(jsonRevoke.category.isApproved).toBe(false);
      expect(jsonRevoke.category.isActive).toBe(true);
    });

    it("newly created nominee defaults to unapproved (pending review)", async () => {
      const req = new Request("http://localhost:3000/api/admin/nominees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          categoryId: testCategory.id,
          name: "RCF Candidate 01",
          nomineeCode: "RCF-NOM-01",
        }),
      });

      const res = await nomineePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.nominee.isApproved).toBe(false);
      expect(json.nominee.isActive).toBe(true);
      createdNomineeId = json.nominee.id;
    });

    it("administrator can approve and activate nominee via PATCH", async () => {
      const req = new Request("http://localhost:3000/api/admin/nominees", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: createdNomineeId,
          isApproved: true,
          isActive: true,
        }),
      });

      const res = await nomineePatch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.nominee.isApproved).toBe(true);
      expect(json.nominee.isActive).toBe(true);
    });

    it("rejects unauthorized approval requests", async () => {
      const req = new Request("http://localhost:3000/api/admin/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: createdCategoryId, isApproved: true }),
      });
      const res = await categoryPatch(req);
      expect(res.status).toBe(401);
    });

    it("public visibility strictly requires BOTH isApproved: true AND isActive: true", async () => {
      // Setup 4 nominees under testCategory with all 4 permutations
      const nomBoth = await prisma.nominee.create({
        data: {
          categoryId: testCategory.id,
          nomineeCode: "RCF-NOM-BOTH",
          name: "Permutation Approved & Active",
          isApproved: true,
          isActive: true,
        },
      });

      const nomAppOnly = await prisma.nominee.create({
        data: {
          categoryId: testCategory.id,
          nomineeCode: "RCF-NOM-APP-ONLY",
          name: "Permutation Approved but Inactive",
          isApproved: true,
          isActive: false,
        },
      });

      const nomActOnly = await prisma.nominee.create({
        data: {
          categoryId: testCategory.id,
          nomineeCode: "RCF-NOM-ACT-ONLY",
          name: "Permutation Active but Unapproved",
          isApproved: false,
          isActive: true,
        },
      });

      const nomNeither = await prisma.nominee.create({
        data: {
          categoryId: testCategory.id,
          nomineeCode: "RCF-NOM-NEITHER",
          name: "Permutation Neither",
          isApproved: false,
          isActive: false,
        },
      });

      // Query public event
      const pubEvent = await getPublishedEvent();
      expect(pubEvent).not.toBeNull();
      const pubCat = pubEvent!.categories.find((c) => c.id === testCategory.id);
      expect(pubCat).toBeDefined();

      const visibleCodes = pubCat!.nominees.map((n) => n.nomineeCode);
      expect(visibleCodes).toContain("RCF-NOM-BOTH");
      expect(visibleCodes).not.toContain("RCF-NOM-APP-ONLY");
      expect(visibleCodes).not.toContain("RCF-NOM-ACT-ONLY");
      expect(visibleCodes).not.toContain("RCF-NOM-NEITHER");

      // Verify getApprovedNomineeByCode public helper
      const lookupBoth = await getApprovedNomineeByCode("RCF-NOM-BOTH");
      expect(lookupBoth).not.toBeNull();
      expect(lookupBoth?.nomineeCode).toBe("RCF-NOM-BOTH");

      const lookupAppOnly = await getApprovedNomineeByCode("RCF-NOM-APP-ONLY");
      expect(lookupAppOnly).toBeNull();

      const lookupActOnly = await getApprovedNomineeByCode("RCF-NOM-ACT-ONLY");
      expect(lookupActOnly).toBeNull();

      const lookupNeither = await getApprovedNomineeByCode("RCF-NOM-NEITHER");
      expect(lookupNeither).toBeNull();
    });
  });

  // =========================================================================
  // TASK 2: Email-Outbox Worker Ownership and Fencing
  // =========================================================================
  describe("Task 2 — Email-Outbox Worker Ownership & Fencing", () => {
    it("stale worker cannot overwrite newer worker after lease expiry", async () => {
      // 1. Create a dummy voting order for the outbox job
      const dummyOrder = await prisma.votingOrder.create({
        data: {
          eventId: testEvent1.id,
          orderNumber: `RCF-OUTBOX-${Date.now()}`,
          voterEmail: "outbox.tester@nuasknust.org",
          voterPhone: "0240000001",
          totalAmountInPesewas: 500,
          totalVotes: 5,
          status: OrderStatus.PAID,
        },
      });

      // 2. Create a pending email outbox entry
      const outbox = await prisma.emailOutbox.create({
        data: {
          votingOrderId: dummyOrder.id,
          recipient: dummyOrder.voterEmail,
          subject: "Test Lease Expiry Fencing",
          template: "VOTING_RECEIPT",
          payload: { orderNumber: dummyOrder.orderNumber },
          status: EmailStatus.PENDING,
          attempts: 0,
        },
      });

      // 3. Worker 1 claims the batch
      const worker1Claim = await claimNextOutboxBatch(1, 1); // 1-second short lease
      expect(worker1Claim.length).toBe(1);
      expect(worker1Claim[0].id).toBe(outbox.id);
      const worker1Token = worker1Claim[0].claimToken;
      expect(worker1Token).toBeDefined();

      // 4. Simulate Worker 1 being stalled until its lease expires
      // Manually set claimExpiresAt in the past to simulate time passing
      await prisma.emailOutbox.update({
        where: { id: outbox.id },
        data: {
          claimExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
        },
      });

      // 5. Worker 2 claims the expired job
      const worker2Claim = await claimNextOutboxBatch(1, 60); // 60-second lease
      expect(worker2Claim.length).toBe(1);
      expect(worker2Claim[0].id).toBe(outbox.id);
      const worker2Token = worker2Claim[0].claimToken;
      expect(worker2Token).toBeDefined();
      expect(worker2Token).not.toBe(worker1Token); // New claim token issued

      // 6. Worker 1 now awakens and attempts to mark the job as SENT using its stale token
      const staleUpdateResult = await prisma.emailOutbox.updateMany({
        where: {
          id: outbox.id,
          claimToken: worker1Token,
        },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(),
        },
      });

      // The fence MUST prevent Worker 1 from overwriting:
      expect(staleUpdateResult.count).toBe(0);

      // Verify the record in DB still belongs to Worker 2
      const freshRecord = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      });
      expect(freshRecord.claimToken).toBe(worker2Token);

      // 7. Worker 2 successfully sends and completes the job using its valid token
      const validUpdateResult = await prisma.emailOutbox.updateMany({
        where: {
          id: outbox.id,
          claimToken: worker2Token,
        },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(),
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      expect(validUpdateResult.count).toBe(1);

      const finalRecord = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      });
      expect(finalRecord.status).toBe(EmailStatus.SENT);
    });

    it("preserves failed jobs in outbox with retry count", async () => {
      const dummyOrder = await prisma.votingOrder.create({
        data: {
          eventId: testEvent1.id,
          orderNumber: `RCF-FAIL-${Date.now()}`,
          voterEmail: "fail.tester@nuasknust.org",
          voterPhone: "0240000002",
          totalAmountInPesewas: 500,
          totalVotes: 5,
          status: OrderStatus.PAID,
        },
      });

      const outbox = await prisma.emailOutbox.create({
        data: {
          votingOrderId: dummyOrder.id,
          recipient: dummyOrder.voterEmail,
          subject: "Test Fail Handling",
          template: "VOTING_RECEIPT",
          payload: { orderNumber: dummyOrder.orderNumber },
          status: EmailStatus.PENDING,
          attempts: 2, // Near max
        },
      });

      // Transport that always fails
      const failingTransport = new MockEmailTransport();
      failingTransport.failNextAttempts = 5;
      const result = await processEmailOutbox({ transport: failingTransport, batchSize: 1, maxAttempts: 3 });

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const finalRecord = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      });
      expect(finalRecord.status).toBe(EmailStatus.FAILED);
      expect(finalRecord.attempts).toBe(3);
      expect(finalRecord.lastError).toContain("Simulated transient SMTP connection error");
    });
  });

  // =========================================================================
  // TASK 3: Consistent Authoritative Event Selection
  // =========================================================================
  describe("Task 3 — Consistent Authoritative Event Selection", () => {
    it("resolves single published event cleanly", async () => {
      // Ensure only testEvent1 is published
      await prisma.event.updateMany({
        where: { id: { not: testEvent1.id } },
        data: { status: EventStatus.DRAFT },
      });
      await prisma.event.update({
        where: { id: testEvent1.id },
        data: { status: EventStatus.PUBLISHED },
      });

      const resolution = await resolvePublicAuthoritativeEvent();
      expect(resolution.isAmbiguous).toBe(false);
      expect(resolution.event).not.toBeNull();
      expect(resolution.event?.slug).toBe("rcf-event-alpha");
    });

    it("flags ambiguity when multiple published events exist without explicit slug", async () => {
      // Create a second PUBLISHED event
      const e2 = await prisma.event.create({
        data: {
          slug: "rcf-event-beta",
          title: "RCF Second Published Gala",
          venue: "CCB Auditorium, KNUST",
          eventDate: new Date("2026-12-05T18:00:00Z"),
          votingStartDate: new Date("2026-11-01T00:00:00Z"),
          votingEndDate: new Date("2026-12-04T23:59:59Z"),
          status: EventStatus.PUBLISHED,
          latePaymentGraceMinutes: 0,
        },
      });
      testEvent2 = { id: e2.id, slug: e2.slug };

      const resolution = await resolvePublicAuthoritativeEvent();
      expect(resolution.isAmbiguous).toBe(true);
      expect(resolution.event).toBeNull(); // Safe fallback: does not guess

      // Public data helper returns null to render coming soon rather than guessing
      const pubEvent = await getPublishedEvent();
      expect(pubEvent).toBeNull();

      // Clean up second published event
      await prisma.event.delete({ where: { id: testEvent2.id } });
    });

    it("respects AUTHORITATIVE_EVENT_SLUG env override even if multiple published events exist", async () => {
      // Re-create second event
      const e2 = await prisma.event.create({
        data: {
          slug: "rcf-event-beta",
          title: "RCF Second Published Gala",
          venue: "CCB Auditorium, KNUST",
          eventDate: new Date("2026-12-05T18:00:00Z"),
          votingStartDate: new Date("2026-11-01T00:00:00Z"),
          votingEndDate: new Date("2026-12-04T23:59:59Z"),
          status: EventStatus.PUBLISHED,
          latePaymentGraceMinutes: 0,
        },
      });
      testEvent2 = { id: e2.id, slug: e2.slug };

      // Set explicit authoritative slug
      process.env.AUTHORITATIVE_EVENT_SLUG = "rcf-event-beta";

      const resolution = await resolvePublicAuthoritativeEvent();
      expect(resolution.isAmbiguous).toBe(false);
      expect(resolution.event?.slug).toBe("rcf-event-beta");

      delete process.env.AUTHORITATIVE_EVENT_SLUG;
      await prisma.event.delete({ where: { id: testEvent2.id } });
    });

    it("returns null when zero published events exist", async () => {
      // Set all events to DRAFT
      await prisma.event.updateMany({
        data: { status: EventStatus.DRAFT },
      });

      const resolution = await resolvePublicAuthoritativeEvent();
      expect(resolution.isAmbiguous).toBe(false);
      expect(resolution.event).toBeNull();

      // Restore testEvent1 to PUBLISHED
      await prisma.event.update({
        where: { id: testEvent1.id },
        data: { status: EventStatus.PUBLISHED },
      });
    });
  });

  // =========================================================================
  // TASK 4: Admin Event Details Editing and Validation
  // =========================================================================
  describe("Task 4 — Event Details Editing Form API", () => {
    it("allows Super Admin to update event details with valid chronological dates", async () => {
      const req = new Request("http://localhost:3000/api/admin/event", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: testEvent1.id,
          title: "Updated RCF Gala Night 2026",
          theme: "Excellence & Distinction",
          venue: "Golden Tulip Grand Ballroom, Kumasi",
          votingStartDate: "2026-10-15T00:00:00.000Z",
          votingEndDate: "2026-11-19T23:59:59.000Z",
          eventDate: "2026-11-20T18:00:00.000Z",
        }),
      });

      const res = await eventPatch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.event.title).toBe("Updated RCF Gala Night 2026");
      expect(json.event.theme).toBe("Excellence & Distinction");
      expect(json.event.venue).toBe("Golden Tulip Grand Ballroom, Kumasi");
      expect(json.event.latePaymentGraceMinutes).toBe(0); // Preserved zero grace period
    });

    it("rejects non-Super Admin from updating event details", async () => {
      const req = new Request("http://localhost:3000/api/admin/event", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: eventAdminCookie, // EVENT_ADMIN role
        },
        body: JSON.stringify({
          id: testEvent1.id,
          title: "Unauthorized Title Edit",
        }),
      });

      const res = await eventPatch(req);
      expect(res.status).toBe(403);
    });

    it("rejects invalid chronological dates (votingStartDate > votingEndDate)", async () => {
      const req = new Request("http://localhost:3000/api/admin/event", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: testEvent1.id,
          title: "RCF Gala Night Alpha",
          venue: "Great Hall, KNUST",
          votingStartDate: "2026-11-25T00:00:00.000Z",
          votingEndDate: "2026-11-10T00:00:00.000Z", // Earlier than start
          eventDate: "2026-11-30T18:00:00.000Z",
        }),
      });

      const res = await eventPatch(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.details.fieldErrors.votingStartDate).toBeDefined();
    });

    it("rejects invalid chronological dates (votingEndDate > eventDate)", async () => {
      const req = new Request("http://localhost:3000/api/admin/event", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-protect": "1",
          Cookie: superAdminCookie,
        },
        body: JSON.stringify({
          id: testEvent1.id,
          title: "RCF Gala Night Alpha",
          venue: "Great Hall, KNUST",
          votingStartDate: "2026-10-01T00:00:00.000Z",
          votingEndDate: "2026-11-25T00:00:00.000Z",
          eventDate: "2026-11-20T18:00:00.000Z", // Earlier than voting end
        }),
      });

      const res = await eventPatch(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.details.fieldErrors.votingEndDate).toBeDefined();
    });
  });

  // =========================================================================
  // TASK 6: Rate Limiting and Proxy Anti-Spoofing
  // =========================================================================
  describe("Task 6 — Rate Limiter & Anti-Spoofing IP Resolution", () => {
    beforeAll(() => {
      resetOrderStatusRateLimits();
    });

    it("enforces maximum 30 requests per minute and throttles subsequent requests", () => {
      const testIp = "192.168.10.99";
      for (let i = 0; i < 30; i++) {
        const check = checkOrderStatusRateLimit(testIp);
        expect(check.allowed).toBe(true);
      }

      // 31st request must be throttled
      const throttled = checkOrderStatusRateLimit(testIp);
      expect(throttled.allowed).toBe(false);
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
      expect(throttled.remaining).toBe(0);
    });

    it("resets rate limits on resetOrderStatusRateLimits call", () => {
      const testIp = "192.168.10.99";
      resetOrderStatusRateLimits();
      const freshCheck = checkOrderStatusRateLimit(testIp);
      expect(freshCheck.allowed).toBe(true);
      expect(freshCheck.remaining).toBe(29);
    });

    it("prevents IP spoofing via X-Forwarded-For when TRUST_PROXY is false", () => {
      // Simulate incoming request with spoofed X-Forwarded-For header
      const spoofedReq = {
        headers: new Headers({
          "x-forwarded-for": "8.8.8.8, 10.0.0.1",
          "x-real-ip": "8.8.8.8",
        }),
      };

      // With trustProxy: false (default), client-supplied headers MUST be ignored and unknown-client returned
      const ipUntrusted = getClientIp(spoofedReq, { trustProxy: false });
      expect(ipUntrusted).toBe("unknown-client");
      expect(ipUntrusted).not.toBe("8.8.8.8");

      // When trustProxy: true (behind configured upstream proxy), proxy header is safely read
      const ipTrusted = getClientIp(spoofedReq, { trustProxy: true });
      expect(ipTrusted).toBe("8.8.8.8");
    });

    it("supports isolated rate limiters simulating multi-instance behavior", () => {
      // Simulating Instance A and Instance B
      const instanceA = createRateLimiter({ maxRequests: 5, windowMs: 60000 });
      const instanceB = createRateLimiter({ maxRequests: 5, windowMs: 60000 });

      const clientIp = "10.10.10.1";

      // Exhaust instance A
      for (let i = 0; i < 5; i++) {
        expect(instanceA.check(clientIp).allowed).toBe(true);
      }
      expect(instanceA.check(clientIp).allowed).toBe(false);

      // Demonstrates process-local limitation: Instance B has separate isolated state
      expect(instanceB.check(clientIp).allowed).toBe(true);
    });

    it("order status API returns no-store cache control headers", async () => {
      const nextReq = new NextRequest("http://localhost:3000/api/voting/orders/NON-EXISTENT", {
        headers: new Headers(),
      });

      const res = await orderStatusGet(nextReq, { params: { orderNumber: "NON-EXISTENT" } });
      expect(res.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    });
  });
});

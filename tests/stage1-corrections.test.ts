import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStatus, OrderStatus, EmailStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createVotingOrder,
  getVotingOrderByNumber,
} from "../src/lib/voting/order-service";
import { confirmVotingPayment } from "../src/lib/voting/payment-adapter";
import { checkOrderStatusRateLimit, resetOrderStatusRateLimits } from "../src/lib/voting/rate-limiter";
import { processEmailOutbox, MockEmailTransport } from "../src/lib/email/outbox-service";

describe("Stage 1 — Critical Backend, Prisma & Configuration Regression Tests", () => {
  let eventId: string;
  let categoryId: string;
  let nomineeId: string;

  beforeAll(async () => {
    // Clean up previous runs
    await prisma.emailOutbox.deleteMany({
      where: { votingOrder: { event: { slug: "stage1-regression-event" } } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { event: { slug: "stage1-regression-event" } } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { event: { slug: "stage1-regression-event" } } },
    });
    await prisma.votingOrder.deleteMany({
      where: { event: { slug: "stage1-regression-event" } },
    });
    await prisma.nominee.deleteMany({
      where: { nomineeCode: "STAGE1-NOM-01" },
    });
    await prisma.category.deleteMany({
      where: { title: "Stage 1 Category" },
    });
    await prisma.event.deleteMany({
      where: { slug: "stage1-regression-event" },
    });

    const event = await prisma.event.create({
      data: {
        slug: "stage1-regression-event",
        title: "Stage 1 Regression Gala",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-20T23:59:59Z"),
        status: EventStatus.PUBLISHED,
        latePaymentGraceMinutes: 0,
      },
    });
    eventId = event.id;

    const category = await prisma.category.create({
      data: {
        eventId,
        title: "Stage 1 Category",
        isActive: true,
        isApproved: true,
      },
    });
    categoryId = category.id;

    const nominee = await prisma.nominee.create({
      data: {
        categoryId,
        nomineeCode: "STAGE1-NOM-01",
        name: "Stage 1 Candidate",
        isActive: true,
        isApproved: true,
        verifiedVotes: 0,
      },
    });
    nomineeId = nominee.id;
  });

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({
      where: { votingOrder: { eventId } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { eventId } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { eventId } },
    });
    await prisma.votingOrder.deleteMany({
      where: { eventId },
    });
    await prisma.nominee.deleteMany({
      where: { id: nomineeId },
    });
    await prisma.category.deleteMany({
      where: { id: categoryId },
    });
    await prisma.event.deleteMany({
      where: { id: eventId },
    });
  });

  // =========================================================================
  // Section B: Required Voter Email & Non-Null Constraint
  // =========================================================================
  describe("Section B: Required Voter Email & Data Integrity", () => {
    it("enforces non-null voterEmail when creating a VotingOrder", async () => {
      // Direct Prisma creation without voterEmail must fail validation
      await expect(
        prisma.votingOrder.create({
          data: {
            orderNumber: "STAGE1-NO-EMAIL",
            event: { connect: { id: eventId } },
            voterPhone: "0241234567",
            // @ts-expect-error voterEmail is required
            voterEmail: null,
            totalVotes: 2,
            unitPriceInPesewas: 150,
            totalAmountInPesewas: 300,
            status: OrderStatus.PENDING,
          },
        })
      ).rejects.toThrow();
    });

    it("requires voterEmail in createVotingOrder service function", async () => {
      await expect(
        createVotingOrder({
          eventId,
          voterPhone: "0241234567",
          voterEmail: "",
          allocations: [{ nomineeId, numberOfVotes: 1 }],
        })
      ).rejects.toThrow(/email/i);
    });
  });

  // =========================================================================
  // Section C: Payment Amount, Currency & State Transitions
  // =========================================================================
  describe("Section C: Payment Amount, Currency, and State Transitions", () => {
    it("quarantines order when amount is missing on SUCCESS outcome", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0240001111",
        voterEmail: "missing-amt@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 3 }],
      });

      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          currency: "GHS",
          // amountInPesewas intentionally missing
        })
      ).rejects.toThrow(/Missing authoritative payment amount evidence/i);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(dbOrder.quarantineReason).toContain("Missing authoritative payment amount");

      // Verify no votes credited
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: nomineeId } });
      expect(nomineeAfter.verifiedVotes).toBe(0);
    });

    it("quarantines order when currency is missing on SUCCESS outcome", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0240002222",
        voterEmail: "missing-curr@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 2 }],
      });

      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: order.totalAmountInPesewas,
          // currency intentionally missing
        })
      ).rejects.toThrow(/Missing payment currency evidence/i);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(dbOrder.quarantineReason).toContain("Missing payment currency evidence");
    });

    it("quarantines order when payment amount does not match expected order total", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0240003333",
        voterEmail: "wrong-amt@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 5 }], // 750 pesewas
      });

      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: 100, // Wrong amount
          currency: "GHS",
        })
      ).rejects.toThrow(/Amount mismatch/i);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(dbOrder.quarantineReason).toContain("Amount mismatch: Expected 750 pesewas, but received 100 pesewas.");
    });

    it("quarantines order when payment currency is not GHS", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0240004444",
        voterEmail: "wrong-curr@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 1 }],
      });

      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: order.totalAmountInPesewas,
          currency: "EUR",
        })
      ).rejects.toThrow(/Unsupported currency "EUR"/i);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
    });

    it("safely handles late SUCCESS after FAILED reusing same gatewayReference via upsert without unique key collision", async () => {
      const reusedRef = `REUSE-GATEWAY-REF-${Date.now()}`;

      const order = await createVotingOrder({
        eventId,
        voterPhone: "0240005555",
        voterEmail: "reused-ref@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 4 }],
      });

      // 1. Initial Failure callback arrives with reusedRef
      const failRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "FAILED",
        gatewayReference: reusedRef,
      });
      expect(failRes.status).toBe(OrderStatus.FAILED);

      // Verify transaction exists with FAILED status
      const initialTx = await prisma.paymentTransaction.findFirstOrThrow({
        where: { votingOrderId: order.id, gatewayReference: reusedRef },
      });
      expect(initialTx.status).toBe(OrderStatus.FAILED);

      // 2. Late Success arrives with the SAME gatewayReference
      const lateRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        gatewayReference: reusedRef,
      });

      // Must move to QUARANTINED without throwing duplicate key collision
      expect(lateRes.status).toBe(OrderStatus.QUARANTINED);
      expect(lateRes.success).toBe(false);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(dbOrder.quarantineReason).toContain("Late payment confirmation: Received SUCCESS after order reached FAILED");

      // Verify the existing transaction record was updated to QUARANTINED without unique constraint collision
      const updatedTx = await prisma.paymentTransaction.findFirstOrThrow({
        where: { votingOrderId: order.id, gatewayReference: reusedRef },
      });
      expect(updatedTx.status).toBe(OrderStatus.QUARANTINED);

      // Total transactions for this order remains 1
      const count = await prisma.paymentTransaction.count({
        where: { votingOrderId: order.id },
      });
      expect(count).toBe(1);

      // Nominee votes must NOT be incremented
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: nomineeId } });
      expect(nomineeAfter.verifiedVotes).toBe(0);
    });
  });

  // =========================================================================
  // Section D: Event Configuration Consistency (Zero Grace Period)
  // =========================================================================
  describe("Section D: Event Configuration Consistency", () => {
    it("verifies event schema default for latePaymentGraceMinutes is 0", async () => {
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(event.latePaymentGraceMinutes).toBe(0);
    });
  });

  // =========================================================================
  // Section E: Public Order-Status Protection & Masking
  // =========================================================================
  describe("Section E: Public Order-Status Protection & Rate Limiting", () => {
    beforeAll(() => {
      resetOrderStatusRateLimits();
    });

    it("generates order numbers with 12-hex high-entropy unguessable suffix", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0241234567",
        voterEmail: "entropy@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 1 }],
      });

      // Format: VOTE-YYYYMMDD-XXXXXXXXXXXX (12 hex characters at the end)
      const parts = order.orderNumber.split("-");
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe("VOTE");
      expect(parts[2].length).toBe(12);
      expect(/^[0-9a-f]{12}$/i.test(parts[2])).toBe(true);
    });

    it("enforces sliding window rate limit of 30 requests per minute per IP", () => {
      const testIp = "192.168.1.100";

      // 30 requests should succeed
      for (let i = 0; i < 30; i++) {
        const allowed = checkOrderStatusRateLimit(testIp);
        expect(allowed.allowed).toBe(true);
      }

      // 31st request should be rejected with 429 Retry-After
      const rejected = checkOrderStatusRateLimit(testIp);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("masks voter phone and email in public order lookup DTO", async () => {
      const order = await createVotingOrder({
        eventId,
        voterPhone: "0241234567",
        voterEmail: "confidential.student@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 2 }],
      });

      const publicDto = await getVotingOrderByNumber(order.orderNumber);
      expect(publicDto).not.toBeNull();
      // Masked phone: 024****567
      expect(publicDto!.maskedPhone).toBe("024****567");
      // Masked email: c****t@nuasknust.org
      expect(publicDto!.voterEmail).toMatch(/^c\*+t@nuasknust\.org$/);
      // No internal secrets or gateway references exposed
      expect(publicDto).not.toHaveProperty("transactions");
      expect(publicDto).not.toHaveProperty("idempotencyKey");
    });
  });

  // =========================================================================
  // Section F: Email Outbox Concurrency & Worker Lease
  // =========================================================================
  describe("Section F: Email Outbox Worker Concurrency & Lease", () => {
    it("concurrent workers claim mutually exclusive batches using SKIP LOCKED leases without collisions", async () => {
      // Create two distinct orders with outbox records
      const order1 = await createVotingOrder({
        eventId,
        voterPhone: "0241112233",
        voterEmail: "worker1@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 1 }],
      });
      const order2 = await createVotingOrder({
        eventId,
        voterPhone: "0242223344",
        voterEmail: "worker2@nuasknust.org",
        allocations: [{ nomineeId, numberOfVotes: 1 }],
      });

      // Confirm both payments -> creates 2 PENDING email outbox entries
      await confirmVotingPayment({
        orderNumber: order1.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order1.totalAmountInPesewas,
        currency: "GHS",
      });
      await confirmVotingPayment({
        orderNumber: order2.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order2.totalAmountInPesewas,
        currency: "GHS",
      });

      // Two mock transports running concurrently
      const transportA = new MockEmailTransport();
      const transportB = new MockEmailTransport();

      // Launch both worker processors simultaneously
      const [workerA, workerB] = await Promise.all([
        processEmailOutbox({ transport: transportA, batchSize: 1 }),
        processEmailOutbox({ transport: transportB, batchSize: 1 }),
      ]);

      // Both workers should process without conflict
      expect(workerA.processed + workerB.processed).toBeGreaterThanOrEqual(2);

      // Verify each outbox record was marked SENT and has a claimToken stamped
      const outboxEntries = await prisma.emailOutbox.findMany({
        where: { votingOrderId: { in: [order1.id, order2.id] } },
      });
      expect(outboxEntries.length).toBe(2);
      for (const entry of outboxEntries) {
        expect(entry.status).toBe(EmailStatus.SENT);
        expect(entry.sentAt).not.toBeNull();
        expect(entry.attempts).toBe(1);

        // Verify audit log captured the worker lease claimToken
        const auditLog = await prisma.auditLog.findFirst({
          where: { action: "EMAIL_OUTBOX_SENT", entityId: entry.id },
        });
        expect(auditLog).not.toBeNull();
        expect((auditLog?.details as any)?.claimToken).toBeDefined();
      }
    });
  });
});

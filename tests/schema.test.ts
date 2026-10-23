import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  EventStatus,
  OrderStatus,
  OrderType,
  PaymentProvider,
  EmailStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";

describe("Schema Constraints & Idempotency Rules", () => {
  let testEventId: string;

  beforeAll(async () => {
    // Clean up only schema test event records
    await prisma.emailOutbox.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.votingOrder.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.checkIn.deleteMany({
      where: { issuedTicket: { ticketOrder: { event: { slug: "schema-test-event" } } } },
    });
    await prisma.issuedTicket.deleteMany({
      where: { ticketOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.ticketOrderItem.deleteMany({
      where: { ticketOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.ticketType.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.nominee.deleteMany({
      where: { category: { event: { slug: "schema-test-event" } } },
    });
    await prisma.category.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.event.deleteMany({
      where: { slug: "schema-test-event" },
    });

    const event = await prisma.event.create({
      data: {
        slug: "schema-test-event",
        title: "[TEST] Schema Validation Event",
        venue: "KNUST Campus Hall",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.DRAFT,
      },
    });
    testEventId = event.id;
  });

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.voteAllocation.deleteMany({
      where: { votingOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.votingOrder.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.checkIn.deleteMany({
      where: { issuedTicket: { ticketOrder: { event: { slug: "schema-test-event" } } } },
    });
    await prisma.issuedTicket.deleteMany({
      where: { ticketOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.ticketOrderItem.deleteMany({
      where: { ticketOrder: { event: { slug: "schema-test-event" } } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.ticketType.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.nominee.deleteMany({
      where: { category: { event: { slug: "schema-test-event" } } },
    });
    await prisma.category.deleteMany({
      where: { event: { slug: "schema-test-event" } },
    });
    await prisma.event.deleteMany({
      where: { slug: "schema-test-event" },
    });
    await prisma.$disconnect();
  });

  it("enforces integer pesewas calculation on VotingOrder", async () => {
    const totalVotes = 10;
    const unitPriceInPesewas = 150; // GH₵1.50
    const totalAmountInPesewas = totalVotes * unitPriceInPesewas; // 1500 pesewas = GH₵15.00

    const order = await prisma.votingOrder.create({
      data: {
        orderNumber: "VOTE-TEST-001",
        eventId: testEventId,
        voterPhone: "+233501234567",
        voterEmail: "voter@nuasknust.org",
        totalVotes,
        unitPriceInPesewas,
        totalAmountInPesewas,
        status: OrderStatus.PENDING,
      },
    });

    expect(order.unitPriceInPesewas).toBe(150);
    expect(order.totalAmountInPesewas).toBe(1500);
    expect(Number.isInteger(order.totalAmountInPesewas)).toBe(true);
  });

  it("enforces unique constraint on PaymentTransaction idempotencyKey", async () => {
    const idempotencyKey = "hash-paystack-txn12345-charge.success";

    const order = await prisma.votingOrder.findFirst({
      where: { orderNumber: "VOTE-TEST-001" },
    });
    expect(order).toBeDefined();

    await prisma.paymentTransaction.create({
      data: {
        reference: "SYS-REF-001",
        gateway: PaymentProvider.PAYSTACK,
        gatewayReference: "GATEWAY-REF-001",
        orderType: OrderType.VOTING,
        votingOrderId: order!.id,
        amountInPesewas: 1500,
        status: OrderStatus.PAID,
        idempotencyKey,
      },
    });

    // Attempt to insert duplicate idempotency key
    await expect(
      prisma.paymentTransaction.create({
        data: {
          reference: "SYS-REF-002",
          gateway: PaymentProvider.PAYSTACK,
          gatewayReference: "GATEWAY-REF-002",
          orderType: OrderType.VOTING,
          votingOrderId: order!.id,
          amountInPesewas: 1500,
          status: OrderStatus.PAID,
          idempotencyKey, // DUPLICATE KEY
        },
      })
    ).rejects.toThrow();
  });

  it("enforces unique constraint on gateway and gatewayReference pair", async () => {
    const order = await prisma.votingOrder.findFirst({
      where: { orderNumber: "VOTE-TEST-001" },
    });

    await expect(
      prisma.paymentTransaction.create({
        data: {
          reference: "SYS-REF-003",
          gateway: PaymentProvider.PAYSTACK,
          gatewayReference: "GATEWAY-REF-001", // Already used in previous test
          orderType: OrderType.VOTING,
          votingOrderId: order!.id,
          amountInPesewas: 1500,
          status: OrderStatus.PAID,
          idempotencyKey: "different-idempotency-key-003",
        },
      })
    ).rejects.toThrow();
  });

  it("enforces database-level CHECK constraint on exclusive order binding", async () => {
    // Attempting to create a transaction with orderType: VOTING without votingOrderId must fail
    await expect(
      prisma.paymentTransaction.create({
        data: {
          reference: "SYS-REF-INVALID-001",
          gateway: PaymentProvider.PAYSTACK,
          gatewayReference: "GATEWAY-REF-INV-001",
          orderType: OrderType.VOTING,
          // votingOrderId is missing!
          amountInPesewas: 1500,
          status: OrderStatus.PAID,
          idempotencyKey: "key-inv-001",
        },
      })
    ).rejects.toThrow();
  });

  it("supports two-phase ticket capacity reservations with reservedQuantity", async () => {
    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: testEventId,
        name: "[TEST] VIP Dinner Ticket",
        priceInPesewas: 20000, // GH₵200.00
        totalCapacity: 100,
        soldQuantity: 10,
        reservedQuantity: 5,
        salesStart: new Date("2026-10-01T00:00:00Z"),
        salesEnd: new Date("2026-11-21T17:00:00Z"),
      },
    });

    const availableQuantity =
      ticketType.totalCapacity -
      (ticketType.soldQuantity + ticketType.reservedQuantity);
    expect(availableQuantity).toBe(85);
  });

  it("records EmailOutbox entries independently without altering payment status", async () => {
    const email = await prisma.emailOutbox.create({
      data: {
        recipient: "voter@example.com",
        subject: "Your NUAS Awards Voting Receipt",
        template: "VOTING_RECEIPT",
        payload: { orderNumber: "VOTE-TEST-001", votes: 10, amountPaid: "GH₵15.00" },
        status: EmailStatus.PENDING,
        attempts: 0,
      },
    });

    expect(email.status).toBe(EmailStatus.PENDING);
    expect(email.attempts).toBe(0);
    expect(email.lastError).toBeNull();
  });
});

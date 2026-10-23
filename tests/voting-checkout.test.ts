import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStatus, OrderStatus, PaymentProvider, LatePaymentPolicy, EmailStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createVotingOrder,
  getVotingOrderByNumber,
  maskPhoneNumber,
  maskEmail,
  VotingServiceError,
} from "../src/lib/voting/order-service";
import {
  confirmVotingPayment,
  SandboxMockPaymentGateway,
} from "../src/lib/voting/payment-adapter";
import { checkoutRequestSchema } from "../src/lib/voting/validation";
import { VOTE_UNIT_PRICE_PESEWAS } from "../src/lib/constants";
import { validateEnv } from "../src/lib/env";
import { processEmailOutbox, MockEmailTransport } from "../src/lib/email/outbox-service";

describe("Milestone 3 — Payment Integrity, Concurrency & Idempotency Audit", () => {
  let activeEventId: string;
  let futureEventId: string;
  let closedEventId: string;
  let draftEventId: string;

  let approvedNominee1Id: string; // Cat 1
  let approvedNominee2Id: string; // Cat 1
  let approvedNominee3Id: string; // Cat 2 (multi-category test)
  let unapprovedNomineeId: string;
  let inactiveCategoryNomineeId: string;

  beforeAll(async () => {
    // Clean up any existing records from prior test runs
    await prisma.emailOutbox.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.paymentTransaction.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.voteAllocation.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.votingOrder.deleteMany({
      where: {
        event: {
          slug: {
            in: [
              "voting-active-test-event",
              "voting-future-test-event",
              "voting-closed-test-event",
              "voting-draft-test-event",
            ],
          },
        },
      },
    });
    await prisma.nominee.deleteMany({
      where: {
        nomineeCode: {
          in: ["VOTE-TEST-NOM1", "VOTE-TEST-NOM2", "VOTE-TEST-NOM3", "VOTE-TEST-UNAPP", "VOTE-TEST-INACT"],
        },
      },
    });
    await prisma.category.deleteMany({
      where: {
        title: {
          in: [
            "[VOTE TEST] Academic Excellence",
            "[VOTE TEST] Student Leadership",
            "[VOTE TEST] Inactive Category",
          ],
        },
      },
    });
    await prisma.event.deleteMany({
      where: {
        slug: {
          in: [
            "voting-active-test-event",
            "voting-future-test-event",
            "voting-closed-test-event",
            "voting-draft-test-event",
          ],
        },
      },
    });

    // 1. Create Active Published Event (voting currently open)
    const activeEvent = await prisma.event.create({
      data: {
        slug: "voting-active-test-event",
        title: "Active Voting Test Gala",
        theme: "Tested & Verified",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-20T23:59:59Z"),
        status: EventStatus.PUBLISHED,
        latePaymentGraceMinutes: 0,
        latePaymentPolicy: LatePaymentPolicy.MANUAL_QUARANTINE,
      },
    });
    activeEventId = activeEvent.id;

    // 2. Create Future Event (voting not started yet)
    const futureEvent = await prisma.event.create({
      data: {
        slug: "voting-future-test-event",
        title: "Future Voting Gala",
        theme: "Upcoming",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-10T00:00:00Z"),
        votingEndDate: new Date("2026-11-20T23:59:59Z"),
        status: EventStatus.PUBLISHED,
      },
    });
    futureEventId = futureEvent.id;

    // 3. Create Closed Event (voting has ended)
    const closedEvent = await prisma.event.create({
      data: {
        slug: "voting-closed-test-event",
        title: "Closed Voting Gala",
        theme: "Concluded",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-09-01T00:00:00Z"),
        votingEndDate: new Date("2026-10-01T00:00:00Z"),
        status: EventStatus.PUBLISHED,
        latePaymentGraceMinutes: 0,
        latePaymentPolicy: LatePaymentPolicy.MANUAL_QUARANTINE,
      },
    });
    closedEventId = closedEvent.id;

    // 4. Create Draft Event (not published)
    const draftEvent = await prisma.event.create({
      data: {
        slug: "voting-draft-test-event",
        title: "Draft Voting Gala",
        theme: "Drafting",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-20T23:59:59Z"),
        status: EventStatus.DRAFT,
      },
    });
    draftEventId = draftEvent.id;

    // Create Categories under Active Event
    const cat1 = await prisma.category.create({
      data: {
        eventId: activeEventId,
        title: "[VOTE TEST] Academic Excellence",
        displayOrder: 1,
        isActive: true,
        isApproved: true,
      },
    });

    const cat2 = await prisma.category.create({
      data: {
        eventId: activeEventId,
        title: "[VOTE TEST] Student Leadership",
        displayOrder: 2,
        isActive: true,
        isApproved: true,
      },
    });

    const catInactive = await prisma.category.create({
      data: {
        eventId: activeEventId,
        title: "[VOTE TEST] Inactive Category",
        isActive: false, // Inactive category
        isApproved: true,
      },
    });

    // Create Nominees
    const nom1 = await prisma.nominee.create({
      data: {
        categoryId: cat1.id,
        nomineeCode: "VOTE-TEST-NOM1",
        name: "Alice Mensah",
        verifiedVotes: 10,
        isActive: true,
        isApproved: true,
      },
    });
    approvedNominee1Id = nom1.id;

    const nom2 = await prisma.nominee.create({
      data: {
        categoryId: cat1.id,
        nomineeCode: "VOTE-TEST-NOM2",
        name: "Barnabas Osei",
        verifiedVotes: 0,
        isActive: true,
        isApproved: true,
      },
    });
    approvedNominee2Id = nom2.id;

    const nom3 = await prisma.nominee.create({
      data: {
        categoryId: cat2.id,
        nomineeCode: "VOTE-TEST-NOM3",
        name: "Clement Agyeman",
        verifiedVotes: 5,
        isActive: true,
        isApproved: true,
      },
    });
    approvedNominee3Id = nom3.id;

    const unappNom = await prisma.nominee.create({
      data: {
        categoryId: cat1.id,
        nomineeCode: "VOTE-TEST-UNAPP",
        name: "Unapproved Candidate",
        verifiedVotes: 0,
        isActive: true,
        isApproved: false, // NOT APPROVED
      },
    });
    unapprovedNomineeId = unappNom.id;

    const inactNom = await prisma.nominee.create({
      data: {
        categoryId: catInactive.id,
        nomineeCode: "VOTE-TEST-INACT",
        name: "Inactive Category Candidate",
        verifiedVotes: 0,
        isActive: true,
        isApproved: true,
      },
    });
    inactiveCategoryNomineeId = inactNom.id;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.emailOutbox.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.paymentTransaction.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.voteAllocation.deleteMany({
      where: {
        votingOrder: {
          event: {
            slug: {
              in: [
                "voting-active-test-event",
                "voting-future-test-event",
                "voting-closed-test-event",
                "voting-draft-test-event",
              ],
            },
          },
        },
      },
    });
    await prisma.votingOrder.deleteMany({
      where: {
        event: {
          slug: {
            in: [
              "voting-active-test-event",
              "voting-future-test-event",
              "voting-closed-test-event",
              "voting-draft-test-event",
            ],
          },
        },
      },
    });
    await prisma.nominee.deleteMany({
      where: {
        nomineeCode: {
          in: ["VOTE-TEST-NOM1", "VOTE-TEST-NOM2", "VOTE-TEST-NOM3", "VOTE-TEST-UNAPP", "VOTE-TEST-INACT"],
        },
      },
    });
    await prisma.category.deleteMany({
      where: {
        title: {
          in: [
            "[VOTE TEST] Academic Excellence",
            "[VOTE TEST] Student Leadership",
            "[VOTE TEST] Inactive Category",
          ],
        },
      },
    });
    await prisma.event.deleteMany({
      where: {
        slug: {
          in: [
            "voting-active-test-event",
            "voting-future-test-event",
            "voting-closed-test-event",
            "voting-draft-test-event",
          ],
        },
      },
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 1: SCHEMA VALIDATION & PRICING
  // ----------------------------------------------------
  describe("Zod Validation & Server-Side Pricing Rules", () => {
    it("validates that a valid Ghana phone number and valid email are required", () => {
      const validPayload = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "voter@nuasknust.org",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 5 }],
      };
      const result = checkoutRequestSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("rejects when voterEmail is missing or malformed", () => {
      const missingEmail = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 5 }],
      };
      expect(checkoutRequestSchema.safeParse(missingEmail).success).toBe(false);

      const invalidEmail = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "not-an-email",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 5 }],
      };
      expect(checkoutRequestSchema.safeParse(invalidEmail).success).toBe(false);
    });

    it("rejects non-Ghanaian or invalid phone numbers", () => {
      const invalidPhone = {
        eventId: "test-event-id",
        voterPhone: "12345",
        voterEmail: "voter@nuasknust.org",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 5 }],
      };
      expect(checkoutRequestSchema.safeParse(invalidPhone).success).toBe(false);
    });

    it("rejects empty allocations array or non-positive vote numbers", () => {
      const emptyAllocations = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "voter@nuasknust.org",
        allocations: [],
      };
      expect(checkoutRequestSchema.safeParse(emptyAllocations).success).toBe(false);

      const zeroVotes = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "voter@nuasknust.org",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 0 }],
      };
      expect(checkoutRequestSchema.safeParse(zeroVotes).success).toBe(false);

      const negativeVotes = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "voter@nuasknust.org",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: -3 }],
      };
      expect(checkoutRequestSchema.safeParse(negativeVotes).success).toBe(false);

      const fractionalVotes = {
        eventId: "test-event-id",
        voterPhone: "0241234567",
        voterEmail: "voter@nuasknust.org",
        allocations: [{ nomineeId: "nom-1", numberOfVotes: 2.5 }],
      };
      expect(checkoutRequestSchema.safeParse(fractionalVotes).success).toBe(false);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 2: MULTI-CATEGORY CART & ORDER CREATION
  // ----------------------------------------------------
  describe("Multi-Category Cart Ordering & Server-Calculated Totals", () => {
    it("creates a multi-category voting order with accurate server-side integer pricing in pesewas", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "alice@nuasknust.org",
        allocations: [
          { nomineeId: approvedNominee1Id, numberOfVotes: 3 }, // 3 * 150 = 450 pesewas
          { nomineeId: approvedNominee3Id, numberOfVotes: 5 }, // 5 * 150 = 750 pesewas
        ],
      });

      expect(order.orderNumber).toMatch(/^VOTE-\d{6}-[A-Z0-9]+$/);
      expect(order.totalVotes).toBe(8);
      expect(order.unitPriceInPesewas).toBe(VOTE_UNIT_PRICE_PESEWAS);
      expect(order.totalAmountInPesewas).toBe(1200); // 12.00 GHS
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.allocations).toHaveLength(2);
      expect(order.maskedPhone).toBe("024****567");
      expect(order.voterEmail).toBe("a****e@nuasknust.org");

      // Verify records in PostgreSQL
      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { allocations: true },
      });
      expect(dbOrder.totalAmountInPesewas).toBe(1200);
      expect(dbOrder.allocations).toHaveLength(2);
    });

    it("rejects duplicate allocations for the same nominee in one checkout", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [
            { nomineeId: approvedNominee1Id, numberOfVotes: 2 },
            { nomineeId: approvedNominee1Id, numberOfVotes: 3 }, // Duplicate nomineeId
          ],
        })
      ).rejects.toThrow(/Duplicate nominee allocations detected/);
    });

    it("rejects voting for an unapproved nominee", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: unapprovedNomineeId, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/is not approved or active/);
    });

    it("rejects voting for a nominee in an inactive category", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: inactiveCategoryNomineeId, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/is not approved or active/);
    });

    it("rejects voting on a DRAFT event", async () => {
      await expect(
        createVotingOrder({
          eventId: draftEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/event is not published/);
    });

    it("rejects voting before the official votingStartDate", async () => {
      await expect(
        createVotingOrder({
          eventId: futureEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/Voting has not opened yet/);
    });

    it("rejects voting after the official votingEndDate", async () => {
      await expect(
        createVotingOrder({
          eventId: closedEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/voting for this event has closed/);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 3: IDEMPOTENCY KEY CORRECTNESS & CONFLICTS
  // ----------------------------------------------------
  describe("Idempotency-Key Correctness & Payload Conflict Defense", () => {
    it("returns original order when retrying with identical key and identical logical payload", async () => {
      const idempotencyKey = "IDEMPOTENT-CHECKOUT-KEY-IDENTICAL";

      const order1 = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112233",
        voterEmail: "idem@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 8 }],
        idempotencyKey,
      });

      const order2 = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112233",
        voterEmail: "idem@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 8 }],
        idempotencyKey,
      });

      expect(order1.orderNumber).toBe(order2.orderNumber);
      expect(order1.totalAmountInPesewas).toBe(order2.totalAmountInPesewas);
      expect(order2.totalVotes).toBe(8);
    });

    it("rejects with HTTP 409 Conflict when reusing an idempotency key with conflicting allocations", async () => {
      const idempotencyKey = "IDEMPOTENT-CONFLICT-KEY-1";

      await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112233",
        voterEmail: "voterA@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        idempotencyKey,
      });

      // Different allocations with same idempotencyKey
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241112233",
          voterEmail: "voterA@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 10 }], // Different vote count!
          idempotencyKey,
        })
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof VotingServiceError &&
          err.statusCode === 409 &&
          err.message.includes("idempotency key has already been used for an order with different details")
        );
      });
    });

    it("rejects with HTTP 409 Conflict when reusing an idempotency key with different voter details", async () => {
      const idempotencyKey = "IDEMPOTENT-CONFLICT-KEY-2";

      await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112233",
        voterEmail: "voterA@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        idempotencyKey,
      });

      // Different phone number with same idempotencyKey
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0559998877", // Different phone!
          voterEmail: "voterA@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
          idempotencyKey,
        })
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof VotingServiceError &&
          err.statusCode === 409
        );
      });
    });

    it("handles concurrent checkout requests with the same idempotency key safely without duplicate rows", async () => {
      const idempotencyKey = `CONCURRENT-KEY-${Date.now()}`;

      const [orderA, orderB] = await Promise.all([
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0248887766",
          voterEmail: "concurrent@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 6 }],
          idempotencyKey,
        }),
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0248887766",
          voterEmail: "concurrent@nuasknust.org",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 6 }],
          idempotencyKey,
        }),
      ]);

      expect(orderA.orderNumber).toBe(orderB.orderNumber);

      // Verify in DB that only 1 record exists
      const dbCount = await prisma.votingOrder.count({
        where: { idempotencyKey },
      });
      expect(dbCount).toBe(1);
    });

    it("retrieves order by number with masked phone and masked email for privacy", async () => {
      const created = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0509998877",
        voterEmail: "confidential.voter@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 4 }],
      });

      const retrieved = await getVotingOrderByNumber(created.orderNumber);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.orderNumber).toBe(created.orderNumber);
      expect(retrieved?.maskedPhone).toBe("050****877");
      expect(retrieved?.voterEmail).toBe("c****r@nuasknust.org");
      expect(retrieved?.maskedPhone).not.toContain("99988");
      expect(retrieved?.voterEmail).not.toContain("confidential");
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 4: CONCURRENT PAYMENT CONFIRMATION & SETTLEMENT
  // ----------------------------------------------------
  describe("Concurrent Payment Confirmation & Settlement Controls", () => {
    it("guarantees votes are credited exactly once when two simultaneous confirmations race on the same order", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0243334455",
        voterEmail: "race.test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 10 }],
      });

      // Trigger two simultaneous confirmations racing concurrently in PostgreSQL
      const [res1, res2] = await Promise.all([
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: order.totalAmountInPesewas,
          currency: "GHS",
        }),
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: order.totalAmountInPesewas,
          currency: "GHS",
        }),
      ]);

      expect(res1.status).toBe(OrderStatus.PAID);
      expect(res2.status).toBe(OrderStatus.PAID);

      // Verify votes incremented by EXACTLY 10, never 20!
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(initialVotes + 10);
    });

    it("demonstrates clean transaction rollback if an error occurs during settlement", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee1Id },
      });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0247771122",
        voterEmail: "rollback.tester@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 7 }],
      });

      // Execute a transactional block that claims order but simulates failure before committing
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.votingOrder.updateMany({
            where: { id: order.id, status: OrderStatus.PENDING },
            data: { status: OrderStatus.PAID, paidAt: new Date() },
          });

          await tx.nominee.update({
            where: { id: approvedNominee1Id },
            data: { verifiedVotes: { increment: 7 } },
          });

          throw new Error("Simulated transient database error inside settlement transaction");
        })
      ).rejects.toThrow("Simulated transient database error inside settlement transaction");

      // Verify ACID rollback in PostgreSQL:
      // 1. Order status must still be PENDING!
      const orderAfter = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(orderAfter.status).toBe(OrderStatus.PENDING);
      expect(orderAfter.paidAt).toBeNull();

      // 2. Nominee votes must NOT have incremented!
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee1Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(initialVotes);

      // 3. No PaymentTransaction or EmailOutbox records exist!
      const txCount = await prisma.paymentTransaction.count({
        where: { votingOrderId: order.id },
      });
      expect(txCount).toBe(0);

      const emailCount = await prisma.emailOutbox.count({
        where: { votingOrderId: order.id },
      });
      expect(emailCount).toBe(0);
    });

    it("rejects payment confirmation when payment amount does not match order total", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241110000",
        voterEmail: "mismatch@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 10 }], // 1500 pesewas
      });

      // Attempt to confirm with 1000 pesewas instead of 1500
      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: 1000,
        })
      ).rejects.toThrow(/amount mismatch/i);

      // Order should be moved to QUARANTINED
      const quarantinedOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(quarantinedOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(quarantinedOrder.quarantineReason).toContain("Amount mismatch");
    });

    it("rejects payment confirmation when currency is not GHS", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241110000",
        voterEmail: "currency@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 2 }],
      });

      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: order.totalAmountInPesewas,
          currency: "USD",
        })
      ).rejects.toThrow(/Unsupported currency/);
    });

    it("rejects duplicate settlement using an already-consumed gatewayReference", async () => {
      const sharedRef = `GATEWAY-DUP-REF-${Date.now()}`;

      const orderA = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112222",
        voterEmail: "orderA@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 3 }],
      });

      const orderB = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0243334444",
        voterEmail: "orderB@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 3 }],
      });

      // Confirm Order A with sharedRef
      const resA = await confirmVotingPayment({
        orderNumber: orderA.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: orderA.totalAmountInPesewas,
        currency: "GHS",
        gatewayReference: sharedRef,
      });
      expect(resA.status).toBe(OrderStatus.PAID);

      // Attempt to confirm Order B with the EXACT SAME gatewayReference -> must fail DB unique constraint!
      await expect(
        confirmVotingPayment({
          orderNumber: orderB.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: orderB.totalAmountInPesewas,
          currency: "GHS",
          gatewayReference: sharedRef,
        })
      ).rejects.toThrow();
    });

    it("handles conflicting confirmations: late SUCCESS arriving after FAILED moves to QUARANTINED without blind vote crediting", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee3Id },
      });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0245551122",
        voterEmail: "late-success@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 5 }],
      });

      // 1. Initial Failure
      const failRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "FAILED",
      });
      expect(failRes.status).toBe(OrderStatus.FAILED);

      // 2. Late Success arrives
      const lateSuccessRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(lateSuccessRes.status).toBe(OrderStatus.QUARANTINED);

      // Votes MUST NOT be incremented!
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee3Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(initialVotes);
    });

    it("handles conflicting confirmations: subsequent FAILED outcome ignored when order is already settled as PAID", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee1Id },
      });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0246662233",
        voterEmail: "paid-then-failed@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 4 }],
      });

      // 1. Successful confirmation
      const paidRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });
      expect(paidRes.status).toBe(OrderStatus.PAID);

      // 2. Subsequent failure notification (ignored)
      const subsequentFail = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "FAILED",
      });
      expect(subsequentFail.status).toBe(OrderStatus.PAID);

      // Nominee votes remain credited
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee1Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(initialVotes + 4);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 5: STRICT DEADLINE POLICY (NO GRACE PERIOD) & BOUNDARIES
  // ----------------------------------------------------
  describe("Voting Deadline Policy (NO GRACE PERIOD) & Timing Boundaries", () => {
    // Uses activeEvent's configured votingEndDate (2026-11-20T23:59:59Z)
    const deadlineTimestamp = new Date("2026-11-20T23:59:59.000Z");

    it("credits votes when confirmed immediately before closing deadline (T - 1s)", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241113333",
        voterEmail: "before-deadline@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 3 }],
      });

      const beforeDeadline = new Date(deadlineTimestamp.getTime() - 1000); // 23:59:58.000Z
      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: beforeDeadline,
      });

      expect(res.status).toBe(OrderStatus.PAID);
      expect(res.success).toBe(true);

      const nom = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      expect(nom.verifiedVotes).toBe(initialVotes + 3);
    });

    it("credits votes when confirmed exactly at the deadline (T = 0s)", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241113333",
        voterEmail: "exact-deadline@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 2 }],
      });

      const exactDeadline = new Date(deadlineTimestamp.getTime()); // 23:59:59.000Z
      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: exactDeadline,
      });

      expect(res.status).toBe(OrderStatus.PAID);
      expect(res.success).toBe(true);

      const nom = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      expect(nom.verifiedVotes).toBe(initialVotes + 2);
    });

    it("quarantines payment and refuses vote credits when confirmed immediately after closing deadline (T + 1s, zero grace period)", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241113333",
        voterEmail: "after-deadline@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 4 }],
      });

      const afterDeadline = new Date(deadlineTimestamp.getTime() + 1000); // 00:00:00.000Z (next second)
      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: afterDeadline,
      });

      expect(res.status).toBe(OrderStatus.QUARANTINED);
      expect(res.success).toBe(false);
      expect(res.message).toContain("Voting deadline closed");

      // Nominee votes must NOT be incremented!
      const nom = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      expect(nom.verifiedVotes).toBe(initialVotes); // Unchanged!

      // Payment transaction preserved for financial audit
      const tx = await prisma.paymentTransaction.findFirstOrThrow({
        where: { votingOrderId: order.id },
      });
      expect(tx.status).toBe(OrderStatus.QUARANTINED);
    });

    it("quarantines payment when confirmed substantially after closing deadline (T + 24 hours)", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241113333",
        voterEmail: "way-after-deadline@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 10 }],
      });

      const wayAfter = new Date(deadlineTimestamp.getTime() + 24 * 60 * 60 * 1000); // 24 hours later
      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: wayAfter,
      });

      expect(res.status).toBe(OrderStatus.QUARANTINED);
      expect(res.success).toBe(false);

      const nom = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee3Id } });
      expect(nom.verifiedVotes).toBe(initialVotes); // Still unchanged!
    });

    it("handles delayed and duplicate callbacks on quarantined orders safely without duplicate transactions", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241113333",
        voterEmail: "dup-quarantine@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 1 }],
      });

      const postDeadline = new Date(deadlineTimestamp.getTime() + 5000);

      // First confirmation
      const res1 = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: postDeadline,
      });
      expect(res1.status).toBe(OrderStatus.QUARANTINED);

      // Duplicate callback
      const res2 = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        confirmationTimestamp: postDeadline,
      });
      expect(res2.status).toBe(OrderStatus.QUARANTINED);

      // Exactly 1 payment transaction exists
      const txCount = await prisma.paymentTransaction.count({
        where: { votingOrderId: order.id },
      });
      expect(txCount).toBe(1);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 6: NOMINEE, CATEGORY & EVENT ELIGIBILITY AT SETTLEMENT
  // ----------------------------------------------------
  describe("Interim Eligibility Re-Validation at Settlement Time", () => {
    it("quarantines payment if a nominee was unapproved after checkout creation", async () => {
      const tempNominee = await prisma.nominee.create({
        data: {
          categoryId: (await prisma.category.findFirstOrThrow({ where: { eventId: activeEventId } })).id,
          nomineeCode: `DISQ-NOM-${Date.now()}`,
          name: "Soon Disqualified",
          verifiedVotes: 0,
          isActive: true,
          isApproved: true,
        },
      });

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0249998811",
        voterEmail: "disqual@nuasknust.org",
        allocations: [{ nomineeId: tempNominee.id, numberOfVotes: 5 }],
      });

      // Disqualify nominee in DB
      await prisma.nominee.update({
        where: { id: tempNominee.id },
        data: { isApproved: false },
      });

      // Attempt payment confirmation -> Quarantined cleanly!
      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(res.status).toBe(OrderStatus.QUARANTINED);
      expect(res.success).toBe(false);
      expect(res.message).toContain("no longer eligible");

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
      expect(dbOrder.quarantineReason).toContain("became unapproved or inactive");

      // Verify nominee votes were NOT incremented
      const nomAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: tempNominee.id } });
      expect(nomAfter.verifiedVotes).toBe(0);

      // Clean up temp nominee
      await prisma.voteAllocation.deleteMany({ where: { nomineeId: tempNominee.id } });
      await prisma.nominee.delete({ where: { id: tempNominee.id } });
    });

    it("quarantines payment if a category was deactivated after checkout creation", async () => {
      const tempCat = await prisma.category.create({
        data: {
          eventId: activeEventId,
          title: `Interim Cat ${Date.now()}`,
          isActive: true,
          isApproved: true,
        },
      });

      const tempNom = await prisma.nominee.create({
        data: {
          categoryId: tempCat.id,
          nomineeCode: `INTERIM-NOM-${Date.now()}`,
          name: "Interim Nominee",
          isActive: true,
          isApproved: true,
          verifiedVotes: 0,
        },
      });

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0248889900",
        voterEmail: "cat-disqual@nuasknust.org",
        allocations: [{ nomineeId: tempNom.id, numberOfVotes: 3 }],
      });

      // Deactivate category in DB
      await prisma.category.update({
        where: { id: tempCat.id },
        data: { isActive: false },
      });

      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(res.status).toBe(OrderStatus.QUARANTINED);
      expect(res.success).toBe(false);

      const nomAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: tempNom.id } });
      expect(nomAfter.verifiedVotes).toBe(0);

      // Cleanup
      await prisma.voteAllocation.deleteMany({ where: { nomineeId: tempNom.id } });
      await prisma.nominee.delete({ where: { id: tempNom.id } });
      await prisma.category.delete({ where: { id: tempCat.id } });
    });

    it("quarantines payment if the event was unpublished after checkout creation", async () => {
      const tempEvent = await prisma.event.create({
        data: {
          slug: `unpub-event-${Date.now()}`,
          title: "Unpublishing Event",
          venue: "Great Hall",
          eventDate: new Date("2026-11-21T18:00:00Z"),
          votingStartDate: new Date("2026-10-01T00:00:00Z"),
          votingEndDate: new Date("2026-11-20T23:59:59Z"),
          status: EventStatus.PUBLISHED,
        },
      });

      const tempCat = await prisma.category.create({
        data: { eventId: tempEvent.id, title: "Unpub Cat", isActive: true, isApproved: true },
      });

      const tempNom = await prisma.nominee.create({
        data: {
          categoryId: tempCat.id,
          nomineeCode: `UNPUB-NOM-${Date.now()}`,
          name: "Unpub Nom",
          isActive: true,
          isApproved: true,
          verifiedVotes: 0,
        },
      });

      const order = await createVotingOrder({
        eventId: tempEvent.id,
        voterPhone: "0245556677",
        voterEmail: "event-unpub@nuasknust.org",
        allocations: [{ nomineeId: tempNom.id, numberOfVotes: 2 }],
      });

      // Change event status to VOTING_CLOSED
      await prisma.event.update({
        where: { id: tempEvent.id },
        data: { status: EventStatus.VOTING_CLOSED },
      });

      const res = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(res.status).toBe(OrderStatus.QUARANTINED);
      expect(res.success).toBe(false);

      const nomAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: tempNom.id } });
      expect(nomAfter.verifiedVotes).toBe(0);

      // Cleanup
      await prisma.paymentTransaction.deleteMany({ where: { votingOrderId: order.id } });
      await prisma.voteAllocation.deleteMany({ where: { votingOrderId: order.id } });
      await prisma.votingOrder.delete({ where: { id: order.id } });
      await prisma.nominee.delete({ where: { id: tempNom.id } });
      await prisma.category.delete({ where: { id: tempCat.id } });
      await prisma.event.delete({ where: { id: tempEvent.id } });
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 7: FAILED, EXPIRED & QUARANTINED TRANSITIONS
  // ----------------------------------------------------
  describe("FAILED, EXPIRED & QUARANTINED State Transitions", () => {
    it("handles late SUCCESS for an EXPIRED order by moving to QUARANTINED without crediting votes", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241239999",
        voterEmail: "expired-test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
      });

      // Mark order EXPIRED (simulating expired session / voter cancellation)
      const cancelRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "CANCELLED",
      });
      expect(cancelRes.status).toBe(OrderStatus.EXPIRED);

      const nomBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee1Id } });
      const votesBefore = nomBefore.verifiedVotes;

      // Late success arrives
      const lateRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(lateRes.status).toBe(OrderStatus.QUARANTINED);
      expect(lateRes.success).toBe(false);

      // Votes NOT credited
      const nomAfter = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee1Id } });
      expect(nomAfter.verifiedVotes).toBe(votesBefore);
    });

    it("prevents confirmation of already QUARANTINED orders through regular confirmation flow", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241118888",
        voterEmail: "quarantine-lock@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 3 }],
      });

      // Trigger quarantine via amount mismatch
      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
          amountInPesewas: 100, // Expected 450
        })
      ).rejects.toThrow();

      // Attempt second confirmation on quarantined order
      const retryRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      expect(retryRes.status).toBe(OrderStatus.QUARANTINED);
      expect(retryRes.success).toBe(false);
      expect(retryRes.message).toContain("quarantined for review");
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 8: PERSISTENT EMAIL OUTBOX & DECOUPLED RETRY
  // ----------------------------------------------------
  describe("Persistent Email Outbox Processing & Decoupled Atomicity", () => {
    it("asynchronously processes queued receipts and sets status to SENT", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0245550011",
        voterEmail: "outbox.delivery@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 2 }],
      });

      // Settle payment -> writes to EmailOutbox atomically inside settlement tx
      const confirmRes = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });
      expect(confirmRes.status).toBe(OrderStatus.PAID);

      const outboxItem = await prisma.emailOutbox.findFirstOrThrow({
        where: { votingOrderId: order.id },
      });
      expect(outboxItem.status).toBe(EmailStatus.PENDING);
      expect(outboxItem.recipient).toBe("outbox.delivery@nuasknust.org");

      // Process outbox with mock transport
      const transport = new MockEmailTransport();
      const summary = await processEmailOutbox({ transport });

      expect(summary.sent).toBeGreaterThanOrEqual(1);

      const updatedItem = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outboxItem.id },
      });
      expect(updatedItem.status).toBe(EmailStatus.SENT);
      expect(updatedItem.sentAt).not.toBeNull();
      expect(updatedItem.attempts).toBe(1);
    });

    it("retries transient email delivery failures without reversing paid orders or duplicating votes", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee2Id } });
      const initialVotes = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0245550022",
        voterEmail: "transient.failure@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 3 }],
      });

      await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
      });

      const outboxItem = await prisma.emailOutbox.findFirstOrThrow({
        where: { votingOrderId: order.id },
      });

      // Simulate 1 transient failure followed by success
      const flakyTransport = new MockEmailTransport();
      flakyTransport.failNextAttempts = 1;

      // 1. First run fails
      const run1 = await processEmailOutbox({ transport: flakyTransport });
      expect(run1.failed).toBeGreaterThanOrEqual(1);

      const itemAfterFail = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outboxItem.id },
      });
      expect(itemAfterFail.status).toBe(EmailStatus.FAILED);
      expect(itemAfterFail.attempts).toBe(1);
      expect(itemAfterFail.lastError).toContain("Simulated transient SMTP");

      // CRITICAL: Order MUST remain PAID and nominee votes MUST remain credited!
      const orderDb = await prisma.votingOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(orderDb.status).toBe(OrderStatus.PAID);

      const nomineeDb = await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee2Id } });
      expect(nomineeDb.verifiedVotes).toBe(initialVotes + 3);

      // 2. Retry run succeeds
      const run2 = await processEmailOutbox({ transport: flakyTransport });
      expect(run2.sent).toBeGreaterThanOrEqual(1);

      const itemAfterRetry = await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outboxItem.id },
      });
      expect(itemAfterRetry.status).toBe(EmailStatus.SENT);
      expect(itemAfterRetry.attempts).toBe(2);
      expect(itemAfterRetry.lastError).toBeNull();
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 9: SANDBOX ISOLATION & ENV VALIDATION
  // ----------------------------------------------------
  describe("Production Isolation of Sandbox Simulation", () => {
    it("strictly blocks sandbox payment confirmation if NODE_ENV is production", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0247778899",
        voterEmail: "prod-block@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 2 }],
      });

      const originalNodeEnv = process.env.NODE_ENV;
      const envObj = process.env as Record<string, string | undefined>;
      try {
        envObj.NODE_ENV = "production";

        await expect(
          confirmVotingPayment({
            orderNumber: order.orderNumber,
            outcome: "SUCCESS",
          })
        ).rejects.toThrow(/Sandbox payment simulation cannot be invoked in production/);
      } finally {
        envObj.NODE_ENV = originalNodeEnv;
      }
    });

    it("strictly blocks sandbox payment confirmation if ENABLE_LIVE_PAYMENTS is true", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0247778899",
        voterEmail: "live-gate@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 2 }],
      });

      const originalLive = process.env.ENABLE_LIVE_PAYMENTS;
      const envObj = process.env as Record<string, string | undefined>;
      try {
        envObj.ENABLE_LIVE_PAYMENTS = "true";

        await expect(
          confirmVotingPayment({
            orderNumber: order.orderNumber,
            outcome: "SUCCESS",
          })
        ).rejects.toThrow(/Sandbox payment simulation cannot be invoked in production or when live payments are enabled/);
      } finally {
        envObj.ENABLE_LIVE_PAYMENTS = originalLive;
      }
    });

    it("verifies environment validator rejects invalid production payment combinations", () => {
      // Production with live payments enabled but SANDBOX_MOCK provider
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://localhost:5432/test",
          SESSION_SECRET: "a-very-long-production-secret-of-32-chars!!",
          ENABLE_LIVE_PAYMENTS: "true",
          PAYMENT_PROVIDER: "SANDBOX_MOCK",
        })
      ).toThrow(/Live payments cannot be enabled with SANDBOX_MOCK payment provider in production/);

      // Live payments with Paystack but missing secret key
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://localhost:5432/test",
          SESSION_SECRET: "a-very-long-production-secret-of-32-chars!!",
          ENABLE_LIVE_PAYMENTS: "true",
          PAYMENT_PROVIDER: "PAYSTACK",
          PAYSTACK_SECRET_KEY: "",
        })
      ).toThrow(/PAYSTACK_SECRET_KEY is required/);
    });

    it("verifies phone and email masking helpers handle privacy appropriately", () => {
      expect(maskPhoneNumber("0241234567")).toBe("024****567");
      expect(maskPhoneNumber("+233241234567")).toBe("+233****4567");
      expect(maskPhoneNumber("+12025550199")).toBe("+120****0199");
      expect(maskPhoneNumber("123")).toBe("123");

      expect(maskEmail("voter@nuasknust.org")).toBe("v****r@nuasknust.org");
      expect(maskEmail("al@domain.com")).toBe("a***@domain.com");
      expect(maskEmail(null)).toBeNull();
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStatus, OrderStatus, PaymentProvider, LatePaymentPolicy } from "@prisma/client";
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
            "[VOTE TEST] Leadership Category",
            "[VOTE TEST] Ministry Category",
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
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        latePaymentGraceMinutes: 15,
        latePaymentPolicy: LatePaymentPolicy.MANUAL_QUARANTINE,
        status: EventStatus.PUBLISHED,
      },
    });
    activeEventId = activeEvent.id;

    // 2. Create Future Event (voting not yet open)
    const futureEvent = await prisma.event.create({
      data: {
        slug: "voting-future-test-event",
        title: "Future Voting Test Gala",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-10T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });
    futureEventId = futureEvent.id;

    // 3. Create Closed Event (voting deadline ended)
    const closedEvent = await prisma.event.create({
      data: {
        slug: "voting-closed-test-event",
        title: "Closed Voting Test Gala",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-09-01T00:00:00Z"),
        votingEndDate: new Date("2026-10-01T00:00:00Z"),
        latePaymentGraceMinutes: 15,
        latePaymentPolicy: LatePaymentPolicy.MANUAL_QUARANTINE,
        status: EventStatus.PUBLISHED,
      },
    });
    closedEventId = closedEvent.id;

    // 4. Create Draft Event
    const draftEvent = await prisma.event.create({
      data: {
        slug: "voting-draft-test-event",
        title: "Draft Event Test Gala",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-10-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.DRAFT,
      },
    });
    draftEventId = draftEvent.id;

    // Create Categories under Active Event
    const cat1 = await prisma.category.create({
      data: {
        eventId: activeEventId,
        title: "[VOTE TEST] Leadership Category",
        isActive: true,
        isApproved: true,
      },
    });

    const cat2 = await prisma.category.create({
      data: {
        eventId: activeEventId,
        title: "[VOTE TEST] Ministry Category",
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

    const inactCatNom = await prisma.nominee.create({
      data: {
        categoryId: catInactive.id,
        nomineeCode: "VOTE-TEST-INACT",
        name: "Inactive Category Candidate",
        verifiedVotes: 0,
        isActive: true,
        isApproved: true,
      },
    });
    inactiveCategoryNomineeId = inactCatNom.id;
  });

  afterAll(async () => {
    // Clean up all voting test records
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
            "[VOTE TEST] Leadership Category",
            "[VOTE TEST] Ministry Category",
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
  // TEST GROUP 1: SERVER-SIDE PRICING & ALLOCATIONS
  // ----------------------------------------------------
  describe("Server-Side Integer Pricing & Multi-Category Allocations", () => {
    it("creates a single-nominee order with exact integer pesewas calculation", async () => {
      const votes = 10;
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "voter1@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: votes }],
      });

      expect(order.orderNumber).toMatch(/^VOTE-\d{6}-[A-F0-9]{8}$/);
      expect(order.totalVotes).toBe(10);
      expect(order.unitPriceInPesewas).toBe(VOTE_UNIT_PRICE_PESEWAS);
      expect(order.unitPriceInPesewas).toBe(150);
      expect(order.totalAmountInPesewas).toBe(1500); // 10 * 150 = 1500 pesewas (GH₵15.00)
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.allocations).toHaveLength(1);
      expect(order.allocations[0].nomineeId).toBe(approvedNominee1Id);
      expect(order.allocations[0].numberOfVotes).toBe(10);
      expect(order.allocations[0].subtotalInPesewas).toBe(1500);
      expect(order.maskedPhone).toBe("024****567");
    });

    it("creates a multi-category voting order allocating votes across distinct award categories", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "+233559876543",
        voterEmail: "multicategory@nuasknust.org",
        allocations: [
          { nomineeId: approvedNominee1Id, numberOfVotes: 5 },
          { nomineeId: approvedNominee3Id, numberOfVotes: 20 },
        ],
      });

      expect(order.totalVotes).toBe(25);
      expect(order.totalAmountInPesewas).toBe(3750); // 25 * 150 = 3750 pesewas (GH₵37.50)
      expect(order.allocations).toHaveLength(2);

      const alloc1 = order.allocations.find((a) => a.nomineeId === approvedNominee1Id);
      const alloc2 = order.allocations.find((a) => a.nomineeId === approvedNominee3Id);

      expect(alloc1?.numberOfVotes).toBe(5);
      expect(alloc1?.subtotalInPesewas).toBe(750);
      expect(alloc2?.numberOfVotes).toBe(20);
      expect(alloc2?.subtotalInPesewas).toBe(3000);
      expect(order.maskedPhone).toBe("+233****6543");
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 2: VALIDATION, REQUIRED EMAIL & APPROVAL GATING
  // ----------------------------------------------------
  describe("Input Validation, Required Email & Approval State Gating", () => {
    it("rejects checkout when email is missing or malformed", () => {
      const missingEmail = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
      });
      expect(missingEmail.success).toBe(false);

      const invalidEmail = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "not-an-email",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
      });
      expect(invalidEmail.success).toBe(false);
    });

    it("rejects non-positive and fractional vote quantities via Zod validation", () => {
      const negativeResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: -5 }],
      });
      expect(negativeResult.success).toBe(false);

      const zeroResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 0 }],
      });
      expect(zeroResult.success).toBe(false);

      const floatResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        voterEmail: "test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 3.5 }],
      });
      expect(floatResult.success).toBe(false);
    });

    it("rejects duplicate allocations for the same nominee in one checkout", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [
            { nomineeId: approvedNominee1Id, numberOfVotes: 5 },
            { nomineeId: approvedNominee1Id, numberOfVotes: 10 },
          ],
        })
      ).rejects.toThrow(/Duplicate nominee allocations detected/);
    });

    it("rejects checkout when a nominee is not approved", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          voterEmail: "test@nuasknust.org",
          allocations: [{ nomineeId: unapprovedNomineeId, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/is not approved or active/);
    });

    it("rejects checkout when category is inactive", async () => {
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
        }),
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
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
        gatewayReference: sharedRef,
      });
      expect(resA.status).toBe(OrderStatus.PAID);

      // Attempt to confirm Order B with the EXACT SAME gatewayReference -> must fail DB unique constraint!
      await expect(
        confirmVotingPayment({
          orderNumber: orderB.orderNumber,
          outcome: "SUCCESS",
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
  // TEST GROUP 5: DEADLINE POLICY & NOMINEE DISQUALIFICATION
  // ----------------------------------------------------
  describe("Voting Deadline Policy and Interim Nominee Eligibility", () => {
    it("quarantines payment when confirmed past the late payment grace period", async () => {
      // Order created under closedEvent
      // Note: closedEvent has votingEndDate = 2026-10-01 (more than 15 days ago)
      // Let's create an order directly in DB with status PENDING for closedEvent
      const lateOrder = await prisma.votingOrder.create({
        data: {
          orderNumber: "VOTE-LATE-DEADLINE-TEST-001",
          eventId: closedEventId,
          voterPhone: "0240009988",
          voterEmail: "late@nuasknust.org",
          totalVotes: 5,
          unitPriceInPesewas: 150,
          totalAmountInPesewas: 750,
          status: OrderStatus.PENDING,
          allocations: {
            create: [
              {
                nomineeId: approvedNominee1Id,
                numberOfVotes: 5,
                subtotalInPesewas: 750,
              },
            ],
          },
        },
      });

      await expect(
        confirmVotingPayment({
          orderNumber: lateOrder.orderNumber,
          outcome: "SUCCESS",
        })
      ).rejects.toThrow(/grace window has expired/);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: lateOrder.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);
    });

    it("quarantines payment if a nominee was unapproved after checkout creation", async () => {
      // Create a temporary nominee that is active and approved
      const tempNominee = await prisma.nominee.create({
        data: {
          categoryId: (await prisma.category.findFirstOrThrow({ where: { eventId: activeEventId } })).id,
          nomineeCode: "VOTE-DISQUALIFIED-NOM",
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

      // Attempt payment confirmation
      await expect(
        confirmVotingPayment({
          orderNumber: order.orderNumber,
          outcome: "SUCCESS",
        })
      ).rejects.toThrow(/no longer eligible to receive votes/);

      const dbOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe(OrderStatus.QUARANTINED);

      // Clean up temp nominee
      await prisma.voteAllocation.deleteMany({ where: { nomineeId: tempNominee.id } });
      await prisma.nominee.delete({ where: { id: tempNominee.id } });
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 6: SANDBOX ISOLATION & ENV VALIDATION
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

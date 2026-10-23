import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStatus, OrderStatus, PaymentProvider } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createVotingOrder,
  getVotingOrderByNumber,
  maskPhoneNumber,
  VotingServiceError,
} from "../src/lib/voting/order-service";
import {
  confirmVotingPayment,
  SandboxMockPaymentGateway,
} from "../src/lib/voting/payment-adapter";
import { checkoutRequestSchema } from "../src/lib/voting/validation";
import { VOTE_UNIT_PRICE_PESEWAS } from "../src/lib/constants";

describe("Milestone 3 — Multi-Category Voting Cart & Checkout Flow", () => {
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

    // 3. Create Closed Event (voting has ended)
    const closedEvent = await prisma.event.create({
      data: {
        slug: "voting-closed-test-event",
        title: "Closed Voting Test Gala",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-09-01T00:00:00Z"),
        votingEndDate: new Date("2026-10-01T00:00:00Z"),
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
  // TEST GROUP 1: PRICING & MULTI-CATEGORY ALLOCATIONS
  // ----------------------------------------------------
  describe("Server-Side Integer Pricing & Multi-Category Allocations", () => {
    it("creates a single-nominee voting order with exact integer pesewas calculation", async () => {
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
      // 5 votes for Alice (Cat 1) + 20 votes for Clement (Cat 2)
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
  // TEST GROUP 2: VALIDATION & ELIGIBILITY ENFORCEMENT
  // ----------------------------------------------------
  describe("Input Validation and Approval State Gating", () => {
    it("rejects non-positive and fractional vote quantities via Zod validation", () => {
      const negativeResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: -5 }],
      });
      expect(negativeResult.success).toBe(false);

      const zeroResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 0 }],
      });
      expect(zeroResult.success).toBe(false);

      const floatResult = checkoutRequestSchema.safeParse({
        eventId: activeEventId,
        voterPhone: "0241234567",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 3.5 }],
      });
      expect(floatResult.success).toBe(false);
    });

    it("rejects duplicate allocations for the same nominee in one checkout", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
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
          allocations: [{ nomineeId: unapprovedNomineeId, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/is not approved or active/);
    });

    it("rejects checkout when category is inactive", async () => {
      await expect(
        createVotingOrder({
          eventId: activeEventId,
          voterPhone: "0241234567",
          allocations: [{ nomineeId: inactiveCategoryNomineeId, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/is not approved or active/);
    });

    it("rejects voting on a DRAFT event", async () => {
      await expect(
        createVotingOrder({
          eventId: draftEventId,
          voterPhone: "0241234567",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/event is not published/);
    });

    it("rejects voting before the official votingStartDate", async () => {
      await expect(
        createVotingOrder({
          eventId: futureEventId,
          voterPhone: "0241234567",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/Voting has not opened yet/);
    });

    it("rejects voting after the official votingEndDate", async () => {
      await expect(
        createVotingOrder({
          eventId: closedEventId,
          voterPhone: "0241234567",
          allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 5 }],
        })
      ).rejects.toThrow(/voting for this event has closed/);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 3: IDEMPOTENCY & DUPLICATE SUBMISSION DEFENSE
  // ----------------------------------------------------
  describe("Checkout Idempotency & Order Retrieval Safety", () => {
    it("returns existing order when retrying with identical idempotencyKey", async () => {
      const idempotencyKey = "IDEMPOTENT-CHECKOUT-KEY-999";

      const order1 = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241112233",
        voterEmail: "idem@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 8 }],
        idempotencyKey,
      });

      // Second identical request with same key
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

    it("retrieves order by number with masked voter phone and hides internal private data", async () => {
      const created = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0509998877",
        voterEmail: "privacy-test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 4 }],
      });

      const retrieved = await getVotingOrderByNumber(created.orderNumber);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.orderNumber).toBe(created.orderNumber);
      expect(retrieved?.maskedPhone).toBe("050****877");
      // Does not expose plaintext full phone
      expect(retrieved?.maskedPhone).not.toContain("99988");
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 4: ATOMIC PAYMENT & AUTHORITATIVE VOTE CREDITING
  // ----------------------------------------------------
  describe("Authoritative Payment Transition & Anti-Fraud Vote Crediting", () => {
    it("never credits votes upon order creation", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });
      const initialVotes = nomineeBefore.verifiedVotes;

      // Order created in PENDING state
      await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0245556677",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 15 }],
      });

      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });

      // Verified votes MUST remain unchanged
      expect(nomineeAfter.verifiedVotes).toBe(initialVotes);
    });

    it("authoritatively credits votes only upon successful payment confirmation", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });
      const votesBefore = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0245556677",
        voterEmail: "receipt-test@nuasknust.org",
        allocations: [{ nomineeId: approvedNominee2Id, numberOfVotes: 12 }],
      });

      // Authoritative payment confirmation
      const confirmResult = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
      });

      expect(confirmResult.success).toBe(true);
      expect(confirmResult.status).toBe(OrderStatus.PAID);

      // Verify nominee counter incremented authoritatively
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee2Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(votesBefore + 12);

      // Verify PaymentTransaction was recorded and bound exclusively to votingOrderId
      const transaction = await prisma.paymentTransaction.findFirst({
        where: { votingOrderId: order.id },
      });
      expect(transaction).not.toBeNull();
      expect(transaction?.orderType).toBe("VOTING");
      expect(transaction?.ticketOrderId).toBeNull();
      expect(transaction?.status).toBe(OrderStatus.PAID);

      // Verify decoupled EmailOutbox receipt was queued
      const emailRecord = await prisma.emailOutbox.findFirst({
        where: { votingOrderId: order.id },
      });
      expect(emailRecord).not.toBeNull();
      expect(emailRecord?.recipient).toBe("receipt-test@nuasknust.org");
      expect(emailRecord?.template).toBe("VOTING_RECEIPT");
    });

    it("enforces idempotency on duplicate payment confirmation (prevents double crediting)", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee1Id },
      });
      const votesBefore = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0241234567",
        allocations: [{ nomineeId: approvedNominee1Id, numberOfVotes: 7 }],
      });

      // 1st confirmation
      const firstConfirm = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
      });
      expect(firstConfirm.status).toBe(OrderStatus.PAID);

      const votesAfterFirst = (
        await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee1Id } })
      ).verifiedVotes;
      expect(votesAfterFirst).toBe(votesBefore + 7);

      // 2nd duplicate confirmation (e.g. repeated webhook or reloaded page)
      const secondConfirm = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "SUCCESS",
      });
      expect(secondConfirm.status).toBe(OrderStatus.PAID);

      const votesAfterSecond = (
        await prisma.nominee.findUniqueOrThrow({ where: { id: approvedNominee1Id } })
      ).verifiedVotes;

      // MUST NOT DOUBLE-CREDIT!
      expect(votesAfterSecond).toBe(votesAfterFirst);
    });

    it("records FAILED status without crediting votes when payment fails", async () => {
      const nomineeBefore = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee3Id },
      });
      const votesBefore = nomineeBefore.verifiedVotes;

      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0240001122",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 9 }],
      });

      const confirmResult = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "FAILED",
      });

      expect(confirmResult.success).toBe(false);
      expect(confirmResult.status).toBe(OrderStatus.FAILED);

      // Nominee votes must NOT be incremented
      const nomineeAfter = await prisma.nominee.findUniqueOrThrow({
        where: { id: approvedNominee3Id },
      });
      expect(nomineeAfter.verifiedVotes).toBe(votesBefore);

      // Order status updated
      const updatedOrder = await prisma.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updatedOrder.status).toBe(OrderStatus.FAILED);
    });

    it("records EXPIRED status when payment is cancelled by voter", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0249990011",
        allocations: [{ nomineeId: approvedNominee3Id, numberOfVotes: 3 }],
      });

      const confirmResult = await confirmVotingPayment({
        orderNumber: order.orderNumber,
        outcome: "CANCELLED",
      });

      expect(confirmResult.status).toBe(OrderStatus.EXPIRED);
    });
  });

  // ----------------------------------------------------
  // TEST GROUP 5: PRODUCTION SAFETY & SANDBOX ISOLATION
  // ----------------------------------------------------
  describe("Production Isolation of Sandbox Simulation", () => {
    it("strictly blocks sandbox payment confirmation if NODE_ENV is production", async () => {
      const order = await createVotingOrder({
        eventId: activeEventId,
        voterPhone: "0247778899",
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

    it("verifies phone masking helper handles international and local formats safely", () => {
      expect(maskPhoneNumber("0241234567")).toBe("024****567");
      expect(maskPhoneNumber("+233241234567")).toBe("+233****4567");
      expect(maskPhoneNumber("+12025550199")).toBe("+120****0199");
      expect(maskPhoneNumber("123")).toBe("123");
    });
  });
});

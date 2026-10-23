import "dotenv/config";
import { PrismaClient, EventStatus, LatePaymentPolicy } from "@prisma/client";
import { getEnv } from "../src/lib/env";

const prisma = new PrismaClient();

export async function runDevelopmentSeed() {
  const env = getEnv();
  if (env.NODE_ENV === "production") {
    throw new Error(
      "[FATAL SAFETY] Development seed script cannot run in production (NODE_ENV=production). " +
        "Mock and demo data must never be seeded into production."
    );
  }

  if (!env.ALLOW_TEST_SEEDING) {
    console.log("[seed] ALLOW_TEST_SEEDING is disabled. Skipping test data seeding.");
    return;
  }

  console.log("[seed] Seeding development demo records (Marked as DRAFT / TEST DATA)...");

  // 1. Create Draft Event (strictly DRAFT, never PUBLISHED)
  const event = await prisma.event.upsert({
    where: { slug: "demo-nuas-dinner-2026-test" },
    update: {
      status: EventStatus.DRAFT,
    },
    create: {
      slug: "demo-nuas-dinner-2026-test",
      title: "[DEMO / TEST DATA] NUAS Dinner & Awards Night (Pending Official Confirmation)",
      theme: "[TEST THEME] Celebrating Excellence (Pending Official Theme)",
      venue: "[TEST PLACEHOLDER] Venue Pending Committee Confirmation",
      eventDate: new Date("2026-11-21T18:00:00Z"),
      votingStartDate: new Date("2026-11-01T00:00:00Z"),
      votingEndDate: new Date("2026-11-21T17:00:00Z"),
      latePaymentGraceMinutes: 0,
      latePaymentPolicy: LatePaymentPolicy.MANUAL_QUARANTINE,
      status: EventStatus.DRAFT, // MUST BE DRAFT
    },
  });

  // 2. Create Demo Categories
  const category1 = await prisma.category.upsert({
    where: { id: "demo-cat-01" },
    update: {},
    create: {
      id: "demo-cat-01",
      eventId: event.id,
      title: "[TEST] Most Dedicated Executive (Demo Roster)",
      description: "Demo category for testing multi-nominee allocation cart.",
      displayOrder: 1,
      isActive: true,
    },
  });

  const category2 = await prisma.category.upsert({
    where: { id: "demo-cat-02" },
    update: {},
    create: {
      id: "demo-cat-02",
      eventId: event.id,
      title: "[TEST] Best Committee Member (Demo Roster)",
      description: "Demo category for testing cross-category checkout.",
      displayOrder: 2,
      isActive: true,
    },
  });

  // 3. Create Demo Nominees
  await prisma.nominee.upsert({
    where: { nomineeCode: "TEST-NOM-01" },
    update: {},
    create: {
      categoryId: category1.id,
      nomineeCode: "TEST-NOM-01",
      name: "[TEST] Nominee One (Demo Candidate)",
      bio: "Placeholder bio for development testing.",
      displayOrder: 1,
      verifiedVotes: 0,
      isActive: true,
    },
  });

  await prisma.nominee.upsert({
    where: { nomineeCode: "TEST-NOM-02" },
    update: {},
    create: {
      categoryId: category1.id,
      nomineeCode: "TEST-NOM-02",
      name: "[TEST] Nominee Two (Demo Candidate)",
      bio: "Placeholder bio for development testing.",
      displayOrder: 2,
      verifiedVotes: 0,
      isActive: true,
    },
  });

  await prisma.nominee.upsert({
    where: { nomineeCode: "TEST-NOM-03" },
    update: {},
    create: {
      categoryId: category2.id,
      nomineeCode: "TEST-NOM-03",
      name: "[TEST] Nominee Three (Demo Candidate)",
      bio: "Placeholder bio for development testing.",
      displayOrder: 1,
      verifiedVotes: 0,
      isActive: true,
    },
  });

  // 4. Create Demo Ticket Types (Integer Pesewas)
  await prisma.ticketType.upsert({
    where: { id: "demo-tkt-single" },
    update: {},
    create: {
      id: "demo-tkt-single",
      eventId: event.id,
      name: "[TEST] Single Ticket (Price TBD)",
      description: "Demo ticket type for reservation testing.",
      priceInPesewas: 10000, // GH₵100.00
      totalCapacity: 50,
      soldQuantity: 0,
      reservedQuantity: 0,
      salesStart: new Date("2026-10-01T00:00:00Z"),
      salesEnd: new Date("2026-11-21T17:00:00Z"),
      isActive: true,
    },
  });

  console.log("[seed] Development demo records successfully populated in DRAFT state.");
}

if (require.main === module) {
  runDevelopmentSeed()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("[seed] Seeding error:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

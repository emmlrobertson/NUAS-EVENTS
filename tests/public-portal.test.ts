import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getPublishedEvent, getApprovedNomineeByCode } from "../src/lib/public-data";

describe("Public Portal Data Access & Publishing Isolation", () => {
  let draftEventId: string;
  let publishedEventId: string;

  beforeAll(async () => {
    // Clean up test events
    await prisma.nominee.deleteMany({
      where: { nomineeCode: { in: ["PUB-NOM-01", "PUB-NOM-INACTIVE", "DRAFT-NOM-01"] } },
    });
    await prisma.category.deleteMany({
      where: { title: { in: ["[TEST] Published Category", "[TEST] Draft Category"] } },
    });
    await prisma.event.deleteMany({
      where: { slug: { in: ["test-draft-event", "test-published-event"] } },
    });

    // 1. Create a DRAFT Event
    const draftEvent = await prisma.event.create({
      data: {
        slug: "test-draft-event",
        title: "[TEST] Draft Gala Event",
        venue: "Secret Hall",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.DRAFT,
      },
    });
    draftEventId = draftEvent.id;

    const draftCategory = await prisma.category.create({
      data: {
        eventId: draftEventId,
        title: "[TEST] Draft Category",
        isActive: true,
      },
    });

    await prisma.nominee.create({
      data: {
        categoryId: draftCategory.id,
        nomineeCode: "DRAFT-NOM-01",
        name: "Draft Nominee Person",
        verifiedVotes: 999, // Should never be exposed!
        isActive: true,
      },
    });

    // 2. Create a PUBLISHED Event
    const publishedEvent = await prisma.event.create({
      data: {
        slug: "test-published-event",
        title: "Official NUAS KNUST Awards Gala 2026",
        theme: "Faith and Leadership",
        venue: "Great Hall, KNUST",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });
    publishedEventId = publishedEvent.id;

    const publishedCategory = await prisma.category.create({
      data: {
        eventId: publishedEventId,
        title: "[TEST] Published Category",
        displayOrder: 1,
        isActive: true,
      },
    });

    // Active approved nominee
    await prisma.nominee.create({
      data: {
        categoryId: publishedCategory.id,
        nomineeCode: "PUB-NOM-01",
        name: "Samuel Kwabena",
        bio: "Dedicated executive member.",
        verifiedVotes: 50,
        isActive: true,
      },
    });

    // Inactive nominee under published category
    await prisma.nominee.create({
      data: {
        categoryId: publishedCategory.id,
        nomineeCode: "PUB-NOM-INACTIVE",
        name: "Unapproved Nominee",
        verifiedVotes: 10,
        isActive: false, // Inactive!
      },
    });
  });

  afterAll(async () => {
    await prisma.nominee.deleteMany({
      where: { nomineeCode: { in: ["PUB-NOM-01", "PUB-NOM-INACTIVE", "DRAFT-NOM-01"] } },
    });
    await prisma.category.deleteMany({
      where: { title: { in: ["[TEST] Published Category", "[TEST] Draft Category"] } },
    });
    await prisma.event.deleteMany({
      where: { slug: { in: ["test-draft-event", "test-published-event"] } },
    });
    await prisma.$disconnect();
  });

  it("strictly excludes draft events and returns only published events", async () => {
    const published = await getPublishedEvent();
    expect(published).not.toBeNull();
    expect(published!.slug).toBe("test-published-event");
    expect(published!.status).toBe(EventStatus.PUBLISHED);
  });

  it("excludes inactive nominees and strips private vote counts from public event payload", async () => {
    const published = await getPublishedEvent();
    expect(published).not.toBeNull();

    const category = published!.categories.find((c) => c.title === "[TEST] Published Category");
    expect(category).toBeDefined();

    // Exactly 1 active nominee should be present, inactive nominee must be excluded
    expect(category!.nominees.length).toBe(1);
    expect(category!.nominees[0].nomineeCode).toBe("PUB-NOM-01");

    // Ensure verifiedVotes is completely absent from public return object
    const nomineeObject = category!.nominees[0] as unknown as Record<string, unknown>;
    expect(nomineeObject.verifiedVotes).toBeUndefined();
  });

  it("retrieves approved nominee profile by unique code", async () => {
    const nominee = await getApprovedNomineeByCode("PUB-NOM-01");
    expect(nominee).not.toBeNull();
    expect(nominee!.name).toBe("Samuel Kwabena");
    expect(nominee!.nomineeCode).toBe("PUB-NOM-01");
    expect(nominee!.category.title).toBe("[TEST] Published Category");

    const nomineeRecord = nominee as unknown as Record<string, unknown>;
    expect(nomineeRecord.verifiedVotes).toBeUndefined();
  });

  it("refuses to retrieve nominees belonging to DRAFT events", async () => {
    const nominee = await getApprovedNomineeByCode("DRAFT-NOM-01");
    expect(nominee).toBeNull();
  });

  it("refuses to retrieve inactive nominees even under a published event", async () => {
    const nominee = await getApprovedNomineeByCode("PUB-NOM-INACTIVE");
    expect(nominee).toBeNull();
  });
});

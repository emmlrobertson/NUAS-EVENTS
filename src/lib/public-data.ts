import { prisma } from "@/lib/prisma";
import { EventStatus } from "@prisma/client";
import { resolvePublicAuthoritativeEvent } from "@/lib/event-resolution";

export interface PublicNominee {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  nomineeCode: string;
  displayOrder: number;
  category: {
    id: string;
    title: string;
    description: string | null;
  };
}

export interface PublicCategory {
  id: string;
  title: string;
  description: string | null;
  displayOrder: number;
  nominees: PublicNominee[];
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  theme: string | null;
  venue: string;
  eventDate: Date;
  votingStartDate: Date;
  votingEndDate: Date;
  status: EventStatus;
  categories: PublicCategory[];
}

/**
 * Retrieves the currently published event with active, approved categories and active, approved nominees.
 * Uses the authoritative event resolution engine to prevent ambiguity when multiple events exist.
 * Strictly filters out DRAFT, ARCHIVED, or TEST events.
 * Strips all private and internal administrative fields (verifiedVotes, phone, email, internal IDs).
 */
export async function getPublishedEvent(): Promise<PublicEvent | null> {
  const resolution = await resolvePublicAuthoritativeEvent();

  if (resolution.isAmbiguous || !resolution.event) {
    if (resolution.isAmbiguous) {
      console.warn(
        `[Authoritative Event Ambiguity] Multiple published events exist (${resolution.ambiguousEvents?.length}). ` +
          `Configure AUTHORITATIVE_EVENT_SLUG or ensure only one published event exists.`
      );
    }
    return null;
  }

  const eventWithRelations = await prisma.event.findUnique({
    where: { id: resolution.event.id },
    include: {
      categories: {
        where: {
          isActive: true,
          isApproved: true,
        },
        orderBy: {
          displayOrder: "asc",
        },
        include: {
          nominees: {
            where: {
              isActive: true,
              isApproved: true,
            },
            orderBy: {
              displayOrder: "asc",
            },
            select: {
              id: true,
              name: true,
              bio: true,
              avatarUrl: true,
              nomineeCode: true,
              displayOrder: true,
              categoryId: true,
              // EXPLICITLY OMITTING verifiedVotes and any admin fields
            },
          },
        },
      },
    },
  });

  if (!eventWithRelations) {
    return null;
  }

  // Format safely to prevent internal schema leaks
  return {
    id: eventWithRelations.id,
    slug: eventWithRelations.slug,
    title: eventWithRelations.title,
    theme: eventWithRelations.theme,
    venue: eventWithRelations.venue,
    eventDate: eventWithRelations.eventDate,
    votingStartDate: eventWithRelations.votingStartDate,
    votingEndDate: eventWithRelations.votingEndDate,
    status: eventWithRelations.status,
    categories: eventWithRelations.categories.map((cat) => ({
      id: cat.id,
      title: cat.title,
      description: cat.description,
      displayOrder: cat.displayOrder,
      nominees: cat.nominees.map((nom) => ({
        id: nom.id,
        name: nom.name,
        bio: nom.bio,
        avatarUrl: nom.avatarUrl,
        nomineeCode: nom.nomineeCode,
        displayOrder: nom.displayOrder,
        category: {
          id: cat.id,
          title: cat.title,
          description: cat.description,
        },
      })),
    })),
  };
}

/**
 * Retrieves an approved nominee by their unique code.
 * Strictly verifies that the nominee is approved and active and belongs to an approved, active category
 * under the authoritative published event.
 */
export async function getApprovedNomineeByCode(code: string): Promise<PublicNominee | null> {
  const resolution = await resolvePublicAuthoritativeEvent();
  if (resolution.isAmbiguous || !resolution.event) {
    return null;
  }

  const nominee = await prisma.nominee.findFirst({
    where: {
      nomineeCode: code,
      isActive: true,
      isApproved: true,
      category: {
        eventId: resolution.event.id,
        isActive: true,
        isApproved: true,
      },
    },
    select: {
      id: true,
      name: true,
      bio: true,
      avatarUrl: true,
      nomineeCode: true,
      displayOrder: true,
      category: {
        select: {
          id: true,
          title: true,
          description: true,
        },
      },
      // verifiedVotes is deliberately excluded
    },
  });

  return nominee;
}

/**
 * Retrieves all approved, active categories for the authoritative published event.
 * Strictly verifies that the parent event is authoritatively PUBLISHED.
 * Includes all active, approved nominees for each category.
 * If event is DRAFT, ARCHIVED, or ambiguous, returns an empty array.
 */
export async function getPublicCategories(): Promise<PublicCategory[]> {
  const resolution = await resolvePublicAuthoritativeEvent();
  if (resolution.isAmbiguous || !resolution.event || resolution.event.status !== EventStatus.PUBLISHED) {
    return [];
  }

  const categories = await prisma.category.findMany({
    where: {
      eventId: resolution.event.id,
      isActive: true,
      isApproved: true,
    },
    orderBy: {
      displayOrder: "asc",
    },
    include: {
      nominees: {
        where: {
          isActive: true,
          isApproved: true,
        },
        orderBy: {
          displayOrder: "asc",
        },
        select: {
          id: true,
          name: true,
          bio: true,
          avatarUrl: true,
          nomineeCode: true,
          displayOrder: true,
          categoryId: true,
        },
      },
    },
  });

  return categories.map((cat) => ({
    id: cat.id,
    title: cat.title,
    description: cat.description,
    displayOrder: cat.displayOrder,
    nominees: cat.nominees.map((nom) => ({
      id: nom.id,
      name: nom.name,
      bio: nom.bio,
      avatarUrl: nom.avatarUrl,
      nomineeCode: nom.nomineeCode,
      displayOrder: nom.displayOrder,
      category: {
        id: cat.id,
        title: cat.title,
        description: cat.description,
      },
    })),
  }));
}

/**
 * Retrieves a single category by ID, verifying:
 * - Category exists, is active (isActive: true), and is approved (isApproved: true).
 * - Category belongs to the authoritative published event.
 * - Parent event is authoritatively PUBLISHED.
 * - Only includes active, approved nominees belonging to this category.
 * Returns null if not found, unapproved, inactive, or belonging to another event.
 */
export async function getPublicCategoryById(categoryId: string): Promise<PublicCategory | null> {
  if (!categoryId || typeof categoryId !== "string") {
    return null;
  }

  const resolution = await resolvePublicAuthoritativeEvent();
  if (resolution.isAmbiguous || !resolution.event || resolution.event.status !== EventStatus.PUBLISHED) {
    return null;
  }

  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      eventId: resolution.event.id,
      isActive: true,
      isApproved: true,
    },
    include: {
      nominees: {
        where: {
          isActive: true,
          isApproved: true,
        },
        orderBy: {
          displayOrder: "asc",
        },
        select: {
          id: true,
          name: true,
          bio: true,
          avatarUrl: true,
          nomineeCode: true,
          displayOrder: true,
          categoryId: true,
        },
      },
    },
  });

  if (!category) {
    return null;
  }

  return {
    id: category.id,
    title: category.title,
    description: category.description,
    displayOrder: category.displayOrder,
    nominees: category.nominees.map((nom) => ({
      id: nom.id,
      name: nom.name,
      bio: nom.bio,
      avatarUrl: nom.avatarUrl,
      nomineeCode: nom.nomineeCode,
      displayOrder: nom.displayOrder,
      category: {
        id: category.id,
        title: category.title,
        description: category.description,
      },
    })),
  };
}


export interface PublicTicketType {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  priceInPesewas: number;
  availableCapacity: number;
  salesStart: Date;
  salesEnd: Date;
  isAvailableForPurchase: boolean;
}

/**
 * Retrieves public-facing active ticket types for the authoritative published event.
 * Strictly enforces:
 * - Event must be authoritatively PUBLISHED (DRAFT, ARCHIVED, or unselected events return empty).
 * - Ticket types must be explicitly marked isActive: true.
 * - Accurately computes availableCapacity = max(0, totalCapacity - soldQuantity - reservedQuantity).
 * - Never returns tickets if event is unpublished or inactive.
 */
export async function getPublicTicketTypes(): Promise<PublicTicketType[]> {
  const resolution = await resolvePublicAuthoritativeEvent();
  if (resolution.isAmbiguous || !resolution.event || resolution.event.status !== EventStatus.PUBLISHED) {
    return [];
  }

  const now = new Date();
  const ticketTypes = await prisma.ticketType.findMany({
    where: {
      eventId: resolution.event.id,
      isActive: true,
    },
    orderBy: {
      priceInPesewas: "asc",
    },
    select: {
      id: true,
      eventId: true,
      name: true,
      description: true,
      priceInPesewas: true,
      totalCapacity: true,
      soldQuantity: true,
      reservedQuantity: true,
      salesStart: true,
      salesEnd: true,
    },
  });

  return ticketTypes.map((tt) => {
    const available = Math.max(0, tt.totalCapacity - tt.soldQuantity - tt.reservedQuantity);
    const inWindow = tt.salesStart <= now && now <= tt.salesEnd;
    return {
      id: tt.id,
      eventId: tt.eventId,
      name: tt.name,
      description: tt.description,
      priceInPesewas: tt.priceInPesewas,
      availableCapacity: available,
      salesStart: tt.salesStart,
      salesEnd: tt.salesEnd,
      isAvailableForPurchase: inWindow && available > 0,
    };
  });
}


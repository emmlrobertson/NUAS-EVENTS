import { prisma } from "@/lib/prisma";
import { EventStatus } from "@prisma/client";

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
 * Retrieves the currently published event with active categories and active nominees.
 * Strictly filters out DRAFT, ARCHIVED, or TEST events.
 * Strips all private and internal administrative fields (verifiedVotes, phone, email, internal IDs).
 */
export async function getPublishedEvent(): Promise<PublicEvent | null> {
  const event = await prisma.event.findFirst({
    where: {
      status: EventStatus.PUBLISHED,
    },
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

  if (!event) {
    return null;
  }

  // Format safely to prevent internal schema leaks
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    theme: event.theme,
    venue: event.venue,
    eventDate: event.eventDate,
    votingStartDate: event.votingStartDate,
    votingEndDate: event.votingEndDate,
    status: event.status,
    categories: event.categories.map((cat) => ({
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
 * Strictly verifies that the nominee is approved and active and belongs to an approved, active category under a PUBLISHED event.
 */
export async function getApprovedNomineeByCode(code: string): Promise<PublicNominee | null> {
  const nominee = await prisma.nominee.findFirst({
    where: {
      nomineeCode: code,
      isActive: true,
      isApproved: true,
      category: {
        isActive: true,
        isApproved: true,
        event: {
          status: EventStatus.PUBLISHED,
        },
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

import { prisma } from "@/lib/prisma";
import { Event, EventStatus } from "@prisma/client";

export type EventResolutionReason =
  | "SINGLE_PUBLISHED"
  | "CONFIGURED_SLUG"
  | "EXPLICIT_ID"
  | "NO_PUBLISHED_EVENTS"
  | "MULTIPLE_PUBLISHED_AMBIGUOUS"
  | "DRAFT_FALLBACK"
  | "NO_EVENTS_EXIST";

export interface PublicEventResolution {
  event: Event | null;
  isAmbiguous: boolean;
  reason: EventResolutionReason;
  ambiguousEvents?: Array<{
    id: string;
    slug: string;
    title: string;
    status: EventStatus;
    createdAt: Date;
  }>;
}

export interface AdminEventResolution {
  event: Event | null;
  isAmbiguous: boolean;
  reason: EventResolutionReason;
  allEvents: Array<{
    id: string;
    slug: string;
    title: string;
    status: EventStatus;
    createdAt: Date;
    _count?: {
      categories: number;
      votingOrders: number;
      ticketOrders: number;
    };
  }>;
  ambiguousEvents?: Array<{
    id: string;
    slug: string;
    title: string;
    status: EventStatus;
    createdAt: Date;
  }>;
}

/**
 * Authoritative Event Resolution for Public Pages (Home, Voting, Nominees).
 *
 * Consistent Event Selection Rules:
 * 1. Environment Slug Precedence:
 *    If `AUTHORITATIVE_EVENT_SLUG` or `ACTIVE_EVENT_SLUG` is defined, look for a PUBLISHED event
 *    matching that slug. If found, that event is authoritatively chosen without ambiguity.
 * 2. Single Published Event:
 *    If no slug override is set and exactly ONE event with status = PUBLISHED exists in the database,
 *    that single event is authoritatively chosen.
 * 3. Ambiguity Defense (Multiple Published Events):
 *    If more than one event has status = PUBLISHED and no slug override is set, the system DOES NOT
 *    guess, assume, or arbitrarily pick the newest or oldest event. Doing so would cause public visitors
 *    and administrators to potentially operate on different events.
 *    Instead, it flags `isAmbiguous: true` and returns `null` for public display so customers see
 *    a safe notice until an administrator resolves the ambiguity or sets `AUTHORITATIVE_EVENT_SLUG`.
 * 4. Zero Published Events:
 *    If 0 published events exist, returns `event: null` with `reason: "NO_PUBLISHED_EVENTS"`.
 */
export async function resolvePublicAuthoritativeEvent(): Promise<PublicEventResolution> {
  const configuredSlug =
    process.env.AUTHORITATIVE_EVENT_SLUG || process.env.ACTIVE_EVENT_SLUG;

  if (configuredSlug && configuredSlug.trim().length > 0) {
    const slugEvent = await prisma.event.findFirst({
      where: {
        slug: configuredSlug.trim(),
        status: EventStatus.PUBLISHED,
      },
    });

    if (slugEvent) {
      return {
        event: slugEvent,
        isAmbiguous: false,
        reason: "CONFIGURED_SLUG",
      };
    }
  }

  // Fetch all published events
  const publishedEvents = await prisma.event.findMany({
    where: {
      status: EventStatus.PUBLISHED,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (publishedEvents.length === 0) {
    return {
      event: null,
      isAmbiguous: false,
      reason: "NO_PUBLISHED_EVENTS",
    };
  }

  if (publishedEvents.length === 1) {
    return {
      event: publishedEvents[0],
      isAmbiguous: false,
      reason: "SINGLE_PUBLISHED",
    };
  }

  // Multiple published events without a designated slug -> Ambiguity!
  return {
    event: null,
    isAmbiguous: true,
    reason: "MULTIPLE_PUBLISHED_AMBIGUOUS",
    ambiguousEvents: publishedEvents.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      status: e.status,
      createdAt: e.createdAt,
    })),
  };
}

/**
 * Authoritative Event Resolution for Back-Office Administrator Pages.
 *
 * Rules:
 * 1. If the administrator provides an explicit `targetEventId` (via ?eventId=... URL parameter),
 *    that specific event is loaded.
 * 2. If no `targetEventId` is given, it checks the public authoritative resolution:
 *    - If single published event exists, that is resolved.
 *    - If multiple published events exist, it exposes `isAmbiguous: true` so the admin UI can
 *      prompt the administrator to pick the event explicitly.
 *    - If 0 published events exist, it falls back to the most recent DRAFT event (if any),
 *      or returns null if no events exist in the database.
 */
export async function resolveAdminAuthoritativeEvent(
  targetEventId?: string | null
): Promise<AdminEventResolution> {
  // Fetch all events for navigation and dropdown selector
  const allEvents = await prisma.event.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          categories: true,
          votingOrders: true,
          ticketOrders: true,
        },
      },
    },
  });

  if (allEvents.length === 0) {
    return {
      event: null,
      isAmbiguous: false,
      reason: "NO_EVENTS_EXIST",
      allEvents: [],
    };
  }

  // 1. Explicit ID
  if (targetEventId && targetEventId.trim().length > 0) {
    const explicitEvent = await prisma.event.findUnique({
      where: { id: targetEventId.trim() },
    });
    if (explicitEvent) {
      return {
        event: explicitEvent,
        isAmbiguous: false,
        reason: "EXPLICIT_ID",
        allEvents,
      };
    }
  }

  // 2. Check public authoritative resolution
  const publicRes = await resolvePublicAuthoritativeEvent();

  if (publicRes.isAmbiguous) {
    return {
      event: null,
      isAmbiguous: true,
      reason: "MULTIPLE_PUBLISHED_AMBIGUOUS",
      allEvents,
      ambiguousEvents: publicRes.ambiguousEvents,
    };
  }

  if (publicRes.event) {
    return {
      event: publicRes.event,
      isAmbiguous: false,
      reason: publicRes.reason,
      allEvents,
    };
  }

  // 3. Fallback: Most recent event (e.g. DRAFT mode)
  const fallbackEvent = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return {
    event: fallbackEvent,
    isAmbiguous: false,
    reason: "DRAFT_FALLBACK",
    allEvents,
  };
}

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { EventStatus, OrderStatus } from "@prisma/client";
import { VOTE_UNIT_PRICE_PESEWAS } from "@/lib/constants";
import { CreateVotingOrderParams, VotingOrderDto } from "./types";

export class VotingServiceError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "VotingServiceError";
    this.statusCode = statusCode;
  }
}

/**
 * Masks phone numbers for audit logs and checkout displays:
 * e.g., "0241234567" -> "024****567"
 * e.g., "+233241234567" -> "+233****4567"
 */
export function maskPhoneNumber(phone: string): string {
  const clean = phone.trim();
  if (clean.length <= 6) return clean;
  const isIntl = clean.startsWith("+");
  const prefixLen = isIntl ? 4 : 3;
  const suffixLen = isIntl ? 4 : 3;
  const prefix = clean.substring(0, prefixLen);
  const suffix = clean.substring(clean.length - suffixLen);
  return `${prefix}****${suffix}`;
}

/**
 * Generates an unpredictable, human-readable order number.
 * Format: VOTE-YYMMDD-XXXXXXXX
 */
export function generateVotingOrderNumber(eventDate?: Date): string {
  const d = eventDate ?? new Date();
  const year = d.getFullYear().toString().slice(-2);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const randomSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `VOTE-${year}${month}${day}-${randomSuffix}`;
}

/**
 * Validates and creates a new Voting Order within an atomic database transaction.
 * Enforces server-side integer pricing, strict category/nominee approval verification,
 * event voting window compliance, and idempotency key safety.
 */
export async function createVotingOrder(
  params: CreateVotingOrderParams
): Promise<VotingOrderDto> {
  const { eventId, voterPhone, voterEmail, allocations, idempotencyKey, ipAddress, userAgent } =
    params;

  // 1. Check idempotency key if provided
  if (idempotencyKey) {
    const existingOrder = await prisma.votingOrder.findUnique({
      where: { idempotencyKey },
      include: {
        allocations: {
          include: {
            nominee: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    if (existingOrder) {
      return {
        id: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        eventId: existingOrder.eventId,
        maskedPhone: maskPhoneNumber(existingOrder.voterPhone),
        voterEmail: existingOrder.voterEmail,
        totalVotes: existingOrder.totalVotes,
        unitPriceInPesewas: existingOrder.unitPriceInPesewas,
        totalAmountInPesewas: existingOrder.totalAmountInPesewas,
        status: existingOrder.status,
        initiatedAt: existingOrder.initiatedAt,
        paidAt: existingOrder.paidAt,
        allocations: existingOrder.allocations.map((a) => ({
          id: a.id,
          nomineeId: a.nomineeId,
          nomineeName: a.nominee.name,
          nomineeCode: a.nominee.nomineeCode,
          categoryTitle: a.nominee.category.title,
          numberOfVotes: a.numberOfVotes,
          subtotalInPesewas: a.subtotalInPesewas,
        })),
      };
    }
  }

  // 2. Authoritative Event Verification
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    throw new VotingServiceError("The specified event was not found.", 404);
  }

  if (event.status !== EventStatus.PUBLISHED) {
    throw new VotingServiceError("Voting is not available because the event is not published.", 400);
  }

  // 3. Voting Window Validation
  const now = new Date();
  if (now < event.votingStartDate) {
    throw new VotingServiceError(
      `Voting has not opened yet. Official voting opens on ${event.votingStartDate.toLocaleDateString("en-GB")}.`,
      400
    );
  }

  if (now > event.votingEndDate) {
    throw new VotingServiceError("Official voting for this event has closed.", 400);
  }

  // 4. Duplicate Allocation Check
  const nomineeIdSet = new Set<string>();
  for (const alloc of allocations) {
    if (nomineeIdSet.has(alloc.nomineeId)) {
      throw new VotingServiceError(
        "Duplicate nominee allocations detected. Please combine votes for the same nominee into a single allocation.",
        400
      );
    }
    nomineeIdSet.add(alloc.nomineeId);
  }

  // 5. Authoritatively Validate Each Nominee
  const nomineeIds = allocations.map((a) => a.nomineeId);
  const dbNominees = await prisma.nominee.findMany({
    where: {
      id: { in: nomineeIds },
    },
    include: {
      category: true,
    },
  });

  if (dbNominees.length !== nomineeIds.length) {
    throw new VotingServiceError("One or more selected nominees could not be found.", 400);
  }

  const nomineeMap = new Map(dbNominees.map((n) => [n.id, n]));

  // Verify eligibility of each nominee and category
  for (const alloc of allocations) {
    const nominee = nomineeMap.get(alloc.nomineeId);
    if (!nominee) {
      throw new VotingServiceError(`Nominee "${alloc.nomineeId}" was not found.`, 400);
    }

    if (!nominee.isActive || !nominee.isApproved) {
      throw new VotingServiceError(
        `Nominee "${nominee.name}" (${nominee.nomineeCode}) is not approved or active for voting.`,
        400
      );
    }

    if (nominee.category.eventId !== eventId) {
      throw new VotingServiceError(
        `Nominee "${nominee.name}" does not belong to the selected event.`,
        400
      );
    }

    if (!nominee.category.isActive || !nominee.category.isApproved) {
      throw new VotingServiceError(
        `The category "${nominee.category.title}" is not approved or active for voting.`,
        400
      );
    }

    if (!Number.isInteger(alloc.numberOfVotes) || alloc.numberOfVotes < 1) {
      throw new VotingServiceError(
        `Invalid vote quantity for "${nominee.name}". Votes must be a positive integer $\ge 1$.`,
        400
      );
    }
  }

  // 6. Authoritative Integer Calculations (in Pesewas)
  let totalVotes = 0;
  const calculatedAllocations = allocations.map((alloc) => {
    const nominee = nomineeMap.get(alloc.nomineeId)!;
    const votes = alloc.numberOfVotes;
    const subtotal = votes * VOTE_UNIT_PRICE_PESEWAS;
    totalVotes += votes;
    return {
      nomineeId: alloc.nomineeId,
      nomineeName: nominee.name,
      nomineeCode: nominee.nomineeCode,
      categoryTitle: nominee.category.title,
      numberOfVotes: votes,
      subtotalInPesewas: subtotal,
    };
  });

  const totalAmountInPesewas = totalVotes * VOTE_UNIT_PRICE_PESEWAS;
  const orderNumber = generateVotingOrderNumber(event.eventDate);

  // 7. Atomic Order Creation
  const newOrder = await prisma.$transaction(async (tx) => {
    const created = await tx.votingOrder.create({
      data: {
        orderNumber,
        eventId: event.id,
        voterPhone: voterPhone.trim(),
        voterEmail: voterEmail?.trim() || null,
        totalVotes,
        unitPriceInPesewas: VOTE_UNIT_PRICE_PESEWAS,
        totalAmountInPesewas,
        status: OrderStatus.PENDING,
        idempotencyKey: idempotencyKey ?? null,
        allocations: {
          create: calculatedAllocations.map((a) => ({
            nomineeId: a.nomineeId,
            numberOfVotes: a.numberOfVotes,
            subtotalInPesewas: a.subtotalInPesewas,
          })),
        },
      },
      include: {
        allocations: {
          include: {
            nominee: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        action: "VOTING_ORDER_CREATED",
        entity: "VotingOrder",
        entityId: created.id,
        details: {
          orderNumber: created.orderNumber,
          totalVotes: created.totalVotes,
          totalAmountInPesewas: created.totalAmountInPesewas,
          allocationsCount: created.allocations.length,
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    return created;
  });

  return {
    id: newOrder.id,
    orderNumber: newOrder.orderNumber,
    eventId: newOrder.eventId,
    maskedPhone: maskPhoneNumber(newOrder.voterPhone),
    voterEmail: newOrder.voterEmail,
    totalVotes: newOrder.totalVotes,
    unitPriceInPesewas: newOrder.unitPriceInPesewas,
    totalAmountInPesewas: newOrder.totalAmountInPesewas,
    status: newOrder.status,
    initiatedAt: newOrder.initiatedAt,
    paidAt: newOrder.paidAt,
    allocations: newOrder.allocations.map((a) => ({
      id: a.id,
      nomineeId: a.nomineeId,
      nomineeName: a.nominee.name,
      nomineeCode: a.nominee.nomineeCode,
      categoryTitle: a.nominee.category.title,
      numberOfVotes: a.numberOfVotes,
      subtotalInPesewas: a.subtotalInPesewas,
    })),
  };
}

/**
 * Retrieves a voting order by order number for checkout and payment tracking.
 * Omits private voter data (phone is masked, internal IDs excluded).
 */
export async function getVotingOrderByNumber(
  orderNumber: string
): Promise<VotingOrderDto | null> {
  const order = await prisma.votingOrder.findUnique({
    where: { orderNumber },
    include: {
      allocations: {
        include: {
          nominee: {
            include: {
              category: true,
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    eventId: order.eventId,
    maskedPhone: maskPhoneNumber(order.voterPhone),
    voterEmail: order.voterEmail,
    totalVotes: order.totalVotes,
    unitPriceInPesewas: order.unitPriceInPesewas,
    totalAmountInPesewas: order.totalAmountInPesewas,
    status: order.status,
    initiatedAt: order.initiatedAt,
    paidAt: order.paidAt,
    allocations: order.allocations.map((a) => ({
      id: a.id,
      nomineeId: a.nomineeId,
      nomineeName: a.nominee.name,
      nomineeCode: a.nominee.nomineeCode,
      categoryTitle: a.nominee.category.title,
      numberOfVotes: a.numberOfVotes,
      subtotalInPesewas: a.subtotalInPesewas,
    })),
  };
}

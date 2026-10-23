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

export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const clean = email.trim();
  const parts = clean.split("@");
  if (parts.length !== 2) return clean;
  const [user, domain] = parts;
  if (user.length <= 2) return `${user[0] || "*"}***@${domain}`;
  return `${user[0]}****${user[user.length - 1]}@${domain}`;
}

/**
 * Asserts that an existing order with the same idempotency key was created
 * with the exact same logical request payload. Prevents key reuse attacks.
 */
function assertIdempotencyPayloadMatches(
  existingOrder: {
    eventId: string;
    voterPhone: string;
    voterEmail: string;
    allocations: Array<{ nomineeId: string; numberOfVotes: number }>;
  },
  requested: CreateVotingOrderParams
): void {
  const phoneMatches = existingOrder.voterPhone.trim() === requested.voterPhone.trim();
  const emailMatches =
    existingOrder.voterEmail.trim().toLowerCase() ===
    requested.voterEmail.trim().toLowerCase();
  const eventMatches = existingOrder.eventId === requested.eventId;

  const existingAllocMap = new Map(
    existingOrder.allocations.map((a) => [a.nomineeId, a.numberOfVotes])
  );
  const allocMatches =
    existingOrder.allocations.length === requested.allocations.length &&
    requested.allocations.every(
      (a) => existingAllocMap.get(a.nomineeId) === a.numberOfVotes
    );

  if (!phoneMatches || !emailMatches || !eventMatches || !allocMatches) {
    throw new VotingServiceError(
      "The provided idempotency key has already been used for an order with different details or allocations.",
      409
    );
  }
}

function mapOrderToDto(order: {
  id: string;
  orderNumber: string;
  eventId: string;
  voterPhone: string;
  voterEmail: string;
  totalVotes: number;
  unitPriceInPesewas: number;
  totalAmountInPesewas: number;
  status: OrderStatus;
  initiatedAt: Date;
  paidAt: Date | null;
  allocations: Array<{
    id: string;
    nomineeId: string;
    numberOfVotes: number;
    subtotalInPesewas: number;
    nominee: {
      name: string;
      nomineeCode: string;
      category: {
        title: string;
      };
    };
  }>;
}): VotingOrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    eventId: order.eventId,
    maskedPhone: maskPhoneNumber(order.voterPhone),
    voterEmail: maskEmail(order.voterEmail) ?? "",
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

/**
 * Generates an unpredictable, human-readable order number with high cryptographic entropy.
 * Format: VOTE-YYMMDD-XXXXXXXXXXXX (12 random hex characters, 48-bit entropy)
 */
export function generateVotingOrderNumber(eventDate?: Date): string {
  const d = eventDate ?? new Date();
  const year = d.getFullYear().toString().slice(-2);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const randomSuffix = crypto.randomBytes(6).toString("hex").toUpperCase();
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

  // 0. Contact detail validation
  if (!voterPhone || typeof voterPhone !== "string" || voterPhone.trim().length === 0) {
    throw new VotingServiceError("A valid voter phone number is required.", 400);
  }
  if (!voterEmail || typeof voterEmail !== "string" || voterEmail.trim().length === 0 || !voterEmail.includes("@")) {
    throw new VotingServiceError("A valid voter email address is required.", 400);
  }

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
      assertIdempotencyPayloadMatches(existingOrder, params);
      return mapOrderToDto(existingOrder);
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
  try {
    const newOrder = await prisma.$transaction(async (tx) => {
      const created = await tx.votingOrder.create({
        data: {
          orderNumber,
          eventId: event.id,
          voterPhone: voterPhone.trim(),
          voterEmail: voterEmail.trim().toLowerCase(),
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

    return mapOrderToDto(newOrder);
  } catch (err: unknown) {
    // If concurrent race condition occurred on idempotencyKey unique constraint:
    if (
      idempotencyKey &&
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const concurrentOrder = await prisma.votingOrder.findUnique({
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

      if (concurrentOrder) {
        assertIdempotencyPayloadMatches(concurrentOrder, params);
        return mapOrderToDto(concurrentOrder);
      }
    }
    throw err;
  }
}

/**
 * Retrieves a voting order by order number for checkout and payment tracking.
 * Omits private voter data (phone is masked, email is masked, internal IDs excluded).
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

  return mapOrderToDto(order);
}

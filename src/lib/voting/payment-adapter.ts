import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { EventStatus, OrderStatus, OrderType, PaymentProvider, Prisma } from "@prisma/client";
import { PaymentGatewayAdapter } from "./types";
import { getEnv, parseBooleanEnv } from "@/lib/env";

export class SandboxMockPaymentGateway implements PaymentGatewayAdapter {
  public readonly provider: PaymentProvider = PaymentProvider.SANDBOX_MOCK;

  async initializePayment(params: {
    orderNumber: string;
    amountInPesewas: number;
    currency: string;
    customerEmail?: string;
    customerPhone: string;
    orderType: "VOTING" | "TICKET";
    callbackUrl: string;
  }): Promise<{ gatewayReference: string; checkoutUrl: string }> {
    const isProduction = process.env.NODE_ENV === "production";
    const isLive = parseBooleanEnv(process.env.ENABLE_LIVE_PAYMENTS, false);
    if (isProduction || isLive) {
      throw new Error("Sandbox payment provider is strictly prohibited in live production.");
    }
    const env = getEnv();
    if (env.NODE_ENV === "production" || env.ENABLE_LIVE_PAYMENTS) {
      throw new Error("Sandbox payment provider is strictly prohibited in live production.");
    }

    const gatewayReference = `MOCK-REF-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const checkoutUrl = `/vote/checkout?orderNumber=${encodeURIComponent(params.orderNumber)}&gatewayRef=${encodeURIComponent(gatewayReference)}`;

    return {
      gatewayReference,
      checkoutUrl,
    };
  }

  async verifyPayment(gatewayReference: string): Promise<{
    success: boolean;
    amountInPesewas: number;
    currency: string;
    status: OrderStatus;
    rawPayload?: unknown;
  }> {
    const env = getEnv();
    if (env.NODE_ENV === "production" || env.ENABLE_LIVE_PAYMENTS) {
      throw new Error("Sandbox payment provider is strictly prohibited in live production.");
    }

    return {
      success: true,
      amountInPesewas: 0,
      currency: "GHS",
      status: OrderStatus.PAID,
      rawPayload: { simulated: true, gatewayReference },
    };
  }
}

export interface ConfirmVotingPaymentParams {
  orderNumber: string;
  outcome: "SUCCESS" | "FAILED" | "CANCELLED";
  gatewayReference?: string;
  amountInPesewas?: number;
  currency?: string;
  confirmationTimestamp?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface PaymentConfirmationResult {
  success: boolean;
  orderNumber: string;
  status: OrderStatus;
  message: string;
  totalVotes: number;
  totalAmountInPesewas: number;
}

/**
 * Safely upserts a quarantined payment transaction record without colliding with unique constraints
 * if the gateway reuses the same gatewayReference on subsequent callbacks.
 */
async function upsertQuarantinedTransaction(
  tx: Prisma.TransactionClient,
  params: {
    reference: string;
    gateway: PaymentProvider;
    gatewayReference: string;
    votingOrderId: string;
    amountInPesewas: number;
    currency: string;
    idempotencyKey: string;
    rawWebhookPayload: unknown;
  }
) {
  const existing = await tx.paymentTransaction.findFirst({
    where: {
      OR: [
        {
          gateway: params.gateway,
          gatewayReference: params.gatewayReference,
        },
        {
          reference: params.reference,
        },
      ],
    },
  });

  if (existing) {
    return await tx.paymentTransaction.update({
      where: { id: existing.id },
      data: {
        status: OrderStatus.QUARANTINED,
        amountInPesewas: params.amountInPesewas,
        currency: params.currency,
        rawWebhookPayload: params.rawWebhookPayload as Prisma.InputJsonValue,
      },
    });
  }

  return await tx.paymentTransaction.create({
    data: {
      reference: params.reference,
      gateway: params.gateway,
      gatewayReference: params.gatewayReference,
      orderType: OrderType.VOTING,
      votingOrderId: params.votingOrderId,
      amountInPesewas: params.amountInPesewas,
      currency: params.currency,
      status: OrderStatus.QUARANTINED,
      idempotencyKey: params.idempotencyKey,
      rawWebhookPayload: params.rawWebhookPayload as Prisma.InputJsonValue,
    },
  });
}

/**
 * Authoritatively processes voting payment state transitions with concurrency protection.
 * Enforces:
 * - Strict prohibition of sandbox simulation in production or live payment mode.
 * - Idempotent execution (prevents double-crediting of votes on repeat calls).
 * - Atomic conditional state transitions (status = PENDING -> PAID) to block concurrent double-increments.
 * - Explicit safe state-transition handling for late/conflicting outcomes (quarantine on unexpected success).
 * - Strict amount and currency verification: missing or wrong amounts/currencies must quarantine without crediting votes.
 * - Safe upsert of payment transactions to prevent duplicate gatewayReference crashes.
 * - Strict deadline policy: NO GRACE PERIOD. Confirmations after votingEndDate must not credit votes.
 * - Server-side category and nominee eligibility re-verification before crediting.
 * - Decoupled, non-blocking asynchronous email receipt queueing in EmailOutbox.
 */
export async function confirmVotingPayment(
  params: ConfirmVotingPaymentParams
): Promise<PaymentConfirmationResult> {
  // 1. Strict Production and Live Gate Guard
  const isProduction = process.env.NODE_ENV === "production";
  const isLivePayments = parseBooleanEnv(process.env.ENABLE_LIVE_PAYMENTS, false);
  if (isProduction || isLivePayments) {
    throw new Error("Sandbox payment simulation cannot be invoked in production or when live payments are enabled.");
  }
  const env = getEnv();
  if (env.NODE_ENV === "production" || env.ENABLE_LIVE_PAYMENTS) {
    throw new Error("Sandbox payment simulation cannot be invoked in production or when live payments are enabled.");
  }

  const {
    orderNumber,
    outcome,
    gatewayReference,
    amountInPesewas,
    currency,
    confirmationTimestamp,
    ipAddress,
    userAgent,
  } = params;

  // Server-side authoritative confirmation timestamp
  const confirmationTime = confirmationTimestamp ?? new Date();

  // 2. Fetch order with event, nominees, and allocations
  const order = await prisma.votingOrder.findUnique({
    where: { orderNumber },
    include: {
      event: true,
      allocations: {
        include: {
          nominee: {
            include: {
              category: true,
            },
          },
        },
      },
      transactions: true,
    },
  });

  if (!order) {
    throw new Error(`Voting order "${orderNumber}" not found.`);
  }

  // 3. Repeated Confirmation Idempotency Check: Already PAID
  if (order.status === OrderStatus.PAID) {
    return {
      success: true,
      orderNumber: order.orderNumber,
      status: OrderStatus.PAID,
      message: "Order has already been confirmed and votes credited.",
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  }

  const effectiveRef =
    gatewayReference || `MOCK-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const transactionIdempotencyKey = `TX-${order.id}-${effectiveRef}-${outcome}`;

  // 4. Conflicting Confirmations: Order reached a terminal failure/cancelled state
  if (order.status === OrderStatus.FAILED || order.status === OrderStatus.EXPIRED) {
    if (outcome === "FAILED" || outcome === "CANCELLED") {
      return {
        success: false,
        orderNumber: order.orderNumber,
        status: order.status,
        message: `Order was already marked as ${order.status}.`,
        totalVotes: order.totalVotes,
        totalAmountInPesewas: order.totalAmountInPesewas,
      };
    }

    // Success arrived late after failure: Move to QUARANTINED rather than arbitrary overwrite
    await prisma.$transaction(async (tx) => {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.QUARANTINED,
          quarantineReason: `Late payment confirmation: Received SUCCESS after order reached ${order.status}. Quarantined for organizer reconciliation.`,
        },
      });

      await upsertQuarantinedTransaction(tx, {
        reference: `REF-${effectiveRef}`,
        gateway: PaymentProvider.SANDBOX_MOCK,
        gatewayReference: effectiveRef,
        votingOrderId: order.id,
        amountInPesewas: amountInPesewas ?? order.totalAmountInPesewas,
        currency: currency ?? "GHS",
        idempotencyKey: transactionIdempotencyKey,
        rawWebhookPayload: {
          simulated: true,
          outcome: "LATE_SUCCESS_AFTER_FAILURE",
          originalStatus: order.status,
          timestamp: confirmationTime.toISOString(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VOTING_PAYMENT_QUARANTINED_LATE",
          entity: "VotingOrder",
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            originalStatus: order.status,
            effectiveRef,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
    });

    return {
      success: false,
      orderNumber: order.orderNumber,
      status: OrderStatus.QUARANTINED,
      message: `Order was in "${order.status}" status. Late payment has been quarantined for manual reconciliation.`,
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  }

  // If already in QUARANTINED, return current status
  if (order.status === OrderStatus.QUARANTINED) {
    return {
      success: false,
      orderNumber: order.orderNumber,
      status: OrderStatus.QUARANTINED,
      message: `Order is currently quarantined for review: ${order.quarantineReason || "Under review"}.`,
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  }

  // Order must be PENDING at this stage
  if (order.status !== OrderStatus.PENDING) {
    return {
      success: false,
      orderNumber: order.orderNumber,
      status: order.status,
      message: `Order cannot be confirmed because it is currently in "${order.status}" status.`,
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  }

  // 5. Amount and Currency Authoritative Verification for SUCCESS
  if (outcome === "SUCCESS") {
    const isAmountMissing = amountInPesewas === undefined || amountInPesewas === null;
    const isAmountWrong = !isAmountMissing && amountInPesewas !== order.totalAmountInPesewas;
    const isCurrencyMissing = !currency || typeof currency !== "string" || currency.trim() === "";
    const isCurrencyWrong = !isCurrencyMissing && currency.trim().toUpperCase() !== "GHS";

    if (isAmountMissing || isAmountWrong || isCurrencyMissing || isCurrencyWrong) {
      let quarantineReason = "";
      if (isAmountMissing) {
        quarantineReason = "Missing authoritative payment amount evidence. Quarantined for organizer audit.";
      } else if (isAmountWrong) {
        quarantineReason = `Amount mismatch: Expected ${order.totalAmountInPesewas} pesewas, but received ${amountInPesewas} pesewas.`;
      } else if (isCurrencyMissing) {
        quarantineReason = "Missing payment currency evidence. Quarantined for organizer audit.";
      } else {
        quarantineReason = `Unsupported currency "${currency}". Only GHS is authorized for settlement. Quarantined for organizer audit.`;
      }

      await prisma.$transaction(async (tx) => {
        await tx.votingOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.QUARANTINED,
            quarantineReason,
          },
        });

        await upsertQuarantinedTransaction(tx, {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          votingOrderId: order.id,
          amountInPesewas: isAmountMissing ? order.totalAmountInPesewas : amountInPesewas,
          currency: isCurrencyMissing ? "UNKNOWN" : currency.trim().toUpperCase(),
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            isAmountMissing,
            isAmountWrong,
            isCurrencyMissing,
            isCurrencyWrong,
            receivedAmount: amountInPesewas ?? null,
            receivedCurrency: currency ?? null,
            expectedAmount: order.totalAmountInPesewas,
            expectedCurrency: "GHS",
            timestamp: confirmationTime.toISOString(),
          },
        });

        await tx.auditLog.create({
          data: {
            action: "VOTING_PAYMENT_QUARANTINED_AMOUNT_OR_CURRENCY_INVALID",
            entity: "VotingOrder",
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              quarantineReason,
              receivedAmount: amountInPesewas ?? null,
              receivedCurrency: currency ?? null,
              expectedAmount: order.totalAmountInPesewas,
              expectedCurrency: "GHS",
            },
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
          },
        });
      });

      throw new Error(quarantineReason);
    }
  }

  // 6. Handle FAILED or CANCELLED Outcomes
  if (outcome === "FAILED" || outcome === "CANCELLED") {
    const finalStatus = outcome === "CANCELLED" ? OrderStatus.EXPIRED : OrderStatus.FAILED;

    await prisma.$transaction(async (tx) => {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          quarantineReason: outcome === "CANCELLED" ? "Payment cancelled by voter" : "Payment failed at gateway",
        },
      });

      await tx.paymentTransaction.create({
        data: {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          orderType: OrderType.VOTING,
          votingOrderId: order.id,
          amountInPesewas: amountInPesewas ?? order.totalAmountInPesewas,
          currency: currency ?? "GHS",
          status: finalStatus,
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            outcome,
            timestamp: confirmationTime.toISOString(),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: `VOTING_PAYMENT_${outcome}`,
          entity: "VotingOrder",
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            outcome,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
    });

    return {
      success: false,
      orderNumber: order.orderNumber,
      status: finalStatus,
      message: outcome === "CANCELLED" ? "Payment was cancelled." : "Payment simulation failed.",
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  }

  // 7. Atomic Concurrency-Safe Settlement Transaction with Server-Side Re-validation
  return await prisma.$transaction(async (tx) => {
    // A. Re-verify Event Status
    const freshEvent = await tx.event.findUniqueOrThrow({
      where: { id: order.eventId },
    });

    if (freshEvent.status !== EventStatus.PUBLISHED) {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.QUARANTINED,
          quarantineReason: `Event is no longer PUBLISHED (status: ${freshEvent.status}) at payment settlement. Quarantined for organizer review.`,
        },
      });

      await upsertQuarantinedTransaction(tx, {
        reference: `REF-${effectiveRef}`,
        gateway: PaymentProvider.SANDBOX_MOCK,
        gatewayReference: effectiveRef,
        votingOrderId: order.id,
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        idempotencyKey: transactionIdempotencyKey,
        rawWebhookPayload: {
          simulated: true,
          eventStatus: freshEvent.status,
          timestamp: confirmationTime.toISOString(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VOTING_PAYMENT_QUARANTINED_EVENT_INELIGIBLE",
          entity: "VotingOrder",
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            eventStatus: freshEvent.status,
            effectiveRef,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return {
        success: false,
        orderNumber: order.orderNumber,
        status: OrderStatus.QUARANTINED,
        message: `Event is no longer in PUBLISHED status (${freshEvent.status}). Payment quarantined.`,
        totalVotes: order.totalVotes,
        totalAmountInPesewas: order.totalAmountInPesewas,
      };
    }

    // B. Strict Voting Deadline Enforcement: NO GRACE PERIOD
    if (confirmationTime > freshEvent.votingEndDate) {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.QUARANTINED,
          quarantineReason: `Payment confirmed at ${confirmationTime.toISOString()} after voting closed at ${freshEvent.votingEndDate.toISOString()}. No grace period permitted per organizer policy. Quarantined for manual reconciliation.`,
        },
      });

      await upsertQuarantinedTransaction(tx, {
        reference: `REF-${effectiveRef}`,
        gateway: PaymentProvider.SANDBOX_MOCK,
        gatewayReference: effectiveRef,
        votingOrderId: order.id,
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        idempotencyKey: transactionIdempotencyKey,
        rawWebhookPayload: {
          simulated: true,
          deadline: freshEvent.votingEndDate.toISOString(),
          confirmationTime: confirmationTime.toISOString(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VOTING_PAYMENT_QUARANTINED_POST_DEADLINE",
          entity: "VotingOrder",
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            votingEndDate: freshEvent.votingEndDate.toISOString(),
            confirmedAt: confirmationTime.toISOString(),
            effectiveRef,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return {
        success: false,
        orderNumber: order.orderNumber,
        status: OrderStatus.QUARANTINED,
        message: `Voting deadline closed at ${freshEvent.votingEndDate.toISOString()}. Payment received after deadline and quarantined without crediting votes.`,
        totalVotes: order.totalVotes,
        totalAmountInPesewas: order.totalAmountInPesewas,
      };
    }

    // C. Re-verify Nominee & Category Eligibility inside Transaction
    for (const alloc of order.allocations) {
      const freshNominee = await tx.nominee.findUniqueOrThrow({
        where: { id: alloc.nomineeId },
        include: { category: true },
      });

      if (!freshNominee.isActive || !freshNominee.isApproved) {
        await tx.votingOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.QUARANTINED,
            quarantineReason: `Nominee "${freshNominee.name}" (${freshNominee.nomineeCode}) became unapproved or inactive prior to payment settlement.`,
          },
        });

        await upsertQuarantinedTransaction(tx, {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          votingOrderId: order.id,
          amountInPesewas: order.totalAmountInPesewas,
          currency: "GHS",
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            disqualifiedNomineeId: freshNominee.id,
            isActive: freshNominee.isActive,
            isApproved: freshNominee.isApproved,
            timestamp: confirmationTime.toISOString(),
          },
        });

        await tx.auditLog.create({
          data: {
            action: "VOTING_PAYMENT_QUARANTINED_NOMINEE_INELIGIBLE",
            entity: "VotingOrder",
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              nomineeCode: freshNominee.nomineeCode,
              nomineeName: freshNominee.name,
              effectiveRef,
            },
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
          },
        });

        return {
          success: false,
          orderNumber: order.orderNumber,
          status: OrderStatus.QUARANTINED,
          message: `Nominee "${freshNominee.name}" is no longer eligible to receive votes. Payment quarantined.`,
          totalVotes: order.totalVotes,
          totalAmountInPesewas: order.totalAmountInPesewas,
        };
      }

      if (!freshNominee.category.isActive || !freshNominee.category.isApproved) {
        await tx.votingOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.QUARANTINED,
            quarantineReason: `Category "${freshNominee.category.title}" became unapproved or inactive prior to payment settlement.`,
          },
        });

        await upsertQuarantinedTransaction(tx, {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          votingOrderId: order.id,
          amountInPesewas: order.totalAmountInPesewas,
          currency: "GHS",
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            disqualifiedCategoryId: freshNominee.category.id,
            isActive: freshNominee.category.isActive,
            isApproved: freshNominee.category.isApproved,
            timestamp: confirmationTime.toISOString(),
          },
        });

        await tx.auditLog.create({
          data: {
            action: "VOTING_PAYMENT_QUARANTINED_CATEGORY_INELIGIBLE",
            entity: "VotingOrder",
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              categoryTitle: freshNominee.category.title,
              effectiveRef,
            },
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
          },
        });

        return {
          success: false,
          orderNumber: order.orderNumber,
          status: OrderStatus.QUARANTINED,
          message: `Category "${freshNominee.category.title}" is no longer eligible. Payment quarantined.`,
          totalVotes: order.totalVotes,
          totalAmountInPesewas: order.totalAmountInPesewas,
        };
      }
    }

    // D. Atomic Claim: conditional update ensures only ONE concurrent transaction transitions PENDING -> PAID
    const updateResult = await tx.votingOrder.updateMany({
      where: {
        id: order.id,
        status: OrderStatus.PENDING,
      },
      data: {
        status: OrderStatus.PAID,
        paidAt: confirmationTime,
      },
    });

    if (updateResult.count === 0) {
      // Another concurrent worker transitioned the row first
      const concurrentOrder = await tx.votingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });

      if (concurrentOrder.status === OrderStatus.PAID) {
        return {
          success: true,
          orderNumber: order.orderNumber,
          status: OrderStatus.PAID,
          message: "Order was already confirmed concurrently.",
          totalVotes: order.totalVotes,
          totalAmountInPesewas: order.totalAmountInPesewas,
        };
      }

      throw new Error(
        `State transition conflict: Order is in status "${concurrentOrder.status}".`
      );
    }

    // E. Insert authoritative payment transaction
    await tx.paymentTransaction.create({
      data: {
        reference: `SYS-${effectiveRef}`,
        gateway: PaymentProvider.SANDBOX_MOCK,
        gatewayReference: effectiveRef,
        orderType: OrderType.VOTING,
        votingOrderId: order.id,
        ticketOrderId: null, // Strictly null for exclusive order binding CHECK constraint
        amountInPesewas: order.totalAmountInPesewas,
        currency: "GHS",
        status: OrderStatus.PAID,
        idempotencyKey: transactionIdempotencyKey,
        rawWebhookPayload: {
          simulated: true,
          outcome: "SUCCESS",
          gateway: "SANDBOX_MOCK",
          timestamp: confirmationTime.toISOString(),
        },
      },
    });

    // F. Increment verified votes exactly once
    for (const allocation of order.allocations) {
      await tx.nominee.update({
        where: { id: allocation.nomineeId },
        data: {
          verifiedVotes: {
            increment: allocation.numberOfVotes,
          },
        },
      });
    }

    // G. Record Audit Log
    await tx.auditLog.create({
      data: {
        action: "VOTING_ORDER_PAID_AND_CREDITED",
        entity: "VotingOrder",
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          totalVotes: order.totalVotes,
          amountInPesewas: order.totalAmountInPesewas,
          effectiveRef,
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    // H. Enqueue Decoupled Email Receipt (voterEmail is authoritative non-null)
    await tx.emailOutbox.create({
      data: {
        recipient: order.voterEmail,
        subject: `NUAS KNUST Awards — Voting Receipt (#${order.orderNumber})`,
        template: "VOTING_RECEIPT",
        payload: {
          orderNumber: order.orderNumber,
          totalVotes: order.totalVotes,
          amountInPesewas: order.totalAmountInPesewas,
          allocations: order.allocations.map((a) => ({
            nomineeCode: a.nominee.nomineeCode,
            nomineeName: a.nominee.name,
            votes: a.numberOfVotes,
          })),
          paidAt: confirmationTime.toISOString(),
        },
        status: "PENDING",
        votingOrderId: order.id,
      },
    });

    return {
      success: true,
      orderNumber: order.orderNumber,
      status: OrderStatus.PAID,
      message: `Successfully credited ${order.totalVotes} votes across ${order.allocations.length} nominee(s).`,
      totalVotes: order.totalVotes,
      totalAmountInPesewas: order.totalAmountInPesewas,
    };
  });
}

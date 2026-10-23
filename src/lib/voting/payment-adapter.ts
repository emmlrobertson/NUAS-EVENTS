import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { OrderStatus, OrderType, PaymentProvider } from "@prisma/client";
import { PaymentGatewayAdapter } from "./types";

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
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_LIVE_PAYMENTS === "true") {
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
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_LIVE_PAYMENTS === "true") {
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
 * Authoritatively processes voting payment state transitions with concurrency protection.
 * Enforces:
 * - Strict prohibition of sandbox simulation in production or live payment mode.
 * - Idempotent execution (prevents double-crediting of votes on repeat calls).
 * - Atomic conditional state transitions (status = PENDING -> PAID) to block concurrent double-increments.
 * - Explicit safe state-transition handling for late/conflicting outcomes (quarantine on unexpected success).
 * - Amount and currency verification against the authoritative database order total.
 * - Voting deadline grace window enforcement according to the event's configured latePaymentPolicy.
 * - Nominee eligibility re-verification before crediting.
 * - Decoupled, non-blocking asynchronous email receipt queueing in EmailOutbox.
 */
export async function confirmVotingPayment(
  params: ConfirmVotingPaymentParams
): Promise<PaymentConfirmationResult> {
  // 1. Strict Production and Live Gate Guard
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_LIVE_PAYMENTS === "true") {
    throw new Error("Sandbox payment simulation cannot be invoked in production or when live payments are enabled.");
  }

  const { orderNumber, outcome, gatewayReference, amountInPesewas, currency, ipAddress, userAgent } = params;

  // 2. Fetch order with event, nominees, and allocations
  const order = await prisma.votingOrder.findUnique({
    where: { orderNumber },
    include: {
      event: true,
      allocations: {
        include: {
          nominee: true,
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

      await tx.paymentTransaction.create({
        data: {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          orderType: OrderType.VOTING,
          votingOrderId: order.id,
          amountInPesewas: amountInPesewas ?? order.totalAmountInPesewas,
          currency: currency ?? "GHS",
          status: OrderStatus.QUARANTINED,
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            outcome: "LATE_SUCCESS_AFTER_FAILURE",
            originalStatus: order.status,
            timestamp: new Date().toISOString(),
          },
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

  // 5. Amount and Currency Authoritative Verification
  if (amountInPesewas !== undefined && amountInPesewas !== order.totalAmountInPesewas) {
    await prisma.$transaction(async (tx) => {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.QUARANTINED,
          quarantineReason: `Amount mismatch: Order total is ${order.totalAmountInPesewas} pesewas, but payment reported ${amountInPesewas} pesewas.`,
        },
      });

      await tx.paymentTransaction.create({
        data: {
          reference: `REF-${effectiveRef}`,
          gateway: PaymentProvider.SANDBOX_MOCK,
          gatewayReference: effectiveRef,
          orderType: OrderType.VOTING,
          votingOrderId: order.id,
          amountInPesewas: amountInPesewas,
          currency: currency ?? "GHS",
          status: OrderStatus.QUARANTINED,
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            amountMismatch: true,
            expected: order.totalAmountInPesewas,
            received: amountInPesewas,
            timestamp: new Date().toISOString(),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VOTING_PAYMENT_QUARANTINED_AMOUNT_MISMATCH",
          entity: "VotingOrder",
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            expectedPesewas: order.totalAmountInPesewas,
            reportedPesewas: amountInPesewas,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
    });

    throw new Error(
      `Payment amount mismatch: Expected ${order.totalAmountInPesewas} pesewas, but received ${amountInPesewas} pesewas.`
    );
  }

  if (currency !== undefined && currency !== "GHS") {
    throw new Error(`Unsupported currency "${currency}". Only GHS is accepted for voting orders.`);
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
          amountInPesewas: order.totalAmountInPesewas,
          currency: "GHS",
          status: finalStatus,
          idempotencyKey: transactionIdempotencyKey,
          rawWebhookPayload: {
            simulated: true,
            outcome,
            timestamp: new Date().toISOString(),
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

  // 7. Voting Deadline and Grace Window Enforcement
  const now = new Date();
  if (now > order.event.votingEndDate) {
    const graceMinutes = order.event.latePaymentGraceMinutes ?? 15;
    const graceDeadline = new Date(order.event.votingEndDate.getTime() + graceMinutes * 60 * 1000);

    if (now > graceDeadline) {
      await prisma.$transaction(async (tx) => {
        await tx.votingOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.QUARANTINED,
            quarantineReason: `Payment confirmed beyond the ${graceMinutes}-minute grace window after voting deadline.`,
          },
        });

        await tx.paymentTransaction.create({
          data: {
            reference: `REF-${effectiveRef}`,
            gateway: PaymentProvider.SANDBOX_MOCK,
            gatewayReference: effectiveRef,
            orderType: OrderType.VOTING,
            votingOrderId: order.id,
            amountInPesewas: order.totalAmountInPesewas,
            currency: "GHS",
            status: OrderStatus.QUARANTINED,
            idempotencyKey: transactionIdempotencyKey,
          },
        });
      });

      throw new Error("Voting deadline has closed and the grace window has expired. Order quarantined.");
    }

    if (order.event.latePaymentPolicy === "MANUAL_QUARANTINE") {
      await prisma.$transaction(async (tx) => {
        await tx.votingOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.QUARANTINED,
            quarantineReason: "Payment arrived during post-deadline grace period; quarantined per organizer policy.",
          },
        });

        await tx.paymentTransaction.create({
          data: {
            reference: `REF-${effectiveRef}`,
            gateway: PaymentProvider.SANDBOX_MOCK,
            gatewayReference: effectiveRef,
            orderType: OrderType.VOTING,
            votingOrderId: order.id,
            amountInPesewas: order.totalAmountInPesewas,
            currency: "GHS",
            status: OrderStatus.QUARANTINED,
            idempotencyKey: transactionIdempotencyKey,
          },
        });
      });

      return {
        success: true,
        orderNumber: order.orderNumber,
        status: OrderStatus.QUARANTINED,
        message: "Payment confirmed during grace period; quarantined for organizer review.",
        totalVotes: order.totalVotes,
        totalAmountInPesewas: order.totalAmountInPesewas,
      };
    }

    if (order.event.latePaymentPolicy === "STRICT_REJECT") {
      await prisma.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          quarantineReason: "Strict deadline policy: Voting closed.",
        },
      });
      throw new Error("Voting deadline has closed. Payment strictly rejected.");
    }
  }

  // 8. Re-verify Nominee Eligibility at Payment Time
  for (const alloc of order.allocations) {
    if (!alloc.nominee.isActive || !alloc.nominee.isApproved) {
      await prisma.votingOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.QUARANTINED,
          quarantineReason: `Nominee "${alloc.nominee.name}" (${alloc.nominee.nomineeCode}) was unapproved or deactivated prior to payment settlement.`,
        },
      });
      throw new Error(`Nominee "${alloc.nominee.name}" is no longer eligible to receive votes.`);
    }
  }

  // 9. Atomic Concurrency-Safe Settlement Transaction
  return await prisma.$transaction(async (tx) => {
    // Atomic conditional update ensures only ONE concurrent transaction transitions PENDING -> PAID
    const updateResult = await tx.votingOrder.updateMany({
      where: {
        id: order.id,
        status: OrderStatus.PENDING,
      },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
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

    // A. Insert authoritative payment transaction
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
          timestamp: new Date().toISOString(),
        },
      },
    });

    // B. Increment verified votes exactly once
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

    // C. Record Audit Log
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

    // D. Enqueue Decoupled Email Receipt
    if (order.voterEmail) {
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
            paidAt: new Date().toISOString(),
          },
          status: "PENDING",
          votingOrderId: order.id,
        },
      });
    }

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

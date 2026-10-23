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
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_LIVE_PAYMENTS === "true") {
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
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_LIVE_PAYMENTS === "true") {
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
 * Authoritatively processes voting payment state transitions.
 * Enforces:
 * - Strict prohibition of sandbox simulation in production.
 * - Idempotent execution (prevents double-crediting of votes on repeat calls).
 * - Atomic vote crediting in a single database transaction.
 * - Non-blocking asynchronous email receipt queueing in EmailOutbox.
 */
export async function confirmVotingPayment(
  params: ConfirmVotingPaymentParams
): Promise<PaymentConfirmationResult> {
  // 1. Production Safety Guard
  if (process.env.NODE_ENV === "production") {
    throw new Error("Sandbox payment simulation cannot be invoked in production.");
  }

  const { orderNumber, outcome, gatewayReference, ipAddress, userAgent } = params;

  // 2. Fetch order
  const order = await prisma.votingOrder.findUnique({
    where: { orderNumber },
    include: {
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

  // 3. Idempotency Check: Already PAID
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

  // Cannot transition terminal orders other than PENDING
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

  const effectiveRef =
    gatewayReference || `MOCK-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const transactionIdempotencyKey = `TX-${order.id}-${effectiveRef}-${outcome}`;

  // 4. Handle Failure / Cancellation
  if (outcome === "FAILED" || outcome === "CANCELLED") {
    const finalStatus = outcome === "CANCELLED" ? OrderStatus.EXPIRED : OrderStatus.FAILED;

    await prisma.$transaction(async (tx) => {
      await tx.votingOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          quarantineReason: outcome === "CANCELLED" ? "Payment cancelled by voter" : "Simulated payment failure",
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
            reason: "Sandbox simulation",
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

  // 5. Handle SUCCESS — Atomic Transaction
  return await prisma.$transaction(async (tx) => {
    // Re-verify inside transaction to prevent race conditions
    const currentOrder = await tx.votingOrder.findUnique({
      where: { id: order.id },
      select: { status: true },
    });

    if (currentOrder?.status === OrderStatus.PAID) {
      return {
        success: true,
        orderNumber: order.orderNumber,
        status: OrderStatus.PAID,
        message: "Order was already confirmed concurrently.",
        totalVotes: order.totalVotes,
        totalAmountInPesewas: order.totalAmountInPesewas,
      };
    }

    // A. Update Order Status
    await tx.votingOrder.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
      },
    });

    // B. Record Authoritative Payment Transaction (respecting CHECK constraint)
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

    // C. Atomically Increment Verified Votes for Each Allocated Nominee
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

    // D. Create Audit Log
    await tx.auditLog.create({
      data: {
        action: "VOTING_ORDER_PAID_AND_CREDITED",
        entity: "VotingOrder",
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          totalVotes: order.totalVotes,
          amountInPesewas: order.totalAmountInPesewas,
          allocations: order.allocations.map((a) => ({
            nomineeCode: a.nominee.nomineeCode,
            nomineeName: a.nominee.name,
            votes: a.numberOfVotes,
          })),
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    // E. Queue Decoupled Email Receipt (if voter provided email)
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

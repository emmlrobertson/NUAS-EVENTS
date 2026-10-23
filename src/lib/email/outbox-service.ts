import { prisma } from "@/lib/prisma";
import { EmailStatus } from "@prisma/client";

export interface EmailTransport {
  sendMail(options: {
    recipient: string;
    subject: string;
    template: string;
    payload: unknown;
  }): Promise<{ messageId: string }>;
}

export class MockEmailTransport implements EmailTransport {
  public failNextAttempts = 0;
  public sentMessages: Array<{ recipient: string; subject: string; payload: unknown }> = [];

  async sendMail(options: {
    recipient: string;
    subject: string;
    template: string;
    payload: unknown;
  }): Promise<{ messageId: string }> {
    if (this.failNextAttempts > 0) {
      this.failNextAttempts--;
      throw new Error("Simulated transient SMTP transport delivery failure.");
    }

    this.sentMessages.push({
      recipient: options.recipient,
      subject: options.subject,
      payload: options.payload,
    });

    return { messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` };
  }
}

export const defaultMockTransport = new MockEmailTransport();

export interface ProcessOutboxOptions {
  batchSize?: number;
  maxAttempts?: number;
  transport?: EmailTransport;
}

export interface OutboxProcessSummary {
  processed: number;
  sent: number;
  failed: number;
  deadLettered: number;
}

/**
 * Transactionally processes queued email outbox entries.
 * Guarantees:
 * 1. Email delivery is decoupled from payment settlement — an email failure NEVER reverses a paid order or vote counts.
 * 2. Delivery is AT-LEAST-ONCE (network timeouts between SMTP acceptance and DB update can cause retransmission on retry).
 * 3. Retries are capped by maxAttempts (default: 5) to prevent infinite delivery loops.
 * 4. Delivery attempts, errors, and terminal dead-letter states are transactionally recorded and auditable.
 */
export async function processEmailOutbox(
  options?: ProcessOutboxOptions
): Promise<OutboxProcessSummary> {
  const batchSize = options?.batchSize ?? 20;
  const maxAttempts = options?.maxAttempts ?? 5;
  const transport = options?.transport ?? defaultMockTransport;

  const pendingEmails = await prisma.emailOutbox.findMany({
    where: {
      OR: [
        { status: EmailStatus.PENDING },
        {
          status: EmailStatus.FAILED,
          attempts: { lt: maxAttempts },
        },
      ],
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  const summary: OutboxProcessSummary = {
    processed: pendingEmails.length,
    sent: 0,
    failed: 0,
    deadLettered: 0,
  };

  for (const email of pendingEmails) {
    try {
      await transport.sendMail({
        recipient: email.recipient,
        subject: email.subject,
        template: email.template,
        payload: email.payload,
      });

      await prisma.$transaction(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: email.id },
          data: {
            status: EmailStatus.SENT,
            sentAt: new Date(),
            attempts: { increment: 1 },
            lastError: null,
          },
        });

        await tx.auditLog.create({
          data: {
            action: "EMAIL_OUTBOX_SENT",
            entity: "EmailOutbox",
            entityId: email.id,
            details: {
              recipient: email.recipient,
              template: email.template,
              votingOrderId: email.votingOrderId,
            },
          },
        });
      });

      summary.sent++;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newAttempts = email.attempts + 1;
      const isDeadLetter = newAttempts >= maxAttempts;

      await prisma.$transaction(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: email.id },
          data: {
            status: EmailStatus.FAILED,
            attempts: newAttempts,
            lastError: errorMessage,
          },
        });

        await tx.auditLog.create({
          data: {
            action: isDeadLetter ? "EMAIL_OUTBOX_MAX_ATTEMPTS_EXCEEDED" : "EMAIL_OUTBOX_DELIVERY_FAILED",
            entity: "EmailOutbox",
            entityId: email.id,
            details: {
              recipient: email.recipient,
              template: email.template,
              attemptNumber: newAttempts,
              maxAttempts,
              error: errorMessage,
            },
          },
        });
      });

      summary.failed++;
      if (isDeadLetter) {
        summary.deadLettered++;
      }
    }
  }

  return summary;
}

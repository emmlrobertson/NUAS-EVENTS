import { prisma } from "@/lib/prisma";
import { EmailStatus } from "@prisma/client";
import crypto from "crypto";

export interface OutboxProcessOptions {
  batchSize?: number;
  maxAttempts?: number;
  transport?: EmailTransport;
  leaseDurationMs?: number; // Worker lease timeout (default 5 minutes)
}

export interface OutboxProcessSummary {
  processed: number;
  sent: number;
  failed: number;
  deadLettered: number;
}

export interface SendMailParams {
  recipient: string;
  subject: string;
  template: string;
  payload: any;
}

export interface EmailTransport {
  sendMail(params: SendMailParams): Promise<{ messageId: string }>;
}

/**
 * Mock Email Transport for Development and Automated Testing.
 * NOT PRODUCTION READY: Real production environments require a dedicated transactional
 * email transport (e.g. AWS SES, Resend, or verified SMTP).
 */
export class MockEmailTransport implements EmailTransport {
  public sentMessages: SendMailParams[] = [];
  public failNextAttempts = 0;

  async sendMail(params: SendMailParams): Promise<{ messageId: string }> {
    if (this.failNextAttempts > 0) {
      this.failNextAttempts--;
      throw new Error("Simulated transient SMTP connection error (MockEmailTransport).");
    }

    this.sentMessages.push(params);
    return {
      messageId: `mock-msg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    };
  }
}

/**
 * Asynchronously processes pending receipts in the Email Outbox with worker-lease concurrency control.
 *
 * Concurrency & Ownership Guarantees:
 * - Atomic Lease Acquisition: Candidate records are selected using PostgreSQL `FOR UPDATE SKIP LOCKED`.
 * - Worker Ownership Token: A unique cryptographic `claimToken` and `claimExpiresAt` are stamped on
 *   all claimed records.
 * - Fenced State Updates: Updates to `SENT` or `FAILED` are strictly conditional on `where: { id, claimToken }`.
 *   If a worker's lease expires due to a network stall and a second worker reclaims the record,
 *   the first (stale) worker cannot overwrite or clear the newer worker's state.
 * - Unlocked External Side-Effects: Network calls to `transport.sendMail()` occur strictly OUTSIDE
 *   database transactions, ensuring external SMTP latency never holds database table or row locks.
 * - Realistic At-Least-Once Delivery: External email delivery cannot participate in two-phase commit
 *   with PostgreSQL. If a transport successfully sends an email but the application crashes before
 *   recording `SENT`, a retry worker may deliver the email again. At-least-once delivery is guaranteed.
 * - History Preservation: Failed jobs are never deleted; they are marked FAILED with incremental attempt
 *   counters and error reasons preserved in audit logs.
 */
export async function processEmailOutbox(
  options?: OutboxProcessOptions
): Promise<OutboxProcessSummary> {
  const batchSize = options?.batchSize ?? 10;
  const maxAttempts = options?.maxAttempts ?? 3;
  const leaseDurationMs = options?.leaseDurationMs ?? 5 * 60 * 1000; // 5 minutes default lease
  const transport = options?.transport ?? new MockEmailTransport();

  const claimToken = `WORKER-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  // 1. Atomically claim candidate records using PostgreSQL FOR UPDATE SKIP LOCKED
  const claimedEmails = await prisma.$transaction(async (tx) => {
    const candidates: Array<{ id: string }> = await tx.$queryRaw`
      SELECT "id" FROM "email_outbox"
      WHERE ("status" = 'PENDING'::"EmailStatus" OR ("status" = 'FAILED'::"EmailStatus" AND "attempts" < ${maxAttempts}))
        AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" < ${now})
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (!candidates || candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((c) => c.id);

    // Apply worker lease to claimed records
    await tx.emailOutbox.updateMany({
      where: { id: { in: ids } },
      data: {
        claimToken,
        claimExpiresAt: leaseExpiresAt,
      },
    });

    return await tx.emailOutbox.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: "asc" },
    });
  });

  const summary: OutboxProcessSummary = {
    processed: claimedEmails.length,
    sent: 0,
    failed: 0,
    deadLettered: 0,
  };

  for (const email of claimedEmails) {
    try {
      // 2. Perform external network delivery OUTSIDE the database transaction
      await transport.sendMail({
        recipient: email.recipient,
        subject: email.subject,
        template: email.template,
        payload: email.payload,
      });

      // 3. Mark SENT conditionally on the current claimToken
      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.emailOutbox.updateMany({
          where: {
            id: email.id,
            claimToken: claimToken, // Fencing check: must still own the lease
          },
          data: {
            status: EmailStatus.SENT,
            sentAt: new Date(),
            attempts: { increment: 1 },
            lastError: null,
            claimToken: null,
            claimExpiresAt: null,
          },
        });

        if (updateResult.count === 0) {
          // Stale worker update prevented! Another worker superseded this expired lease.
          await tx.auditLog.create({
            data: {
              action: "EMAIL_OUTBOX_CLAIM_SUPERSEDED",
              entity: "EmailOutbox",
              entityId: email.id,
              details: {
                claimToken,
                reason: "Worker lease expired or was superseded before SENT state could be written.",
              },
            },
          });
          return;
        }

        await tx.auditLog.create({
          data: {
            action: "EMAIL_OUTBOX_SENT",
            entity: "EmailOutbox",
            entityId: email.id,
            details: {
              recipient: email.recipient,
              template: email.template,
              votingOrderId: email.votingOrderId,
              claimToken,
            },
          },
        });

        summary.sent++;
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newAttempts = email.attempts + 1;
      const isDeadLetter = newAttempts >= maxAttempts;

      // Mark FAILED conditionally on the current claimToken
      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.emailOutbox.updateMany({
          where: {
            id: email.id,
            claimToken: claimToken, // Fencing check
          },
          data: {
            status: EmailStatus.FAILED,
            attempts: newAttempts,
            lastError: errorMessage,
            claimToken: null,
            claimExpiresAt: null,
          },
        });

        if (updateResult.count === 0) {
          // Stale worker failure update prevented
          await tx.auditLog.create({
            data: {
              action: "EMAIL_OUTBOX_CLAIM_SUPERSEDED",
              entity: "EmailOutbox",
              entityId: email.id,
              details: {
                claimToken,
                error: errorMessage,
                reason: "Worker lease expired or was superseded before FAILED state could be written.",
              },
            },
          });
          return;
        }

        await tx.auditLog.create({
          data: {
            action: isDeadLetter
              ? "EMAIL_OUTBOX_MAX_ATTEMPTS_EXCEEDED"
              : "EMAIL_OUTBOX_DELIVERY_FAILED",
            entity: "EmailOutbox",
            entityId: email.id,
            details: {
              recipient: email.recipient,
              template: email.template,
              attemptNumber: newAttempts,
              maxAttempts,
              error: errorMessage,
              claimToken,
            },
          },
        });

        summary.failed++;
        if (isDeadLetter) {
          summary.deadLettered++;
        }
      });
    }
  }

  return summary;
}

/**
 * Atomically claims the next batch of eligible outbox records for a worker lease.
 * Useful for concurrent worker testing and dedicated worker loops.
 */
export async function claimNextOutboxBatch(
  batchSize = 10,
  leaseDurationSeconds = 300,
  maxAttempts = 3
) {
  const leaseDurationMs = leaseDurationSeconds * 1000;
  const claimToken = `WORKER-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  return await prisma.$transaction(async (tx) => {
    const candidates: Array<{ id: string }> = await tx.$queryRaw`
      SELECT "id" FROM "email_outbox"
      WHERE ("status" = 'PENDING'::"EmailStatus" OR ("status" = 'FAILED'::"EmailStatus" AND "attempts" < ${maxAttempts}))
        AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" < ${now})
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (!candidates || candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((c) => c.id);

    await tx.emailOutbox.updateMany({
      where: { id: { in: ids } },
      data: {
        claimToken,
        claimExpiresAt: leaseExpiresAt,
      },
    });

    return await tx.emailOutbox.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: "asc" },
    });
  });
}

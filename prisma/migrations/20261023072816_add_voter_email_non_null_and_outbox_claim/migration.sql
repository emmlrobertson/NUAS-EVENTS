/*
  Safe Additive Migration:
  - Verify no existing records have NULL voterEmail before setting NOT NULL
  - Alter latePaymentGraceMinutes default to 0 (deprecated)
  - Add worker claim lease columns to email_outbox for safe concurrent processing
*/

-- Safe pre-check: abort if any existing voting_orders have NULL voterEmail
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "voting_orders" WHERE "voterEmail" IS NULL) THEN
    RAISE EXCEPTION 'Cannot alter column voterEmail to NOT NULL: existing records contain NULL values. Remediation required.';
  END IF;
END $$;

-- AlterTable: voting_orders (set voterEmail NOT NULL)
ALTER TABLE "voting_orders" ALTER COLUMN "voterEmail" SET NOT NULL;

-- AlterTable: events (set latePaymentGraceMinutes default 0)
ALTER TABLE "events" ALTER COLUMN "latePaymentGraceMinutes" SET DEFAULT 0;

-- DropIndex: email_outbox_status_idx
DROP INDEX IF EXISTS "email_outbox_status_idx";

-- AlterTable: email_outbox (add claim fields for concurrency lease)
ALTER TABLE "email_outbox" 
  ADD COLUMN IF NOT EXISTS "claimExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "claimToken" TEXT;

-- CreateIndex: email_outbox_status_claimExpiresAt_idx
CREATE INDEX IF NOT EXISTS "email_outbox_status_claimExpiresAt_idx" ON "email_outbox"("status", "claimExpiresAt");

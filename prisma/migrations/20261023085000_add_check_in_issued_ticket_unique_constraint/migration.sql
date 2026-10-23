/*
  Safe Additive Migration:
  - Verify no duplicate check-ins exist for any issuedTicketId before applying unique index
  - Add UNIQUE index on check_ins(issuedTicketId) to enforce at most one check-in record per issued ticket
*/

-- Pre-check: Verify no existing duplicate check-in records exist
DO $$
BEGIN
  IF EXISTS (
    SELECT "issuedTicketId"
    FROM "check_ins"
    GROUP BY "issuedTicketId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique constraint on check_ins.issuedTicketId: duplicate check-in records exist. Manual remediation required.';
  END IF;
END $$;

-- Drop existing non-unique index if it exists
DROP INDEX IF EXISTS "check_ins_issuedTicketId_idx";

-- Create unique index on issuedTicketId
CREATE UNIQUE INDEX "check_ins_issuedTicketId_key" ON "check_ins"("issuedTicketId");

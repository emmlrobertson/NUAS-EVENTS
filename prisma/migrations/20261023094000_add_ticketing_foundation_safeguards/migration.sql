-- 1. Safety verification: Ensure no conflicting data exists in email_outbox before applying exclusive constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "email_outbox"
    WHERE "votingOrderId" IS NOT NULL AND "ticketOrderId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add check_email_outbox_exclusive_order_binding: rows with both votingOrderId and ticketOrderId exist';
  END IF;
END $$;

-- 2. Add exclusive parent order binding CHECK constraint to email_outbox
ALTER TABLE "email_outbox"
ADD CONSTRAINT "check_email_outbox_exclusive_order_binding"
CHECK (
  (
    ("votingOrderId" IS NOT NULL AND "ticketOrderId" IS NULL) OR
    ("votingOrderId" IS NULL AND "ticketOrderId" IS NOT NULL) OR
    ("votingOrderId" IS NULL AND "ticketOrderId" IS NULL)
  )
);

-- 3. Safety verification: Ensure no ticket types violate capacity invariants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ticket_types"
    WHERE "totalCapacity" < 0
       OR "soldQuantity" < 0
       OR "reservedQuantity" < 0
       OR "priceInPesewas" < 0
       OR "totalCapacity" < ("soldQuantity" + "reservedQuantity")
  ) THEN
    RAISE EXCEPTION 'Cannot add check_ticket_type_capacity_invariants: rows violating capacity invariants exist';
  END IF;
END $$;

-- 4. Add capacity and non-negative constraints to ticket_types
ALTER TABLE "ticket_types"
ADD CONSTRAINT "check_ticket_type_capacity_invariants"
CHECK (
  "totalCapacity" >= 0 AND
  "soldQuantity" >= 0 AND
  "reservedQuantity" >= 0 AND
  "priceInPesewas" >= 0 AND
  "totalCapacity" >= ("soldQuantity" + "reservedQuantity")
);

-- 5. Add idempotencyKey to ticket_orders
ALTER TABLE "ticket_orders" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- 6. Create unique index for ticket_orders idempotencyKey
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_orders_idempotencyKey_key" ON "ticket_orders"("idempotencyKey");

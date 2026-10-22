-- Add exclusive order binding CHECK constraint to payment_transactions
ALTER TABLE "payment_transactions"
ADD CONSTRAINT "check_payment_transaction_order_binding"
CHECK (
  ("orderType" = 'VOTING' AND "votingOrderId" IS NOT NULL AND "ticketOrderId" IS NULL) OR
  ("orderType" = 'TICKET' AND "ticketOrderId" IS NOT NULL AND "votingOrderId" IS NULL)
);
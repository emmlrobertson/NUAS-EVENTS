-- AlterTable
ALTER TABLE "voting_orders" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "voting_orders_idempotencyKey_key" ON "voting_orders"("idempotencyKey");

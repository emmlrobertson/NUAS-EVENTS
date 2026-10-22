-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "isApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "nominees" ADD COLUMN     "isApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "categories_eventId_isActive_isApproved_idx" ON "categories"("eventId", "isActive", "isApproved");

-- CreateIndex
CREATE INDEX "nominees_categoryId_isActive_isApproved_idx" ON "nominees"("categoryId", "isActive", "isApproved");

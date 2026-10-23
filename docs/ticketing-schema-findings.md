# Ticketing Schema Findings & Architectural Blueprint for Milestone 4

**Date:** 2026-10-23  
**Stage:** Stage 7 Post-Audit Findings & Safeguards  
**Scope:** Design requirements and database safeguards for the future Ticketing & Check-In Milestone.

> **CRITICAL RULE:** Do NOT invent speculative ticket prices, capacities, venue details, or event schedules. All parameters must be explicitly defined by the event organizers before live rollout.

---

## 1. TicketOrder Idempotency Strategy

### Problem Statement
When buyers submit payment authorization for ticket orders (especially over mobile networks or with retry loops), duplicate submissions can result in:
- Duplicate financial debits.
- Double-allocation of ticket inventory.
- Inconsistent order states.

### Architectural Requirement
Before ticket checkout is implemented in the upcoming ticketing milestone, `TicketOrder` must incorporate an idempotency key pattern:
1. **Schema Addition:** Add an `idempotencyKey String? @unique` field to the `ticket_orders` table (mapped in Prisma as `@unique @map("idempotency_key")`).
2. **Client-Generated Key:** The client UI (or initiating checkout action) generates a cryptographically random UUID v4 / UUID v7 idempotency key per checkout attempt.
3. **Database-Level Conflict Handling:** If an incoming request contains an existing `idempotencyKey`:
   - If the existing order is `PENDING` and within the lock window, return the existing order details or wait for in-flight transaction resolution.
   - If already `PAID`, return HTTP 200 with the completed order details without re-executing ticket allocation.
   - If rejected/expired, allow a new attempt with a fresh idempotency key.

---

## 2. EmailOutbox Exclusive Parent Order Relationship

### Problem Statement
The `email_outbox` table currently supports both `votingOrderId` and `ticketOrderId` as optional foreign keys:
```prisma
model EmailOutbox {
  id            String       @id @default(uuid())
  votingOrderId String?      @map("voting_order_id")
  ticketOrderId String?      @map("ticket_order_id")
  ...
}
```
Currently, nothing prevents a single `EmailOutbox` record from referencing *both* a `votingOrderId` and a `ticketOrderId`, or referencing *neither* when created by order workflows.

### Architectural Requirement
1. **Database Constraint:** In the migration establishing ticketing email dispatch, add a PostgreSQL `CHECK` constraint:
   ```sql
   ALTER TABLE "email_outbox"
   ADD CONSTRAINT "chk_email_outbox_exclusive_parent_order"
   CHECK (
     (
       ("voting_order_id" IS NOT NULL AND "ticket_order_id" IS NULL) OR
       ("voting_order_id" IS NULL AND "ticket_order_id" IS NOT NULL) OR
       ("voting_order_id" IS NULL AND "ticket_order_id" IS NULL) -- for standalone system emails if applicable
     )
   );
   ```
   Or strictly enforce `(voting_order_id IS NOT NULL AND ticket_order_id IS NULL) OR (voting_order_id IS NULL AND ticket_order_id IS NOT NULL)` if every outbox item must have exactly one parent order.
2. **Business Rule:** Each email notification must belong to exactly one domain event: either a voting receipt or a ticket issuance receipt.

---

## 3. Atomic Ticket Capacity Reservations & Concurrency-Safe Counters

### Problem Statement
Multiple users attempting to purchase tickets simultaneously during high-demand windows can cause overselling if ticket availability checks and balance decrements are performed without database locks (Time-of-Check to Time-of-Use race condition).

### Architectural Requirement
1. **Atomic Capacity Reservation:**
   When reserving tickets during checkout initiation, use PostgreSQL atomic update conditions or pessimistic locking (`SELECT ... FOR UPDATE`):
   ```sql
   UPDATE "ticket_types"
   SET "reserved_tickets" = "reserved_tickets" + $requestedQuantity
   WHERE "id" = $ticketTypeId
     AND ("total_capacity" - "sold_tickets" - "reserved_tickets") >= $requestedQuantity;
   ```
   If zero rows are affected, checkout must reject immediately with `INSUFFICIENT_CAPACITY`.
2. **Timed Hold Expiry:**
   Reservations must have a time-to-live (e.g., 10–15 minutes). A background cleanup worker or lazy reconciliation query must release expired reservations back to available inventory:
   ```sql
   UPDATE "ticket_types"
   SET "reserved_tickets" = GREATEST(0, "reserved_tickets" - $quantity)
   WHERE ...
   ```
3. **Completion Transition:**
   Upon confirmed payment receipt in a transactional unit:
   - Increment `sold_tickets = sold_tickets + $quantity`.
   - Decrement `reserved_tickets = reserved_tickets - $quantity`.
   - Mark `ticket_orders.paymentStatus = 'PAID'`.
   - Generate `IssuedTicket` records with cryptographic hashes.

---

## 4. Atomic Check-In Validation & Conflict Handling

### Problem Statement
At the venue entrance, network jitter or malicious re-scanning can trigger two simultaneous scan requests for the same physical or digital QR code across two security tablets.

### Architectural Solution
1. **Schema Safeguard (Completed in Stage 7):**
   `CheckIn.issuedTicketId` is protected by a PostgreSQL unique index:
   ```sql
   CREATE UNIQUE INDEX "check_ins_issuedTicketId_key" ON "check_ins"("issuedTicketId");
   ```
   This guarantees that no two check-in records can ever be committed for the same ticket.
2. **Atomic Verification & Ingestion Flow:**
   When the check-in endpoint is implemented in Milestone 5:
   ```ts
   // Step 1: Validate ticket status & payload cryptographic signature
   const ticket = await prisma.issuedTicket.findUnique({
     where: { ticketCode },
     include: { order: true, checkIn: true },
   });

   if (!ticket || ticket.order.paymentStatus !== "PAID") {
     return { success: false, code: "INVALID_TICKET" };
   }

   if (ticket.checkIn) {
     return {
       success: false,
       code: "ALREADY_CHECKED_IN",
       checkedInAt: ticket.checkIn.checkedInAt,
       deviceId: ticket.checkIn.deviceId,
     };
   }

   // Step 2: Atomic insertion inside a transaction
   try {
     const checkIn = await prisma.checkIn.create({
       data: {
         issuedTicketId: ticket.id,
         eventId: ticket.eventId,
         checkedInBy: adminUserId,
         deviceId: sanitizedDeviceId,
         checkedInAt: new Date(),
       },
     });
     return { success: true, checkIn };
   } catch (error) {
     if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
       // Unique constraint violation (code P2002)
       // This indicates an identical ticket was scanned and committed in a parallel worker a few milliseconds earlier
       return {
         success: false,
         code: "ALREADY_CHECKED_IN_RACE",
         message: "Ticket was already checked in moments ago.",
       };
     }
     throw error;
   }
   ```
3. **Scanning Device UX:**
   When receiving `ALREADY_CHECKED_IN` or `ALREADY_CHECKED_IN_RACE`, the mobile scanning client must display a bold red warning sound and banner: **"DUPLICATE SCAN DETECTED"**, showing the timestamp and scanning device ID of the original check-in to prevent unauthorized entry.

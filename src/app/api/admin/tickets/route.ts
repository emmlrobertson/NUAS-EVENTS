import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const createTicketTypeSchema = z
  .object({
    eventId: z.string().min(1, "Event ID is required"),
    name: z.string().min(2, "Ticket type name must be at least 2 characters").max(100),
    description: z.string().optional().nullable(),
    priceInPesewas: z.coerce.number().int().min(0, "Price must be a non-negative integer in pesewas"),
    totalCapacity: z.coerce.number().int().min(0, "Capacity must be a non-negative integer"),
    salesStart: z.coerce.date({ invalid_type_error: "Invalid sales start date" }),
    salesEnd: z.coerce.date({ invalid_type_error: "Invalid sales end date" }),
    isActive: z.boolean().default(true),
  })
  .refine((data) => data.salesEnd > data.salesStart, {
    message: "Sales end date must be strictly after sales start date",
    path: ["salesEnd"],
  });

const updateTicketTypeSchema = z.object({
  id: z.string().min(1, "Ticket Type ID is required"),
  eventId: z.string().optional(),
  name: z.string().min(2, "Ticket type name must be at least 2 characters").max(100).optional(),
  description: z.string().optional().nullable(),
  priceInPesewas: z.coerce.number().int().min(0, "Price must be a non-negative integer in pesewas").optional(),
  totalCapacity: z.coerce.number().int().min(0, "Capacity must be a non-negative integer").optional(),
  salesStart: z.coerce.date().optional(),
  salesEnd: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

  const ticketTypes = await prisma.ticketType.findMany({
    where: eventId ? { eventId } : undefined,
    orderBy: { createdAt: "asc" },
    include: {
      event: {
        select: { id: true, title: true, status: true },
      },
      _count: {
        select: {
          orderItems: true,
          issuedTickets: true,
        },
      },
    },
  });

  return NextResponse.json({ ticketTypes });
}

export async function POST(request: Request) {
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // If ID is provided, route through update handler
    if (body.id) {
      return await handleUpdate(body, admin);
    }

    const parsed = createTicketTypeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { eventId, name, description, priceInPesewas, totalCapacity, salesStart, salesEnd, isActive } = parsed.data;

    // Verify parent event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return NextResponse.json({ error: "Parent event not found." }, { status: 404 });
    }

    // Atomic transaction: ticket type create + audit log
    const ticketType = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketType.create({
        data: {
          eventId,
          name,
          description,
          priceInPesewas,
          totalCapacity,
          salesStart,
          salesEnd,
          isActive,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "CREATE_TICKET_TYPE",
          entity: "TicketType",
          entityId: created.id,
          details: {
            name,
            priceInPesewas,
            totalCapacity,
            eventId,
            isActive,
            salesStart: salesStart.toISOString(),
            salesEnd: salesEnd.toISOString(),
          },
        },
      });

      return created;
    });

    return NextResponse.json({ success: true, ticketType }, { status: 201 });
  } catch (error) {
    console.error("[Admin TicketType Error]", error);
    return NextResponse.json({ error: "Failed to save ticket type" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    return await handleUpdate(body, admin);
  } catch (error) {
    console.error("[Admin TicketType PATCH Error]", error);
    return NextResponse.json({ error: "Failed to update ticket type" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Ticket Type ID is required." }, { status: 400 });
    }

    const existing = await prisma.ticketType.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            orderItems: true,
            issuedTickets: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Ticket type not found." }, { status: 404 });
    }

    // Safety rule: Never delete ticket types that are referenced by existing orders or issued tickets
    if (existing._count.orderItems > 0 || existing._count.issuedTickets > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete ticket type "${existing.name}" because it is referenced by existing orders (${existing._count.orderItems} order items, ${existing._count.issuedTickets} issued tickets). Deactivate it instead.`,
        },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.ticketType.delete({
        where: { id },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "DELETE_TICKET_TYPE",
          entity: "TicketType",
          entityId: id,
          details: {
            deletedTicketTypeName: existing.name,
            eventId: existing.eventId,
          },
        },
      });
    });

    return NextResponse.json({ success: true, message: `Ticket type "${existing.name}" deleted successfully.` });
  } catch (error) {
    console.error("[Admin TicketType DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete ticket type" }, { status: 500 });
  }
}

async function handleUpdate(body: unknown, admin: { id: string; role: Role }) {
  const parsed = updateTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id, eventId, name, description, priceInPesewas, totalCapacity, salesStart, salesEnd, isActive } = parsed.data;

  const existing = await prisma.ticketType.findUnique({
    where: { id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Ticket type not found." }, { status: 404 });
  }

  // Preserve event ownership
  if (eventId && existing.eventId !== eventId) {
    return NextResponse.json(
      { error: "Ticket type does not belong to the specified event." },
      { status: 400 }
    );
  }

  // Invariant 1: Total capacity cannot be reduced below tickets already sold plus active reservations
  const targetCapacity = totalCapacity !== undefined ? totalCapacity : existing.totalCapacity;
  const committedTickets = existing.soldQuantity + existing.reservedQuantity;
  if (targetCapacity < committedTickets) {
    return NextResponse.json(
      {
        error: `Cannot reduce total capacity (${targetCapacity}) below committed tickets (${committedTickets}: ${existing.soldQuantity} sold, ${existing.reservedQuantity} reserved).`,
      },
      { status: 400 }
    );
  }

  // Invariant 2: Sales end date must be strictly after sales start date
  const finalStart = salesStart !== undefined ? salesStart : existing.salesStart;
  const finalEnd = salesEnd !== undefined ? salesEnd : existing.salesEnd;
  if (finalEnd <= finalStart) {
    return NextResponse.json(
      { error: "Sales end date must be strictly after sales start date." },
      { status: 400 }
    );
  }

  // Determine specific audit action
  let action = "UPDATE_TICKET_TYPE";
  if (isActive !== undefined && isActive !== existing.isActive) {
    action = isActive ? "ACTIVATE_TICKET_TYPE" : "DEACTIVATE_TICKET_TYPE";
  }

  const ticketType = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticketType.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description !== undefined ? description : existing.description,
        priceInPesewas: priceInPesewas ?? existing.priceInPesewas,
        totalCapacity: totalCapacity ?? existing.totalCapacity,
        salesStart: salesStart ?? existing.salesStart,
        salesEnd: salesEnd ?? existing.salesEnd,
        isActive: isActive !== undefined ? isActive : existing.isActive,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "TicketType",
        entityId: updated.id,
        details: {
          previous: {
            name: existing.name,
            priceInPesewas: existing.priceInPesewas,
            totalCapacity: existing.totalCapacity,
            isActive: existing.isActive,
          },
          updated: {
            name: updated.name,
            priceInPesewas: updated.priceInPesewas,
            totalCapacity: updated.totalCapacity,
            isActive: updated.isActive,
          },
        },
      },
    });

    return updated;
  });

  return NextResponse.json({ success: true, ticketType });
}

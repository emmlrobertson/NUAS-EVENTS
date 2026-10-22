import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { EventStatus, Role } from "@prisma/client";

const publishSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(EventStatus),
});

export async function POST(request: Request) {
  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = publishSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, status } = parsed.data;

    const existingEvent = await prisma.event.findUnique({ where: { id } });
    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const updatedEvent = await prisma.event.update({
      where: { id },
      data: { status },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CHANGE_EVENT_STATUS",
        entity: "Event",
        entityId: id,
        details: {
          previousStatus: existingEvent.status,
          newStatus: status,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Event status updated from ${existingEvent.status} to ${status}.`,
      event: updatedEvent,
    });
  } catch (error) {
    console.error("[Admin Event Status Error]", error);
    return NextResponse.json({ error: "Failed to update event status" }, { status: 500 });
  }
}

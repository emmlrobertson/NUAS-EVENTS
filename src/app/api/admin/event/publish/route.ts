import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { EventStatus, Role } from "@prisma/client";

const publishSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(EventStatus),
});

export async function POST(request: Request) {
  // CSRF validation on mutation
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Publishing requires SUPER_ADMIN privilege (distinguishing from EVENT_ADMIN)
  if (admin.role !== Role.SUPER_ADMIN) {
    return NextResponse.json(
      { error: "Forbidden. Event publication status can only be modified by Super Administrators." },
      { status: 403 }
    );
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

    // Atomic transaction: event status update + audit log
    const updatedEvent = await prisma.$transaction(async (tx) => {
      const event = await tx.event.update({
        where: { id },
        data: { status },
      });

      await tx.auditLog.create({
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

      return event;
    });

    try {
      revalidatePath("/");
      revalidatePath("/categories");
      revalidatePath("/vote");
    } catch {
      // Ignore in non-request/test environments
    }

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

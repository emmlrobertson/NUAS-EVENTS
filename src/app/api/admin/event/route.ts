import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const dateStringSchema = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format. Expected a valid ISO or datetime string.",
});

const updateEventSchema = z
  .object({
    id: z.string().min(1, "Event ID is required"),
    title: z.string().min(3, "Event title must be at least 3 characters"),
    theme: z.string().optional().nullable(),
    venue: z.string().min(1, "Venue is required"),
    eventDate: dateStringSchema,
    votingStartDate: dateStringSchema,
    votingEndDate: dateStringSchema,
    // Grace period setting is deprecated; zero grace is enforced authoritatively
    latePaymentGraceMinutes: z
      .number()
      .int()
      .min(0)
      .max(0, "Grace period is deprecated; only 0 is permitted as zero grace period is strictly enforced.")
      .default(0),
  })
  .refine(
    (data) => new Date(data.votingStartDate) <= new Date(data.votingEndDate),
    {
      message: "Voting start date must be on or before the voting end date.",
      path: ["votingStartDate"],
    }
  )
  .refine(
    (data) => new Date(data.votingEndDate) <= new Date(data.eventDate),
    {
      message: "Voting end date cannot be after the event date.",
      path: ["votingEndDate"],
    }
  );

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          categories: true,
          votingOrders: true,
          ticketOrders: true,
        },
      },
    },
  });

  return NextResponse.json({ events });
}

export async function PUT(request: Request) {
  // CSRF validation on mutation
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only Super Administrators can modify authoritative event configuration
  if (admin.role !== Role.SUPER_ADMIN) {
    return NextResponse.json(
      { error: "Forbidden. Event configuration details can only be modified by Super Administrators." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = updateEventSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, title, theme, venue, eventDate, votingStartDate, votingEndDate, latePaymentGraceMinutes } = parsed.data;

    const existingEvent = await prisma.event.findUnique({ where: { id } });
    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Atomic transaction: event update + audit log
    const updatedEvent = await prisma.$transaction(async (tx) => {
      const event = await tx.event.update({
        where: { id },
        data: {
          title,
          theme: theme || null,
          venue,
          eventDate: new Date(eventDate),
          votingStartDate: new Date(votingStartDate),
          votingEndDate: new Date(votingEndDate),
          latePaymentGraceMinutes,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "UPDATE_EVENT_DETAILS",
          entity: "Event",
          entityId: id,
          details: {
            previous: {
              title: existingEvent.title,
              venue: existingEvent.venue,
              theme: existingEvent.theme,
              eventDate: existingEvent.eventDate.toISOString(),
              votingStartDate: existingEvent.votingStartDate.toISOString(),
              votingEndDate: existingEvent.votingEndDate.toISOString(),
            },
            updated: {
              title,
              venue,
              theme: theme || null,
              eventDate: new Date(eventDate).toISOString(),
              votingStartDate: new Date(votingStartDate).toISOString(),
              votingEndDate: new Date(votingEndDate).toISOString(),
            },
          },
        },
      });

      return event;
    });

    return NextResponse.json({ success: true, event: updatedEvent });
  } catch (error) {
    console.error("[Admin Update Event Error]", error);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export const PATCH = PUT;

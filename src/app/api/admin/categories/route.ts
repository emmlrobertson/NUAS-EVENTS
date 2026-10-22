import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const categorySchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isApproved: z.boolean().default(false), // Explicit approval flag
});

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

  const categories = await prisma.category.findMany({
    where: eventId ? { eventId } : undefined,
    orderBy: { displayOrder: "asc" },
    include: {
      _count: {
        select: { nominees: true },
      },
    },
  });

  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  // CSRF validation on mutation
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = categorySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, eventId, title, description, displayOrder, isActive, isApproved } = parsed.data;

    const action = id ? "UPDATE_CATEGORY" : "CREATE_CATEGORY";

    // Atomic transaction: category write + audit log
    const category = await prisma.$transaction(async (tx) => {
      let cat;
      if (id) {
        cat = await tx.category.update({
          where: { id },
          data: {
            title,
            description,
            displayOrder,
            isActive,
            isApproved,
          },
        });
      } else {
        cat = await tx.category.create({
          data: {
            eventId,
            title,
            description,
            displayOrder,
            isActive,
            isApproved,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action,
          entity: "Category",
          entityId: cat.id,
          details: { title, displayOrder, isActive, isApproved, eventId },
        },
      });

      return cat;
    });

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error("[Admin Category Error]", error);
    return NextResponse.json({ error: "Failed to save category" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const categorySchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
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

    const { id, eventId, title, description, displayOrder, isActive } = parsed.data;

    let category;
    let action = "CREATE_CATEGORY";

    if (id) {
      category = await prisma.category.update({
        where: { id },
        data: {
          title,
          description,
          displayOrder,
          isActive,
        },
      });
      action = "UPDATE_CATEGORY";
    } else {
      category = await prisma.category.create({
        data: {
          eventId,
          title,
          description,
          displayOrder,
          isActive,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "Category",
        entityId: category.id,
        details: { title, displayOrder, isActive, eventId },
      },
    });

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error("[Admin Category Error]", error);
    return NextResponse.json({ error: "Failed to save category" }, { status: 500 });
  }
}

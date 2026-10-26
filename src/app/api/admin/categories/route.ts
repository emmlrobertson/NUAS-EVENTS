import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const createCategorySchema = z.object({
  eventId: z.string().min(1, "Event ID is required"),
  title: z.string().min(2, "Title must be at least 2 characters"),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isApproved: z.boolean().default(false), // Defaults to false for review
});

const updateCategorySchema = z.object({
  id: z.string().min(1, "Category ID is required"),
  eventId: z.string().optional(),
  title: z.string().min(2, "Title must be at least 2 characters").optional(),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isApproved: z.boolean().optional(),
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

    // If ID is provided, route through update handler
    if (body.id) {
      return await handleUpdate(body, admin);
    }

    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { eventId, title, description, displayOrder, isActive, isApproved } = parsed.data;

    // Verify parent event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return NextResponse.json({ error: "Parent event not found." }, { status: 404 });
    }

    // Atomic transaction: category create + audit log
    const category = await prisma.$transaction(async (tx) => {
      const cat = await tx.category.create({
        data: {
          eventId,
          title,
          description,
          displayOrder,
          isActive,
          isApproved,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "CREATE_CATEGORY",
          entity: "Category",
          entityId: cat.id,
          details: { title, displayOrder, isActive, isApproved, eventId },
        },
      });

      return cat;
    });

    try {
      revalidatePath("/");
      revalidatePath("/categories");
      revalidatePath(`/categories/${category.id}`);
      revalidatePath("/vote");
    } catch {
      // Ignore in non-request/test environments
    }

    return NextResponse.json({ success: true, category }, { status: 200 });
  } catch (error) {
    console.error("[Admin Category Error]", error);
    return NextResponse.json({ error: "Failed to save category" }, { status: 500 });
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
    console.error("[Admin Category PATCH Error]", error);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

async function handleUpdate(body: unknown, admin: { id: string; role: Role }) {
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id, eventId, title, description, displayOrder, isActive, isApproved } = parsed.data;

  const existing = await prisma.category.findUnique({
    where: { id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  // Preserve event ownership
  if (eventId && existing.eventId !== eventId) {
    return NextResponse.json(
      { error: "Category does not belong to the specified event." },
      { status: 400 }
    );
  }

  // Determine specific audit action
  let action = "UPDATE_CATEGORY";
  if (isApproved !== undefined && isApproved !== existing.isApproved) {
    action = isApproved ? "APPROVE_CATEGORY" : "UNAPPROVE_CATEGORY";
  } else if (isActive !== undefined && isActive !== existing.isActive) {
    action = isActive ? "ACTIVATE_CATEGORY" : "DEACTIVATE_CATEGORY";
  }

  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({
      where: { id },
      data: {
        title: title ?? existing.title,
        description: description !== undefined ? description : existing.description,
        displayOrder: displayOrder ?? existing.displayOrder,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        isApproved: isApproved !== undefined ? isApproved : existing.isApproved,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "Category",
        entityId: updated.id,
        details: {
          previous: {
            title: existing.title,
            isActive: existing.isActive,
            isApproved: existing.isApproved,
          },
          updated: {
            title: updated.title,
            isActive: updated.isActive,
            isApproved: updated.isApproved,
          },
        },
      },
    });

    return updated;
  });

  try {
    revalidatePath("/");
    revalidatePath("/categories");
    revalidatePath(`/categories/${category.id}`);
    revalidatePath("/vote");
  } catch {
    // Ignore in non-request/test environments
  }

  return NextResponse.json({ success: true, category });
}

const deleteCategorySchema = z.object({
  id: z.string().min(1, "Category ID is required"),
});

export async function DELETE(request: Request) {
  if (!validateCsrfProtection(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF origin header." }, { status: 403 });
  }

  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let id: string | null = null;
    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get("id");

    if (queryId) {
      id = queryId;
    } else {
      try {
        const body = await request.json();
        const parsed = deleteCategorySchema.safeParse(body);
        if (parsed.success) {
          id = parsed.data.id;
        }
      } catch {
        // empty body
      }
    }

    if (!id) {
      return NextResponse.json({ error: "Category ID is required." }, { status: 400 });
    }

    const existing = await prisma.category.findUnique({
      where: { id },
      include: {
        nominees: {
          include: {
            _count: {
              select: { voteAllocations: true },
            },
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Category not found." }, { status: 404 });
    }

    // Check if any nominee under this category has received votes or allocations
    const hasRecordedVotes = existing.nominees.some(
      (nom) => nom.verifiedVotes > 0 || nom._count.voteAllocations > 0
    );

    if (hasRecordedVotes) {
      return NextResponse.json(
        {
          error:
            "Cannot delete category with recorded voter allocations or verified votes. You can deactivate it instead to hide it from public voting.",
        },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete any nominees under this category first to ensure clean cascade
      await tx.nominee.deleteMany({
        where: { categoryId: id },
      });

      await tx.category.delete({
        where: { id },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "DELETE_CATEGORY",
          entity: "Category",
          entityId: id,
          details: {
            title: existing.title,
            deletedNomineesCount: existing.nominees.length,
          },
        },
      });
    });

    try {
      revalidatePath("/");
      revalidatePath("/categories");
      revalidatePath(`/categories/${id}`);
      revalidatePath("/vote");
    } catch {
      // Ignore in non-request environments
    }

    return NextResponse.json({ success: true, message: `Category "${existing.title}" deleted.` });
  } catch (error) {
    console.error("[Admin Category DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}


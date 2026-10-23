import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const createNomineeSchema = z.object({
  categoryId: z.string().min(1, "Category ID is required"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  bio: z.string().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable().or(z.literal("")),
  nomineeCode: z.string().min(2).max(20).toUpperCase(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isApproved: z.boolean().default(false), // Defaults to false for review
});

const updateNomineeSchema = z.object({
  id: z.string().min(1, "Nominee ID is required"),
  categoryId: z.string().optional(),
  name: z.string().min(2).optional(),
  bio: z.string().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable().or(z.literal("")),
  nomineeCode: z.string().min(2).max(20).toUpperCase().optional(),
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
  const categoryId = searchParams.get("categoryId");
  const eventId = searchParams.get("eventId");

  const nominees = await prisma.nominee.findMany({
    where: {
      categoryId: categoryId ? categoryId : undefined,
      category: eventId ? { eventId } : undefined,
    },
    orderBy: { displayOrder: "asc" },
    include: {
      category: {
        select: {
          id: true,
          title: true,
          eventId: true,
          event: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ nominees });
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

    if (body.id) {
      return await handleUpdate(body, admin);
    }

    const parsed = createNomineeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { categoryId, name, bio, avatarUrl, nomineeCode, displayOrder, isActive, isApproved } = parsed.data;

    // Verify target category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { event: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Target category not found." }, { status: 404 });
    }

    // Check unique nomineeCode
    const existingWithCode = await prisma.nominee.findFirst({
      where: { nomineeCode },
    });

    if (existingWithCode) {
      return NextResponse.json(
        { error: `Nominee code "${nomineeCode}" is already in use.` },
        { status: 409 }
      );
    }

    // Atomic transaction: nominee write + audit log
    const nominee = await prisma.$transaction(async (tx) => {
      const nom = await tx.nominee.create({
        data: {
          categoryId,
          name,
          bio,
          avatarUrl: avatarUrl || null,
          nomineeCode,
          displayOrder,
          isActive,
          isApproved,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "CREATE_NOMINEE",
          entity: "Nominee",
          entityId: nom.id,
          details: { name, nomineeCode, categoryId, isActive, isApproved },
        },
      });

      return nom;
    });

    try {
      revalidatePath("/");
      revalidatePath("/categories");
      revalidatePath(`/categories/${nominee.categoryId}`);
      revalidatePath(`/nominees/${encodeURIComponent(nominee.nomineeCode)}`);
      revalidatePath("/vote");
    } catch {
      // Ignore in non-request/test environments
    }

    return NextResponse.json({ success: true, nominee }, { status: 200 });
  } catch (error) {
    console.error("[Admin Nominee Error]", error);
    return NextResponse.json({ error: "Failed to save nominee" }, { status: 500 });
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
    console.error("[Admin Nominee PATCH Error]", error);
    return NextResponse.json({ error: "Failed to update nominee" }, { status: 500 });
  }
}

async function handleUpdate(body: unknown, admin: { id: string; role: Role }) {
  const parsed = updateNomineeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id, categoryId, name, bio, avatarUrl, nomineeCode, displayOrder, isActive, isApproved } = parsed.data;

  const existing = await prisma.nominee.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Nominee not found." }, { status: 404 });
  }

  // If changing category, verify target category exists and belongs to the same event
  if (categoryId && categoryId !== existing.categoryId) {
    const targetCat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!targetCat) {
      return NextResponse.json({ error: "Target category not found." }, { status: 404 });
    }
    if (targetCat.eventId !== existing.category.eventId) {
      return NextResponse.json(
        { error: "Cannot move nominee to a category in a different event." },
        { status: 400 }
      );
    }
  }

  // Check unique nomineeCode if changing
  if (nomineeCode && nomineeCode !== existing.nomineeCode) {
    const existingWithCode = await prisma.nominee.findFirst({
      where: {
        nomineeCode,
        NOT: { id },
      },
    });

    if (existingWithCode) {
      return NextResponse.json(
        { error: `Nominee code "${nomineeCode}" is already in use.` },
        { status: 409 }
      );
    }
  }

  // Determine specific audit action
  let action = "UPDATE_NOMINEE";
  if (isApproved !== undefined && isApproved !== existing.isApproved) {
    action = isApproved ? "APPROVE_NOMINEE" : "UNAPPROVE_NOMINEE";
  } else if (isActive !== undefined && isActive !== existing.isActive) {
    action = isActive ? "ACTIVATE_NOMINEE" : "DEACTIVATE_NOMINEE";
  }

  const nominee = await prisma.$transaction(async (tx) => {
    const updated = await tx.nominee.update({
      where: { id },
      data: {
        categoryId: categoryId ?? existing.categoryId,
        name: name ?? existing.name,
        bio: bio !== undefined ? bio : existing.bio,
        avatarUrl: avatarUrl !== undefined ? (avatarUrl || null) : existing.avatarUrl,
        nomineeCode: nomineeCode ?? existing.nomineeCode,
        displayOrder: displayOrder ?? existing.displayOrder,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        isApproved: isApproved !== undefined ? isApproved : existing.isApproved,
      },
      include: {
        category: {
          select: { id: true, title: true },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "Nominee",
        entityId: updated.id,
        details: {
          previous: {
            name: existing.name,
            nomineeCode: existing.nomineeCode,
            isActive: existing.isActive,
            isApproved: existing.isApproved,
          },
          updated: {
            name: updated.name,
            nomineeCode: updated.nomineeCode,
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
    revalidatePath(`/categories/${nominee.categoryId}`);
    revalidatePath(`/nominees/${encodeURIComponent(nominee.nomineeCode)}`);
    revalidatePath("/vote");
  } catch {
    // Ignore in non-request/test environments
  }

  return NextResponse.json({ success: true, nominee });
}

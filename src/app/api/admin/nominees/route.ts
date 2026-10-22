import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";

const nomineeSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1),
  name: z.string().min(2),
  bio: z.string().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable().or(z.literal("")),
  nomineeCode: z.string().min(2).max(20).toUpperCase(),
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
  const categoryId = searchParams.get("categoryId");

  const nominees = await prisma.nominee.findMany({
    where: categoryId ? { categoryId } : undefined,
    orderBy: { displayOrder: "asc" },
    include: {
      category: {
        select: {
          id: true,
          title: true,
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
    const parsed = nomineeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, categoryId, name, bio, avatarUrl, nomineeCode, displayOrder, isActive, isApproved } = parsed.data;

    // Check unique nomineeCode
    const existingWithCode = await prisma.nominee.findFirst({
      where: {
        nomineeCode,
        NOT: id ? { id } : undefined,
      },
    });

    if (existingWithCode) {
      return NextResponse.json(
        { error: `Nominee code "${nomineeCode}" is already in use.` },
        { status: 409 }
      );
    }

    const action = id ? "UPDATE_NOMINEE" : "CREATE_NOMINEE";

    // Atomic transaction: nominee write + audit log
    const nominee = await prisma.$transaction(async (tx) => {
      let nom;
      if (id) {
        nom = await tx.nominee.update({
          where: { id },
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
      } else {
        nom = await tx.nominee.create({
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
      }

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action,
          entity: "Nominee",
          entityId: nom.id,
          details: { name, nomineeCode, categoryId, isActive, isApproved },
        },
      });

      return nom;
    });

    return NextResponse.json({ success: true, nominee });
  } catch (error) {
    console.error("[Admin Nominee Error]", error);
    return NextResponse.json({ error: "Failed to save nominee" }, { status: 500 });
  }
}

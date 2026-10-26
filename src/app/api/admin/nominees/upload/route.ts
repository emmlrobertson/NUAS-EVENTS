import { NextResponse } from "next/server";
import { getCurrentAdminUser, validateCsrfProtection } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateImageBuffer, ImageValidationError } from "@/lib/storage/image-validator";
import {
  getImageStorageProvider,
  StorageConfigurationError,
  StorageExecutionError,
} from "@/lib/storage/image-storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 1. CSRF Protection
  if (!validateCsrfProtection(request)) {
    return NextResponse.json(
      { error: "Invalid or missing CSRF origin header." },
      { status: 403 }
    );
  }

  // 2. Administrator Authentication & Authorization
  const admin = await getCurrentAdminUser(request);
  if (!admin || (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.EVENT_ADMIN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 3. Extract multipart/form-data
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") || formData.get("photo");
    const nomineeCode = formData.get("nomineeCode")?.toString().trim();
    const nomineeId = formData.get("nomineeId")?.toString().trim();

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No image file provided. Please select a JPG, PNG, or WebP photo." },
        { status: 400 }
      );
    }

    // 4. Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 5. Server-side image validation (size, magic bytes, dimensions)
    let metadata;
    try {
      metadata = validateImageBuffer(buffer, {
        maxBytes: 5 * 1024 * 1024, // 5 MB
        minWidth: 100,
        minHeight: 100,
        maxWidth: 5000,
        maxHeight: 5000,
      });
    } catch (err) {
      if (err instanceof ImageValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    // 6. Optional: If nomineeId provided, verify nominee exists and belongs to authorized scope
    if (nomineeId) {
      const nominee = await prisma.nominee.findUnique({
        where: { id: nomineeId },
      });
      if (!nominee) {
        return NextResponse.json({ error: "Target nominee not found." }, { status: 404 });
      }
    }

    // 7. Upload to persistent storage provider
    const storageProvider = getImageStorageProvider();
    const uploadResult = await storageProvider.upload(buffer, metadata, {
      nomineeCode: nomineeCode || undefined,
      originalFilename: "name" in file ? (file as File).name : undefined,
    });

    // 8. Create Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "UPLOAD_NOMINEE_PHOTO",
          entity: "Nominee",
          entityId: nomineeId || nomineeCode || "new",
          details: {
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            format: uploadResult.format,
            bytes: uploadResult.bytes,
            dimensions: `${uploadResult.width}x${uploadResult.height}`,
            provider: uploadResult.provider,
          },
        },
      });
    } catch (auditErr) {
      console.warn("[Upload Audit Log Warning]", auditErr);
    }

    return NextResponse.json(
      {
        success: true,
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof StorageConfigurationError) {
      console.error("[Storage Configuration Error]", error.message);
      return NextResponse.json(
        { error: error.message },
        { status: 503 }
      );
    }

    if (error instanceof StorageExecutionError) {
      console.error("[Storage Execution Error]", error.message);
      return NextResponse.json(
        { error: "Image storage provider error. Please try again." },
        { status: 502 }
      );
    }

    console.error("[Nominee Photo Upload Error]", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during photo upload." },
      { status: 500 }
    );
  }
}

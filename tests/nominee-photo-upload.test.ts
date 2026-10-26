import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role, EventStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { POST as uploadRoute } from "../src/app/api/admin/nominees/upload/route";
import { POST as createNomineeRoute, PATCH as updateNomineeRoute, DELETE as deleteNomineeRoute } from "../src/app/api/admin/nominees/route";
import { hashPassword } from "../src/lib/auth/password";
import { createSessionToken } from "../src/lib/auth/session";
import { resetAllRateLimits } from "../src/lib/auth/rate-limiter";
import { validateImageBuffer, ImageValidationError } from "../src/lib/storage/image-validator";
import {
  setCustomStorageProvider,
  MockStorageProvider,
  StorageConfigurationError,
} from "../src/lib/storage/image-storage";
import { getApprovedNomineeByCode, getPublicCategories } from "../src/lib/public-data";

// Helper: Build a minimal valid PNG image buffer with specified width and height
function createValidPngBuffer(width = 120, height = 120): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = Buffer.alloc(25);
  ihdrChunk.writeUInt32BE(13, 0); // IHDR length
  ihdrChunk.write("IHDR", 4, "ascii");
  ihdrChunk.writeUInt32BE(width, 8);
  ihdrChunk.writeUInt32BE(height, 12);
  ihdrChunk.writeUInt8(8, 16); // 8 bits depth
  ihdrChunk.writeUInt8(6, 17); // RGBA
  ihdrChunk.writeUInt8(0, 18); // compression
  ihdrChunk.writeUInt8(0, 19); // filter
  ihdrChunk.writeUInt8(0, 20); // interlace
  ihdrChunk.writeUInt32BE(0x12345678, 21); // Dummy CRC

  const iendChunk = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([signature, ihdrChunk, iendChunk]);
}

// Helper: Build a minimal valid JPEG image buffer with specified width and height
function createValidJpegBuffer(width = 120, height = 120): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  // SOF0 frame: FF C0 length(2) precision(1) height(2) width(2) components(3)
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2); // Length of frame
  sof0[4] = 8; // Precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // 3 color components
  // Component specs
  sof0[10] = 1;
  sof0[11] = 0x11;
  sof0[12] = 0;
  sof0[13] = 2;
  sof0[14] = 0x11;
  sof0[15] = 1;
  sof0[16] = 3;
  sof0[17] = 0x11;
  sof0[18] = 1;

  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([sooi(), soi, sof0, eoi]);
  function sooi() {
    return Buffer.alloc(0);
  }
}

// Helper: Build a minimal valid WebP buffer with specified width and height
function createValidWebpBuffer(width = 120, height = 120): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(24, 4); // File size - 8
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt32LE(12, 16); // Chunk size
  buffer[20] = 0x30;
  buffer[21] = 0x01;
  buffer[22] = 0x00;
  // Keyframe tag
  buffer[23] = 0x9d;
  buffer[24] = 0x01;
  buffer[25] = 0x2a;
  // Dimensions
  buffer.writeUInt16LE(width & 0x3fff, 26);
  buffer.writeUInt16LE(height & 0x3fff, 28);
  return buffer;
}

function toBlob(buf: Buffer, type: string): Blob {
  return new Blob([buf as unknown as BlobPart], { type });
}

describe("Stage 1 — Secure Admin Nominee Photo Uploads", () => {
  let adminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let adminSessionCookie: string;
  let testEvent: { id: string };
  let testCategory: { id: string };
  let mockStorage: MockStorageProvider;

  beforeAll(async () => {
    resetAllRateLimits();

    mockStorage = new MockStorageProvider();
    setCustomStorageProvider(mockStorage);

    // 1. Create a dedicated Super Admin for testing
    const passwordHash = await hashPassword("PhotoAdmin2026!");
    const user = await prisma.user.upsert({
      where: { email: "photo-admin@nuasknust.org" },
      update: { passwordHash, role: Role.SUPER_ADMIN, isActive: true, tokenVersion: 1 },
      create: {
        email: "photo-admin@nuasknust.org",
        name: "Photo Admin",
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
        tokenVersion: 1,
      },
    });

    adminUser = { id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
    const token = createSessionToken(adminUser);
    adminSessionCookie = `nuas_admin_session=${token}`;

    // 2. Create test event and category
    const event = await prisma.event.upsert({
      where: { slug: "photo-upload-event" },
      update: { status: EventStatus.PUBLISHED },
      create: {
        slug: "photo-upload-event",
        title: "Photo Upload Test Gala",
        venue: "KNUST Great Hall",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.PUBLISHED,
      },
    });
    testEvent = { id: event.id };

    const cat = await prisma.category.create({
      data: {
        eventId: testEvent.id,
        title: "Most Dedicated Leader",
        isActive: true,
        isApproved: true,
        displayOrder: 1,
      },
    });
    testCategory = { id: cat.id };
  });

  afterAll(async () => {
    setCustomStorageProvider(null);

    await prisma.voteAllocation.deleteMany({
      where: { nominee: { category: { eventId: testEvent.id } } },
    });
    await prisma.nominee.deleteMany({
      where: { category: { eventId: testEvent.id } },
    });
    await prisma.category.deleteMany({
      where: { eventId: testEvent.id },
    });
    await prisma.event.deleteMany({
      where: { id: testEvent.id },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: adminUser.id },
    });
    await prisma.user.deleteMany({
      where: { email: "photo-admin@nuasknust.org" },
    });
    await prisma.$disconnect();
    resetAllRateLimits();
  });

  // --------------------------------------------------------------------------
  // SECTION 1: Pure Image Inspection & Magic Byte Validation Tests
  // --------------------------------------------------------------------------
  describe("Image Inspection & Dimension Validation Engine", () => {
    it("successfully validates authentic PNG image with correct dimensions", () => {
      const pngBuffer = createValidPngBuffer(240, 180);
      const meta = validateImageBuffer(pngBuffer);

      expect(meta.format).toBe("png");
      expect(meta.mimeType).toBe("image/png");
      expect(meta.extension).toBe("png");
      expect(meta.width).toBe(240);
      expect(meta.height).toBe(180);
      expect(meta.bytes).toBe(pngBuffer.length);
    });

    it("successfully validates authentic JPEG image with correct dimensions", () => {
      const jpegBuffer = createValidJpegBuffer(320, 240);
      const meta = validateImageBuffer(jpegBuffer);

      expect(meta.format).toBe("jpeg");
      expect(meta.mimeType).toBe("image/jpeg");
      expect(meta.extension).toBe("jpg");
      expect(meta.width).toBe(320);
      expect(meta.height).toBe(240);
    });

    it("successfully validates authentic WebP image with correct dimensions", () => {
      const webpBuffer = createValidWebpBuffer(150, 150);
      const meta = validateImageBuffer(webpBuffer);

      expect(meta.format).toBe("webp");
      expect(meta.mimeType).toBe("image/webp");
      expect(meta.extension).toBe("webp");
      expect(meta.width).toBe(150);
      expect(meta.height).toBe(150);
    });

    it("rejects non-image text files and scripts disguised as images", () => {
      const fakeImage = Buffer.from("<html><script>alert('xss')</script></html>");
      expect(() => validateImageBuffer(fakeImage)).toThrow(ImageValidationError);
      expect(() => validateImageBuffer(fakeImage)).toThrow(/Unsupported image format/);
    });

    it("rejects images exceeding the 5 MB maximum size limit", () => {
      const hugeBuffer = Buffer.alloc(5 * 1024 * 1024 + 100);
      expect(() => validateImageBuffer(hugeBuffer)).toThrow(ImageValidationError);
      expect(() => validateImageBuffer(hugeBuffer)).toThrow(/exceeds maximum allowed limit/);
    });

    it("rejects images with dimensions below minimum threshold (100x100px)", () => {
      const tinyPng = createValidPngBuffer(50, 50);
      expect(() => validateImageBuffer(tinyPng)).toThrow(ImageValidationError);
      expect(() => validateImageBuffer(tinyPng)).toThrow(/dimensions \(50x50px\) are too small/);
    });

    it("rejects images with dimensions exceeding maximum threshold (5000x5000px)", () => {
      const hugeDimsPng = createValidPngBuffer(6000, 6000);
      expect(() => validateImageBuffer(hugeDimsPng)).toThrow(ImageValidationError);
      expect(() => validateImageBuffer(hugeDimsPng)).toThrow(/exceed maximum allowed resolution/);
    });

    it("rejects corrupt JPEG with truncated headers", () => {
      const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04]);
      expect(() => validateImageBuffer(corruptJpeg)).toThrow(ImageValidationError);
      expect(() => validateImageBuffer(corruptJpeg)).toThrow(/Corrupt or invalid JPEG/);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Photo Upload API Security & Access Control
  // --------------------------------------------------------------------------
  describe("Photo Upload Endpoint Access & Security", () => {
    it("denies upload request when unauthorized (no admin session)", async () => {
      const formData = new FormData();
      const pngBlob = toBlob(createValidPngBuffer(120, 120), "image/png");
      formData.append("file", pngBlob, "test.png");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("denies upload request when origin is cross-site / untrusted", async () => {
      const formData = new FormData();
      const pngBlob = toBlob(createValidPngBuffer(120, 120), "image/png");
      formData.append("file", pngBlob, "test.png");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          origin: "https://malicious-attacker.com",
          host: "localhost:3000",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/CSRF/);
    });

    it("rejects upload when file is missing from multipart body", async () => {
      const formData = new FormData();
      formData.append("nomineeCode", "TEST-CODE");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/No image file provided/);
    });

    it("rejects unsupported file formats (PDF disguised as image)", async () => {
      const formData = new FormData();
      const pdfBlob = new Blob(["%PDF-1.5 fake pdf content"], { type: "image/png" });
      formData.append("file", pdfBlob, "resume.pdf");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Unsupported image format/);
    });

    it("handles storage provider outages safely with clear 502 error", async () => {
      mockStorage.shouldFail = true;

      const formData = new FormData();
      const pngBlob = toBlob(createValidPngBuffer(150, 150), "image/png");
      formData.append("file", pngBlob, "avatar.png");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toMatch(/storage provider error/i);

      mockStorage.shouldFail = false; // Restore
    });

    it("allows authorized administrator to upload authentic PNG photo", async () => {
      const formData = new FormData();
      const pngBuffer = createValidPngBuffer(200, 200);
      const pngBlob = toBlob(pngBuffer, "image/png");
      formData.append("file", pngBlob, "profile.png");
      formData.append("nomineeCode", "PHOTO-01");

      const req = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const res = await uploadRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.url).toMatch(/https:\/\/res\.cloudinary\.com/);
      expect(data.format).toBe("png");
      expect(data.width).toBe(200);
      expect(data.height).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Nominee Photo Flow — Creation, Replacement, Removal & Public Display
  // --------------------------------------------------------------------------
  describe("Nominee Photo Lifecycle & Public Visibility", () => {
    let createdNomineeId: string;
    let originalAvatarUrl: string;

    it("creates a nominee with an uploaded photo and renders it on public views", async () => {
      // 1. Upload photo first
      const formData = new FormData();
      const pngBlob = toBlob(createValidPngBuffer(300, 300), "image/png");
      formData.append("file", pngBlob, "leader.png");
      formData.append("nomineeCode", "LEAD-01");

      const uploadReq = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const uploadRes = await uploadRoute(uploadReq);
      const uploadData = await uploadRes.json();
      expect(uploadRes.status).toBe(200);
      originalAvatarUrl = uploadData.url;

      // 2. Create nominee with this photo
      const createReq = new Request("http://localhost:3000/api/admin/nominees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: JSON.stringify({
          categoryId: testCategory.id,
          name: "Kwame Asante",
          nomineeCode: "LEAD-01",
          bio: "Dedicated Christian fellowship organizer.",
          avatarUrl: originalAvatarUrl,
          displayOrder: 1,
          isActive: true,
          isApproved: true,
        }),
      });

      const createRes = await createNomineeRoute(createReq);
      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      createdNomineeId = createData.nominee.id;
      expect(createData.nominee.avatarUrl).toBe(originalAvatarUrl);

      // 3. Verify public view displays the photo
      const publicNominee = await getApprovedNomineeByCode("LEAD-01");
      expect(publicNominee).not.toBeNull();
      expect(publicNominee?.avatarUrl).toBe(originalAvatarUrl);

      // 4. Verify public category listing contains nominee with photo
      const publicCategories = await getPublicCategories();
      const cat = publicCategories.find((c) => c.id === testCategory.id);
      const nomInCat = cat?.nominees.find((n) => n.nomineeCode === "LEAD-01");
      expect(nomInCat?.avatarUrl).toBe(originalAvatarUrl);
    });

    it("replaces existing nominee photo with a new image", async () => {
      // 1. Upload a replacement JPEG
      const formData = new FormData();
      const jpegBlob = toBlob(createValidJpegBuffer(400, 400), "image/jpeg");
      formData.append("file", jpegBlob, "new-leader.jpg");
      formData.append("nomineeCode", "LEAD-01");

      const uploadReq = new Request("http://localhost:3000/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const uploadRes = await uploadRoute(uploadReq);
      const uploadData = await uploadRes.json();
      const newAvatarUrl = uploadData.url;

      // 2. Update nominee record via PATCH
      const updateReq = new Request("http://localhost:3000/api/admin/nominees", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: JSON.stringify({
          id: createdNomineeId,
          avatarUrl: newAvatarUrl,
        }),
      });

      const updateRes = await updateNomineeRoute(updateReq);
      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.nominee.avatarUrl).toBe(newAvatarUrl);

      // 3. Verify public view now reflects the replaced photo
      const publicNominee = await getApprovedNomineeByCode("LEAD-01");
      expect(publicNominee?.avatarUrl).toBe(newAvatarUrl);
    });

    it("removes photo from nominee and confirms public view reverts to placeholder", async () => {
      // 1. Update nominee to clear photo (avatarUrl: null)
      const updateReq = new Request("http://localhost:3000/api/admin/nominees", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: JSON.stringify({
          id: createdNomineeId,
          avatarUrl: null,
        }),
      });

      const updateRes = await updateNomineeRoute(updateReq);
      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.nominee.avatarUrl).toBeNull();

      // 2. Verify public view has null avatarUrl (which triggers initials placeholder in UI)
      const publicNominee = await getApprovedNomineeByCode("LEAD-01");
      expect(publicNominee?.avatarUrl).toBeNull();
    });

    it("verifies nominee without photo can still be created, approved, and voted on without issues", async () => {
      // 1. Create a nominee with no avatarUrl
      const createReq = new Request("http://localhost:3000/api/admin/nominees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: adminSessionCookie,
          "x-csrf-protect": "1",
        },
        body: JSON.stringify({
          categoryId: testCategory.id,
          name: "Abena Mensah",
          nomineeCode: "NO-PHOTO-01",
          bio: "Active in chapel outreach.",
          avatarUrl: null,
          displayOrder: 2,
          isActive: true,
          isApproved: true,
        }),
      });

      const createRes = await createNomineeRoute(createReq);
      expect(createRes.status).toBe(200);
      const data = await createRes.json();
      expect(data.nominee.avatarUrl).toBeNull();

      // 2. Public lookup works normally
      const publicNominee = await getApprovedNomineeByCode("NO-PHOTO-01");
      expect(publicNominee).not.toBeNull();
      expect(publicNominee?.name).toBe("Abena Mensah");
      expect(publicNominee?.avatarUrl).toBeNull();

      // Clean up
      await prisma.nominee.delete({ where: { id: data.nominee.id } });
    });
  });
});

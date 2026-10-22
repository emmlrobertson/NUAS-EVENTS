import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role, EventStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { POST as loginRoute } from "../src/app/api/admin/auth/login/route";
import { POST as publishRoute } from "../src/app/api/admin/event/publish/route";
import { POST as categoryRoute } from "../src/app/api/admin/categories/route";
import { POST as nomineeRoute } from "../src/app/api/admin/nominees/route";
import { hashPassword } from "../src/lib/auth/password";
import { createSessionToken } from "../src/lib/auth/session";

describe("Admin Content Management & Authorization", () => {
  let adminUser: { id: string; email: string; role: Role };
  let testEvent: { id: string; status: EventStatus };
  let adminSessionCookie: string;

  beforeAll(async () => {
    // 1. Create a dedicated test admin user
    const passwordHash = await hashPassword("TestAdminPassword2026!");
    const user = await prisma.user.upsert({
      where: { email: "content-admin@nuasknust.org" },
      update: { passwordHash, role: Role.SUPER_ADMIN, isActive: true },
      create: {
        email: "content-admin@nuasknust.org",
        name: "Content Admin",
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });

    adminUser = { id: user.id, email: user.email, role: user.role };
    const token = createSessionToken(adminUser);
    adminSessionCookie = `nuas_admin_session=${token}`;

    // 2. Create a test event for management
    const event = await prisma.event.upsert({
      where: { slug: "admin-mgmt-event" },
      update: { status: EventStatus.DRAFT },
      create: {
        slug: "admin-mgmt-event",
        title: "[TEST] Admin Management Event",
        venue: "KNUST Campus",
        eventDate: new Date("2026-11-21T18:00:00Z"),
        votingStartDate: new Date("2026-11-01T00:00:00Z"),
        votingEndDate: new Date("2026-11-21T17:00:00Z"),
        status: EventStatus.DRAFT,
      },
    });
    testEvent = { id: event.id, status: event.status };
  });

  afterAll(async () => {
    await prisma.nominee.deleteMany({
      where: { nomineeCode: { in: ["TEST-CODE-01", "TEST-CODE-DUP"] } },
    });
    await prisma.category.deleteMany({
      where: { title: "Admin Created Category" },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: adminUser.id },
    });
    await prisma.event.deleteMany({
      where: { slug: "admin-mgmt-event" },
    });
    await prisma.user.deleteMany({
      where: { email: "content-admin@nuasknust.org" },
    });
    await prisma.$disconnect();
  });

  it("rejects login with incorrect password", async () => {
    const request = new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "content-admin@nuasknust.org",
        password: "WrongPassword!",
      }),
    });

    const response = await loginRoute(request);
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toContain("Invalid email or password");
  });

  it("authenticates valid admin and issues session cookie", async () => {
    const request = new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "content-admin@nuasknust.org",
        password: "TestAdminPassword2026!",
      }),
    });

    const response = await loginRoute(request);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("nuas_admin_session=");

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.user.email).toBe("content-admin@nuasknust.org");
    expect(data.user.role).toBe(Role.SUPER_ADMIN);
  });

  it("rejects unauthenticated attempts to publish event", async () => {
    const request = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: testEvent.id,
        status: EventStatus.PUBLISHED,
      }),
    });

    const response = await publishRoute(request);
    expect(response.status).toBe(401);
  });

  it("allows authenticated admin to publish event and records AuditLog", async () => {
    const request = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        id: testEvent.id,
        status: EventStatus.PUBLISHED,
      }),
    });

    const response = await publishRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.event.status).toBe(EventStatus.PUBLISHED);

    // Verify audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: adminUser.id,
        action: "CHANGE_EVENT_STATUS",
        entityId: testEvent.id,
      },
    });
    expect(auditLog).toBeDefined();
    expect(auditLog!.action).toBe("CHANGE_EVENT_STATUS");
  });

  it("creates category under event and logs audit entry", async () => {
    const request = new Request("http://localhost:3000/api/admin/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        eventId: testEvent.id,
        title: "Admin Created Category",
        description: "Official award category",
        displayOrder: 1,
        isActive: true,
      }),
    });

    const response = await categoryRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.category.title).toBe("Admin Created Category");

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: adminUser.id,
        action: "CREATE_CATEGORY",
        entityId: data.category.id,
      },
    });
    expect(auditLog).toBeDefined();
  });

  it("rejects duplicate nomineeCode with 409 Conflict", async () => {
    const category = await prisma.category.findFirst({
      where: { title: "Admin Created Category" },
    });
    expect(category).toBeDefined();

    // First nominee
    const req1 = new Request("http://localhost:3000/api/admin/nominees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        categoryId: category!.id,
        name: "First Nominee",
        nomineeCode: "TEST-CODE-DUP",
        isActive: true,
      }),
    });
    const res1 = await nomineeRoute(req1);
    expect(res1.status).toBe(200);

    // Second nominee with SAME code
    const req2 = new Request("http://localhost:3000/api/admin/nominees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        categoryId: category!.id,
        name: "Second Nominee",
        nomineeCode: "TEST-CODE-DUP", // Duplicate code!
        isActive: true,
      }),
    });
    const res2 = await nomineeRoute(req2);
    expect(res2.status).toBe(409);

    const data2 = await res2.json();
    expect(data2.error).toContain("is already in use");
  });
});

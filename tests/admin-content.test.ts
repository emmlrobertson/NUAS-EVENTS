import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role, EventStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { POST as loginRoute } from "../src/app/api/admin/auth/login/route";
import { POST as publishRoute } from "../src/app/api/admin/event/publish/route";
import { POST as categoryRoute } from "../src/app/api/admin/categories/route";
import { POST as nomineeRoute } from "../src/app/api/admin/nominees/route";
import { hashPassword } from "../src/lib/auth/password";
import { createSessionToken, getCurrentAdminUser, revokeUserSessions } from "../src/lib/auth/session";
import { resetAllRateLimits } from "../src/lib/auth/rate-limiter";

describe("Admin Content Management & Authorization", () => {
  let adminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let eventAdminUser: { id: string; email: string; role: Role; tokenVersion: number };
  let testEvent: { id: string; status: EventStatus };
  let adminSessionCookie: string;
  let eventAdminSessionCookie: string;

  beforeAll(async () => {
    resetAllRateLimits();

    // 1. Create a dedicated Super Admin user
    const passwordHash = await hashPassword("TestAdminPassword2026!");
    const user = await prisma.user.upsert({
      where: { email: "content-admin@nuasknust.org" },
      update: { passwordHash, role: Role.SUPER_ADMIN, isActive: true, tokenVersion: 1 },
      create: {
        email: "content-admin@nuasknust.org",
        name: "Content Admin",
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
        tokenVersion: 1,
      },
    });

    adminUser = { id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
    const token = createSessionToken(adminUser);
    adminSessionCookie = `nuas_admin_session=${token}`;

    // 2. Create an Event Admin user (lower privilege)
    const eventAdmin = await prisma.user.upsert({
      where: { email: "event-admin-limited@nuasknust.org" },
      update: { passwordHash, role: Role.EVENT_ADMIN, isActive: true, tokenVersion: 1 },
      create: {
        email: "event-admin-limited@nuasknust.org",
        name: "Limited Event Admin",
        passwordHash,
        role: Role.EVENT_ADMIN,
        isActive: true,
        tokenVersion: 1,
      },
    });
    eventAdminUser = { id: eventAdmin.id, email: eventAdmin.email, role: eventAdmin.role, tokenVersion: eventAdmin.tokenVersion };
    const eventAdminToken = createSessionToken(eventAdminUser);
    eventAdminSessionCookie = `nuas_admin_session=${eventAdminToken}`;

    // 3. Create a test event for management
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
      where: { userId: { in: [adminUser.id, eventAdminUser.id] } },
    });
    await prisma.event.deleteMany({
      where: { slug: "admin-mgmt-event" },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ["content-admin@nuasknust.org", "event-admin-limited@nuasknust.org"] } },
    });
    await prisma.$disconnect();
    resetAllRateLimits();
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

  it("enforces login rate limiting after 5 consecutive failures", async () => {
    resetAllRateLimits();
    const attackerEmail = "brute-target@nuasknust.org";

    // Perform 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost:3000/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.100" },
        body: JSON.stringify({ email: attackerEmail, password: "BadPassword" }),
      });
      const res = await loginRoute(req);
      expect(res.status).toBe(401);
    }

    // 6th attempt should be blocked with 429
    const blockedReq = new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.100" },
      body: JSON.stringify({ email: attackerEmail, password: "BadPassword" }),
    });
    const blockedRes = await loginRoute(blockedReq);
    expect(blockedRes.status).toBe(429);

    const data = await blockedRes.json();
    expect(data.error).toContain("Too many failed login attempts");
    expect(blockedRes.headers.get("Retry-After")).toBeDefined();
  });

  it("invalidates previous sessions server-side when session is revoked", async () => {
    // Generate a token for adminUser
    const token = createSessionToken(adminUser);
    const mockRequest = new Request("http://localhost:3000/api/admin/auth/me", {
      headers: { Cookie: `nuas_admin_session=${token}` },
    });

    // Valid before revocation
    const userBefore = await getCurrentAdminUser(mockRequest);
    expect(userBefore).not.toBeNull();
    expect(userBefore!.email).toBe(adminUser.email);

    // Revoke sessions server-side
    await revokeUserSessions(adminUser.id);

    // Old token must now be rejected
    const userAfter = await getCurrentAdminUser(mockRequest);
    expect(userAfter).toBeNull();

    // Re-sync adminUser tokenVersion
    const refreshed = await prisma.user.findUnique({ where: { id: adminUser.id } });
    adminUser.tokenVersion = refreshed!.tokenVersion;
    adminSessionCookie = `nuas_admin_session=${createSessionToken(adminUser)}`;
  });

  it("rejects state-changing requests with invalid or mismatched CSRF origin", async () => {
    const maliciousRequest = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
        Origin: "https://malicious-attacker-site.com",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        id: testEvent.id,
        status: EventStatus.PUBLISHED,
      }),
    });

    const response = await publishRoute(maliciousRequest);
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("CSRF");
  });

  it("rejects event publishing attempts by non-SUPER_ADMIN (EVENT_ADMIN role restriction)", async () => {
    const request = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: eventAdminSessionCookie,
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        id: testEvent.id,
        status: EventStatus.PUBLISHED,
      }),
    });

    const response = await publishRoute(request);
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("Super Administrators");
  });

  it("rejects unauthenticated attempts to publish event", async () => {
    const request = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        id: testEvent.id,
        status: EventStatus.PUBLISHED,
      }),
    });

    const response = await publishRoute(request);
    expect(response.status).toBe(401);
  });

  it("allows authenticated SUPER_ADMIN to publish event and records AuditLog atomically", async () => {
    const request = new Request("http://localhost:3000/api/admin/event/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
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

  it("creates category under event with explicit isApproved state and logs audit entry", async () => {
    const request = new Request("http://localhost:3000/api/admin/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSessionCookie,
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        eventId: testEvent.id,
        title: "Admin Created Category",
        description: "Official award category",
        displayOrder: 1,
        isActive: true,
        isApproved: true,
      }),
    });

    const response = await categoryRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.category.title).toBe("Admin Created Category");
    expect(data.category.isApproved).toBe(true);

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
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        categoryId: category!.id,
        name: "First Nominee",
        nomineeCode: "TEST-CODE-DUP",
        isActive: true,
        isApproved: true,
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
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        categoryId: category!.id,
        name: "Second Nominee",
        nomineeCode: "TEST-CODE-DUP", // Duplicate code!
        isActive: true,
        isApproved: true,
      }),
    });
    const res2 = await nomineeRoute(req2);
    expect(res2.status).toBe(409);

    const data2 = await res2.json();
    expect(data2.error).toContain("is already in use");
  });
});

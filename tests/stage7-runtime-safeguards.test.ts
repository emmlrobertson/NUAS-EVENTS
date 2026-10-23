import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role, OrderStatus, TicketStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  getEnv,
  validateEnv,
  validateRuntimeEnv,
  resetParsedEnv,
} from "../src/lib/env";
import {
  extractClientIp,
  getClientIp,
} from "../src/lib/security/client-ip";
import {
  checkCheckoutRateLimit,
  checkOrderStatusRateLimit,
  checkSandboxSimulateRateLimit,
  resetOrderStatusRateLimits,
  createRateLimiter,
} from "../src/lib/voting/rate-limiter";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
  resetAllRateLimits,
} from "../src/lib/auth/rate-limiter";
import { POST as loginPost } from "../src/app/api/admin/auth/login/route";
import { POST as checkoutPost } from "../src/app/api/voting/checkout/route";
import { POST as sandboxPost } from "../src/app/api/voting/sandbox/simulate/route";
import { GET as orderStatusGet } from "../src/app/api/voting/orders/[orderNumber]/route";
import { runDevelopmentSeed } from "../prisma/seed";
import { hashPassword } from "../src/lib/auth/password";
import { NextRequest } from "next/server";

describe("Stage 7 — Runtime Configuration, Trusted IPs & Schema Safeguards", () => {
  beforeAll(async () => {
    resetAllRateLimits();
    resetOrderStatusRateLimits();
    resetParsedEnv();
  });

  afterAll(async () => {
    resetAllRateLimits();
    resetOrderStatusRateLimits();
    resetParsedEnv();
  });

  // =========================================================================
  // TASK 1: Runtime Environment Configuration & Fail-Closed Guards
  // =========================================================================
  describe("Task 1 — Runtime Environment Validation & Fail-Closed Production Guards", () => {
    it("parses boolean environment variables consistently across true/1 and false/0", () => {
      // "1" and "true" parse to boolean true
      const trueConfig = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
        SESSION_SECRET: "dev-session-secret-for-testing-purposes",
        ENABLE_LIVE_PAYMENTS: "1",
        PAYMENT_PROVIDER: "PAYSTACK",
        PAYSTACK_SECRET_KEY: "sk_test_1234567890",
        ALLOW_TEST_SEEDING: "true",
        TRUST_PROXY: "1",
      };
      const envTrue = validateEnv(trueConfig);
      expect(envTrue.ENABLE_LIVE_PAYMENTS).toBe(true);
      expect(envTrue.ALLOW_TEST_SEEDING).toBe(true);
      expect(envTrue.TRUST_PROXY).toBe(true);

      // "0" and "false" parse to boolean false
      const falseConfig = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
        SESSION_SECRET: "dev-session-secret-for-testing-purposes",
        ENABLE_LIVE_PAYMENTS: "0",
        ALLOW_TEST_SEEDING: "false",
        TRUST_PROXY: "0",
      };
      const envFalse = validateEnv(falseConfig);
      expect(envFalse.ENABLE_LIVE_PAYMENTS).toBe(false);
      expect(envFalse.ALLOW_TEST_SEEDING).toBe(false);
      expect(envFalse.TRUST_PROXY).toBe(false);
    });

    it("rejects non-boolean string values strictly", () => {
      const invalidConfig = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
        SESSION_SECRET: "dev-session-secret-for-testing-purposes",
        TRUST_PROXY: "maybe",
      };
      expect(() => validateEnv(invalidConfig)).toThrowError(/Invalid boolean value/);
    });

    it("fails closed in production if SESSION_SECRET is too short (< 32 chars)", () => {
      const shortSecretProd = {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
        SESSION_SECRET: "short-secret",
        PAYMENT_WEBHOOK_SECRET: "production-webhook-secret-with-at-least-32-chars!",
        ALLOW_TEST_SEEDING: "false",
      };
      expect(() => validateEnv(shortSecretProd)).toThrowError(
        /SESSION_SECRET must be at least 32 characters long in production/
      );
    });

    it("fails closed in production if ALLOW_TEST_SEEDING is enabled", () => {
      const seedProd = {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
        SESSION_SECRET: "production-secure-session-key-with-at-least-32-characters!",
        PAYMENT_WEBHOOK_SECRET: "production-webhook-secret-with-at-least-32-chars!",
        ALLOW_TEST_SEEDING: "true",
      };
      expect(() => validateEnv(seedProd)).toThrowError(
        /ALLOW_TEST_SEEDING must be set to false/
      );
    });

    it("prevents test seeding from executing in production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.PAYMENT_WEBHOOK_SECRET;
      const originalSeeding = process.env.ALLOW_TEST_SEEDING;
      const envObj = process.env as Record<string, string | undefined>;
      try {
        envObj.NODE_ENV = "production";
        process.env.PAYMENT_WEBHOOK_SECRET = "a_secure_production_secret_with_32_plus_chars";
        process.env.ALLOW_TEST_SEEDING = "false";
        resetParsedEnv();

        await expect(runDevelopmentSeed()).rejects.toThrowError(
          /Development seed script cannot run in production/
        );
      } finally {
        envObj.NODE_ENV = originalNodeEnv;
        process.env.PAYMENT_WEBHOOK_SECRET = originalSecret;
        process.env.ALLOW_TEST_SEEDING = originalSeeding;
        resetParsedEnv();
      }
    });

    it("disables sandbox simulation in production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.PAYMENT_WEBHOOK_SECRET;
      const originalSeeding = process.env.ALLOW_TEST_SEEDING;
      const envObj = process.env as Record<string, string | undefined>;
      try {
        envObj.NODE_ENV = "production";
        process.env.PAYMENT_WEBHOOK_SECRET = "a_secure_production_secret_with_32_plus_chars";
        process.env.ALLOW_TEST_SEEDING = "false";
        resetParsedEnv();

        const req = new NextRequest("http://localhost:3000/api/voting/sandbox/simulate", {
          method: "POST",
          headers: new Headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ orderNumber: "ORDER-TEST-001" }),
        });

        const res = await sandboxPost(req);
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toMatch(/Sandbox simulation is strictly disabled in production/i);
        expect(res.headers.get("Cache-Control")).toBe("no-store, max-age=0");
      } finally {
        envObj.NODE_ENV = originalNodeEnv;
        process.env.PAYMENT_WEBHOOK_SECRET = originalSecret;
        process.env.ALLOW_TEST_SEEDING = originalSeeding;
        resetParsedEnv();
      }
    });
  });

  // =========================================================================
  // TASK 2: Shared Client IP Policy & Multi-Endpoint Rate Limiting
  // =========================================================================
  describe("Task 2 — Unified Trusted Client-IP Policy & Rate Limiting", () => {
    beforeAll(() => {
      resetOrderStatusRateLimits();
      resetAllRateLimits();
    });

    it("ignores spoofed X-Forwarded-For, X-Real-IP, and CF-Connecting-IP when trustProxy is false", () => {
      const spoofedReq = {
        headers: new Headers({
          "x-forwarded-for": "203.0.113.195, 198.51.100.1",
          "x-real-ip": "203.0.113.195",
          "cf-connecting-ip": "203.0.113.195",
        }),
      };

      const result = extractClientIp(spoofedReq, { trustProxy: false });
      expect(result.isTrusted).toBe(false);
      expect(result.ip).toBe("unknown-client");
      expect(result.source).toBe("unknown");
      expect(result.ip).not.toBe("203.0.113.195");
      expect(result.ip).not.toBe("127.0.0.1"); // Does NOT silently default to 127.0.0.1
    });

    it("trusts socket IP when available under untrusted proxy mode", () => {
      const socketReq = {
        headers: new Headers({
          "x-forwarded-for": "spoofed-ip",
        }),
        ip: "10.0.0.42",
      };

      const result = extractClientIp(socketReq, { trustProxy: false });
      expect(result.isTrusted).toBe(true);
      expect(result.ip).toBe("10.0.0.42");
      expect(result.source).toBe("socket");
    });

    it("evaluates proxy headers in strict priority order when trustProxy is true", () => {
      // 1. CF-Connecting-IP takes highest priority
      const cfReq = {
        headers: new Headers({
          "cf-connecting-ip": "1.1.1.1",
          "x-real-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3, 4.4.4.4",
        }),
      };
      const cfResult = extractClientIp(cfReq, { trustProxy: true });
      expect(cfResult.ip).toBe("1.1.1.1");
      expect(cfResult.source).toBe("cf-connecting-ip");

      // 2. X-Real-IP is used when CF header is absent
      const xRealReq = {
        headers: new Headers({
          "x-real-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3, 4.4.4.4",
        }),
      };
      const xRealResult = extractClientIp(xRealReq, { trustProxy: true });
      expect(xRealResult.ip).toBe("2.2.2.2");
      expect(xRealResult.source).toBe("x-real-ip");

      // 3. Leftmost X-Forwarded-For is used when X-Real-IP is absent
      const xffReq = {
        headers: new Headers({
          "x-forwarded-for": "3.3.3.3, 4.4.4.4",
        }),
      };
      const xffResult = extractClientIp(xffReq, { trustProxy: true });
      expect(xffResult.ip).toBe("3.3.3.3");
      expect(xffResult.source).toBe("x-forwarded-for");
    });

    it("enforces sandbox simulation rate limit (10 requests per minute)", () => {
      const testIp = "172.16.0.5";
      for (let i = 0; i < 10; i++) {
        const check = checkSandboxSimulateRateLimit(testIp);
        expect(check.allowed).toBe(true);
      }

      const throttled = checkSandboxSimulateRateLimit(testIp);
      expect(throttled.allowed).toBe(false);
      expect(throttled.remaining).toBe(0);
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("enforces checkout rate limit (20 requests per minute)", () => {
      const testIp = "172.16.0.6";
      for (let i = 0; i < 20; i++) {
        const check = checkCheckoutRateLimit(testIp);
        expect(check.allowed).toBe(true);
      }

      const throttled = checkCheckoutRateLimit(testIp);
      expect(throttled.allowed).toBe(false);
      expect(throttled.remaining).toBe(0);
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("enforces admin login brute-force rate limit (5 attempts per 15 minutes)", () => {
      const loginKey = "172.16.0.7:admin@nuasknust.org";
      clearLoginRateLimit(loginKey);

      for (let i = 0; i < 4; i++) {
        recordFailedLoginAttempt(loginKey);
        const check = checkLoginRateLimit(loginKey);
        expect(check.allowed).toBe(true);
      }

      // 5th failed attempt locks out
      recordFailedLoginAttempt(loginKey);
      const locked = checkLoginRateLimit(loginKey);
      expect(locked.allowed).toBe(false);
      expect(locked.remainingAttempts).toBe(0);
      expect(locked.retryAfterSeconds).toBeGreaterThan(0);

      clearLoginRateLimit(loginKey);
    });

    it("admin login route returns 429 with Retry-After and no-store headers when throttled", async () => {
      const ip = "172.16.0.8";
      const email = "lockout-test@nuasknust.org";
      const key = `${ip}:${email}`;

      for (let i = 0; i < 5; i++) {
        recordFailedLoginAttempt(key);
      }

      const req = new Request("http://localhost:3000/api/admin/auth/login", {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
          "x-real-ip": ip,
        }),
        body: JSON.stringify({ email, password: "WrongPassword123!" }),
      });

      // When trustProxy: true, client IP matches locked IP
      const originalTrust = process.env.TRUST_PROXY;
      try {
        process.env.TRUST_PROXY = "true";
        resetParsedEnv();

        const res = await loginPost(req);
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBeDefined();
        expect(res.headers.get("Cache-Control")).toBe("no-store, max-age=0");
      } finally {
        process.env.TRUST_PROXY = originalTrust;
        resetParsedEnv();
        clearLoginRateLimit(key);
      }
    });

    it("demonstrates process-local isolation of in-memory rate limits across independent instances", () => {
      // Simulating Worker A and Worker B (e.g. separate serverless or container instances)
      const instanceA = createRateLimiter({ maxRequests: 3, windowMs: 60000 });
      const instanceB = createRateLimiter({ maxRequests: 3, windowMs: 60000 });
      const client = "198.51.100.25";

      expect(instanceA.check(client).allowed).toBe(true);
      expect(instanceA.check(client).allowed).toBe(true);
      expect(instanceA.check(client).allowed).toBe(true);
      expect(instanceA.check(client).allowed).toBe(false); // Instance A throttled

      // Instance B maintains independent local memory, demonstrating why multi-instance
      // production deployments require a shared store (e.g. Redis)
      expect(instanceB.check(client).allowed).toBe(true);
    });
  });

  // =========================================================================
  // TASK 3: CheckIn Database Safeguard (One Check-In Per Issued Ticket)
  // =========================================================================
  describe("Task 3 — CheckIn Database Safeguard", () => {
    let testStaffId: string;
    let testTicketOrderId: string;
    let testTicketTypeId: string;
    let testEventId: string;

    beforeAll(async () => {
      // Clean up previous test artifacts
      await prisma.checkIn.deleteMany({
        where: { issuedTicket: { ticketNumber: { startsWith: "STAGE7-TKT-" } } },
      });
      await prisma.issuedTicket.deleteMany({
        where: { ticketNumber: { startsWith: "STAGE7-TKT-" } },
      });
      await prisma.ticketOrder.deleteMany({
        where: { orderNumber: { startsWith: "STAGE7-ORD-" } },
      });
      await prisma.ticketType.deleteMany({
        where: { name: "Stage 7 VIP Test" },
      });
      await prisma.event.deleteMany({
        where: { slug: "stage7-checkin-event" },
      });
      await prisma.user.deleteMany({
        where: { email: "stage7-staff@nuasknust.org" },
      });

      // 1. Create staff user
      const passwordHash = await hashPassword("StaffPassSecure2026!");
      const staff = await prisma.user.create({
        data: {
          email: "stage7-staff@nuasknust.org",
          name: "Stage 7 Gate Staff",
          passwordHash,
          role: Role.EVENT_ADMIN,
          isActive: true,
          tokenVersion: 1,
        },
      });
      testStaffId = staff.id;

      // 2. Create test event
      const event = await prisma.event.create({
        data: {
          slug: "stage7-checkin-event",
          title: "Stage 7 Gate Checkin Gala",
          venue: "Great Hall, KNUST",
          eventDate: new Date("2026-11-21T18:00:00Z"),
          votingStartDate: new Date("2026-10-01T00:00:00Z"),
          votingEndDate: new Date("2026-11-20T23:59:59Z"),
          latePaymentGraceMinutes: 0,
        },
      });
      testEventId = event.id;

      // 3. Create ticket type
      const ticketType = await prisma.ticketType.create({
        data: {
          eventId: testEventId,
          name: "Stage 7 VIP Test",
          priceInPesewas: 10000,
          totalCapacity: 50,
          salesStart: new Date("2026-10-01T00:00:00Z"),
          salesEnd: new Date("2026-11-20T00:00:00Z"),
        },
      });
      testTicketTypeId = ticketType.id;

      // 4. Create ticket order
      const order = await prisma.ticketOrder.create({
        data: {
          eventId: testEventId,
          orderNumber: `STAGE7-ORD-${Date.now()}`,
          buyerName: "Attendee One",
          buyerEmail: "attendee@example.com",
          buyerPhone: "0240000099",
          totalAmountInPesewas: 10000,
          status: OrderStatus.PAID,
          reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      testTicketOrderId = order.id;
    });

    afterAll(async () => {
      await prisma.checkIn.deleteMany({
        where: { issuedTicket: { ticketNumber: { startsWith: "STAGE7-TKT-" } } },
      });
      await prisma.issuedTicket.deleteMany({
        where: { ticketNumber: { startsWith: "STAGE7-TKT-" } },
      });
      await prisma.ticketOrder.deleteMany({
        where: { orderNumber: { startsWith: "STAGE7-ORD-" } },
      });
      await prisma.ticketType.deleteMany({
        where: { id: testTicketTypeId },
      });
      await prisma.event.deleteMany({
        where: { id: testEventId },
      });
      await prisma.user.deleteMany({
        where: { id: testStaffId },
      });
    });

    it("allows the initial check-in record for an issued ticket", async () => {
      const ticket = await prisma.issuedTicket.create({
        data: {
          ticketNumber: "STAGE7-TKT-001",
          ticketOrderId: testTicketOrderId,
          ticketTypeId: testTicketTypeId,
          attendeeName: "Attendee Alpha",
          qrSecurityHash: "hash-stage7-001",
          status: TicketStatus.ISSUED,
        },
      });

      const checkIn = await prisma.checkIn.create({
        data: {
          issuedTicketId: ticket.id,
          scannedById: testStaffId,
          gateLocation: "Main Gate Hall",
        },
      });

      expect(checkIn.id).toBeDefined();
      expect(checkIn.issuedTicketId).toBe(ticket.id);
    });

    it("enforces database-level unique constraint preventing duplicate check-ins for the same ticket", async () => {
      const ticket = await prisma.issuedTicket.create({
        data: {
          ticketNumber: "STAGE7-TKT-002",
          ticketOrderId: testTicketOrderId,
          ticketTypeId: testTicketTypeId,
          attendeeName: "Attendee Beta",
          qrSecurityHash: "hash-stage7-002",
          status: TicketStatus.ISSUED,
        },
      });

      // 1. Initial scan: creates check-in record
      await prisma.checkIn.create({
        data: {
          issuedTicketId: ticket.id,
          scannedById: testStaffId,
          gateLocation: "Main Gate Hall",
        },
      });

      // 2. Duplicate scan attempt: must be rejected by PostgreSQL unique constraint
      await expect(
        prisma.checkIn.create({
          data: {
            issuedTicketId: ticket.id,
            scannedById: testStaffId,
            gateLocation: "East Door",
          },
        })
      ).rejects.toThrowError();
    });
  });
});

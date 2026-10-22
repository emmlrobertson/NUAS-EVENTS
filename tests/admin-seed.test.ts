import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { bootstrapAdmin } from "../scripts/seed-admin";
import { verifyPassword } from "../src/lib/auth/password";

describe("Administrator Bootstrap Idempotency", () => {
  const testAdminEmail = "unit-test-admin@nuasknust.org";
  const initialPassword = "FirstSecurePassword123!";
  const secondPassword = "AttemptedOverwritePassword456!";

  beforeAll(async () => {
    // Clean up test admin if exists in test DB
    await prisma.auditLog.deleteMany({
      where: { entity: "User" },
    });
    await prisma.user.deleteMany({
      where: { email: testAdminEmail },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entity: "User" },
    });
    await prisma.user.deleteMany({
      where: { email: testAdminEmail },
    });
    await prisma.$disconnect();
  });

  it("creates a new Super Administrator on the initial run", async () => {
    const result = await bootstrapAdmin({
      email: testAdminEmail,
      name: "Unit Test Admin",
      password: initialPassword,
      forceReset: false,
      prismaClient: prisma,
    });

    expect(result.status).toBe("CREATED");
    expect(result.user.email).toBe(testAdminEmail);
    expect(result.user.role).toBe(Role.SUPER_ADMIN);

    const userInDb = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });
    expect(userInDb).toBeDefined();
    const isValid = await verifyPassword(initialPassword, userInDb!.passwordHash);
    expect(isValid).toBe(true);
  });

  it("safely skips overwriting existing password on repeated runs", async () => {
    const result = await bootstrapAdmin({
      email: testAdminEmail,
      name: "Unit Test Admin",
      password: secondPassword,
      forceReset: false,
      prismaClient: prisma,
    });

    expect(result.status).toBe("SKIPPED_EXISTING");

    // Verify password was NOT changed to secondPassword
    const userInDb = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });
    const stillOriginal = await verifyPassword(initialPassword, userInDb!.passwordHash);
    expect(stillOriginal).toBe(true);

    const secondPasswordRejected = await verifyPassword(secondPassword, userInDb!.passwordHash);
    expect(secondPasswordRejected).toBe(false);
  });

  it("allows password overwrite only when forceReset is explicitly true", async () => {
    const result = await bootstrapAdmin({
      email: testAdminEmail,
      name: "Unit Test Admin",
      password: secondPassword,
      forceReset: true,
      prismaClient: prisma,
    });

    expect(result.status).toBe("UPDATED");

    const userInDb = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });
    const newPasswordValid = await verifyPassword(secondPassword, userInDb!.passwordHash);
    expect(newPasswordValid).toBe(true);
  });
});

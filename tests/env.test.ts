import { describe, it, expect } from "vitest";
import { validateEnv } from "../src/lib/env";

describe("Environment Validation (Zod)", () => {
  it("successfully validates valid development environment configuration", () => {
    const validConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
      SESSION_SECRET: "dev-session-secret-for-testing-purposes",
    };

    const env = validateEnv(validConfig);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(env.PAYMENT_PROVIDER).toBe("SANDBOX_MOCK");
    expect(env.ENABLE_LIVE_PAYMENTS).toBe(false);
  });

  it("fails validation when DATABASE_URL is missing", () => {
    const invalidConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "",
      SESSION_SECRET: "some-secret",
    };

    expect(() => validateEnv(invalidConfig)).toThrowError(
      /DATABASE_URL is required/
    );
  });

  it("enforces minimum 32 characters for SESSION_SECRET in production", () => {
    const shortSecretProd = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
      SESSION_SECRET: "too-short",
    };

    expect(() => validateEnv(shortSecretProd)).toThrowError(
      /SESSION_SECRET must be at least 32 characters/
    );
  });

  it("passes production validation when SESSION_SECRET is 32+ characters", () => {
    const validProd = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
      SESSION_SECRET: "production-secure-session-key-with-at-least-32-characters!",
    };

    const env = validateEnv(validProd);
    expect(env.NODE_ENV).toBe("production");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

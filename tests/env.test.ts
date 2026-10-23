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
    expect(env.INITIAL_ADMIN_PASSWORD).toBeUndefined(); // No default hardcoded admin password
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
      PAYMENT_WEBHOOK_SECRET: "production-webhook-secret-with-at-least-32-chars!",
      ALLOW_TEST_SEEDING: "false",
    };

    expect(() => validateEnv(shortSecretProd)).toThrowError(
      /SESSION_SECRET must be at least 32 characters/
    );
  });

  it("passes production validation when secrets and security settings are valid", () => {
    const validProd = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
      SESSION_SECRET: "production-secure-session-key-with-at-least-32-characters!",
      PAYMENT_WEBHOOK_SECRET: "production-webhook-secret-with-at-least-32-chars!",
      ALLOW_TEST_SEEDING: "false",
    };

    const env = validateEnv(validProd);
    expect(env.NODE_ENV).toBe("production");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.ALLOW_TEST_SEEDING).toBe(false);
  });

  it("rejects insecure or default PAYMENT_WEBHOOK_SECRET in production", () => {
    const defaultWebhookProd = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
      SESSION_SECRET: "production-secure-session-key-with-at-least-32-characters!",
      PAYMENT_WEBHOOK_SECRET: "local-dev-mock-webhook-secret",
      ALLOW_TEST_SEEDING: "false",
    };

    expect(() => validateEnv(defaultWebhookProd)).toThrowError(
      /PAYMENT_WEBHOOK_SECRET must be explicitly configured and at least 32 characters/
    );
  });

  it("rejects ALLOW_TEST_SEEDING in production", () => {
    const seedInProd = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_prod",
      SESSION_SECRET: "production-secure-session-key-with-at-least-32-characters!",
      PAYMENT_WEBHOOK_SECRET: "production-webhook-secret-with-at-least-32-chars!",
      ALLOW_TEST_SEEDING: "true",
    };

    expect(() => validateEnv(seedInProd)).toThrowError(
      /ALLOW_TEST_SEEDING must be set to false/
    );
  });

  it("correctly parses explicit boolean strings without truthiness trap", () => {
    // "false" string must evaluate to boolean false, NOT true
    const falseConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
      SESSION_SECRET: "dev-session-secret-for-testing-purposes",
      ENABLE_LIVE_PAYMENTS: "false",
      ALLOW_TEST_SEEDING: "0",
    };

    const env = validateEnv(falseConfig);
    expect(env.ENABLE_LIVE_PAYMENTS).toBe(false);
    expect(env.ALLOW_TEST_SEEDING).toBe(false);

    // "true" and "1" parse to true
    const trueConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
      SESSION_SECRET: "dev-session-secret-for-testing-purposes",
      ENABLE_LIVE_PAYMENTS: "1",
      PAYMENT_PROVIDER: "PAYSTACK",
      PAYSTACK_SECRET_KEY: "sk_test_1234567890",
      ALLOW_TEST_SEEDING: "true",
    };

    const env2 = validateEnv(trueConfig);
    expect(env2.ENABLE_LIVE_PAYMENTS).toBe(true);
    expect(env2.ALLOW_TEST_SEEDING).toBe(true);
  });

  it("rejects invalid non-boolean strings for boolean fields", () => {
    const invalidBoolConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
      SESSION_SECRET: "dev-session-secret-for-testing-purposes",
      ENABLE_LIVE_PAYMENTS: "yes",
    };

    expect(() => validateEnv(invalidBoolConfig)).toThrowError(
      /Invalid boolean value/
    );
  });

  it("rejects enabling live payments with SANDBOX_MOCK payment provider", () => {
    const contradictoryConfig = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/nuas_awards_dev",
      SESSION_SECRET: "dev-session-secret-for-testing-purposes",
      ENABLE_LIVE_PAYMENTS: "true",
      PAYMENT_PROVIDER: "SANDBOX_MOCK",
    };

    expect(() => validateEnv(contradictoryConfig)).toThrowError(
      /Live payments cannot be enabled with SANDBOX_MOCK/
    );
  });
});

import { z } from "zod";

/**
 * Consistently parses boolean environment variables everywhere.
 * Strictly maps "true"/"1" to true and "false"/"0" to false.
 */
export function parseBooleanEnv(val: unknown, defaultValue = false): boolean {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return defaultValue;
}

function createExplicitBoolean(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return defaultValue;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const s = val.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
      return "__INVALID_BOOLEAN__";
    }
    return val;
  }, z.boolean({
    invalid_type_error: 'Invalid boolean value. Accepted values are "true", "false", "1", or "0".',
  }));
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    TEST_DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
    INITIAL_ADMIN_NAME: z.string().default("NUAS Executive Super Admin"),
    INITIAL_ADMIN_EMAIL: z.string().email().default("admin@nuasknust.org"),
    // No hard-coded default password; must be explicitly supplied where bootstrap needs it
    INITIAL_ADMIN_PASSWORD: z.string().min(12, "Administrator password must be at least 12 characters").optional(),
    PAYMENT_PROVIDER: z.enum(["SANDBOX_MOCK", "PAYSTACK", "HUBTEL"]).default("SANDBOX_MOCK"),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().default("noreply@nuasknust.org"),
    ENABLE_LIVE_PAYMENTS: createExplicitBoolean(false),
    ALLOW_TEST_SEEDING: createExplicitBoolean(true),
    TRUST_PROXY: createExplicitBoolean(false),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === "production") {
        return data.SESSION_SECRET.length >= 32;
      }
      return true;
    },
    {
      message: "SESSION_SECRET must be at least 32 characters long in production",
      path: ["SESSION_SECRET"],
    }
  )
  .refine(
    (data) => {
      // In production, an insecure default webhook secret is prohibited
      if (data.NODE_ENV === "production") {
        if (!data.PAYMENT_WEBHOOK_SECRET || data.PAYMENT_WEBHOOK_SECRET === "local-dev-mock-webhook-secret") {
          return false;
        }
        return data.PAYMENT_WEBHOOK_SECRET.length >= 32;
      }
      return true;
    },
    {
      message: "PAYMENT_WEBHOOK_SECRET must be explicitly configured and at least 32 characters in production",
      path: ["PAYMENT_WEBHOOK_SECRET"],
    }
  )
  .refine(
    (data) => {
      // Production must prohibit test seed data
      if (data.NODE_ENV === "production" && data.ALLOW_TEST_SEEDING === true) {
        return false;
      }
      return true;
    },
    {
      message: "ALLOW_TEST_SEEDING must be set to false (disabled) in production environments.",
      path: ["ALLOW_TEST_SEEDING"],
    }
  )
  .refine(
    (data) => {
      if (data.ENABLE_LIVE_PAYMENTS && data.PAYMENT_PROVIDER === "SANDBOX_MOCK") {
        return false;
      }
      return true;
    },
    {
      message: "Live payments cannot be enabled with SANDBOX_MOCK payment provider in production.",
      path: ["PAYMENT_PROVIDER"],
    }
  )
  .refine(
    (data) => {
      if (data.ENABLE_LIVE_PAYMENTS && data.PAYMENT_PROVIDER === "PAYSTACK") {
        return !!data.PAYSTACK_SECRET_KEY && data.PAYSTACK_SECRET_KEY.trim().length > 0;
      }
      return true;
    },
    {
      message: "PAYSTACK_SECRET_KEY is required when live payments are enabled with Paystack.",
      path: ["PAYSTACK_SECRET_KEY"],
    }
  );

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env | null = null;

export function getEnv(): Env {
  if (parsedEnv) {
    return parsedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join(", ");
    throw new Error(`[Environment Configuration Error] Invalid configuration: ${errorDetails}`);
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export function validateEnv(customEnv?: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(customEnv ?? process.env);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join(", ");
    throw new Error(`[Environment Configuration Error] Invalid configuration: ${errorDetails}`);
  }
  return result.data;
}

/**
 * Resets cached parsed environment configuration.
 * Intended for automated test suites that manipulate process.env dynamically.
 */
export function resetParsedEnv(): void {
  parsedEnv = null;
}

/**
 * Explicit runtime validation entry point.
 * Throws immediately if current environment configuration is invalid.
 */
export function validateRuntimeEnv(): Env {
  resetParsedEnv();
  return getEnv();
}

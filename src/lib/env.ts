import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    TEST_DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
    INITIAL_ADMIN_NAME: z.string().default("NUAS Executive Super Admin"),
    INITIAL_ADMIN_EMAIL: z.string().email().default("admin@nuasknust.org"),
    INITIAL_ADMIN_PASSWORD: z.string().min(8).default("AdminSecurePassword2026!"),
    PAYMENT_PROVIDER: z.enum(["SANDBOX_MOCK", "PAYSTACK", "HUBTEL"]).default("SANDBOX_MOCK"),
    PAYMENT_WEBHOOK_SECRET: z.string().default("local-dev-mock-webhook-secret"),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().default("noreply@nuasknust.org"),
    ENABLE_LIVE_PAYMENTS: z.coerce.boolean().default(false),
    ALLOW_TEST_SEEDING: z.coerce.boolean().default(true),
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

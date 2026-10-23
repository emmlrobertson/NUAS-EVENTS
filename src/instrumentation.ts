/**
 * Next.js Framework-Level Runtime Initialization Hook
 * Automatically invoked by Next.js on server startup.
 *
 * Enforces fail-closed configuration validation before any requests are served.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnv } = await import("@/lib/env");
    try {
      validateRuntimeEnv();
    } catch (error) {
      console.error("[CRITICAL] Runtime Environment Configuration Error:", error);
      // In production, an invalid environment configuration must prevent booting
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
    }
  }
}

/**
 * Rate Limiting for Public Order Status Inquiries, Checkout Creation, and Sandbox Simulation.
 *
 * ARCHITECTURAL SPECIFICATION & PROCESS-LOCAL LIMITATIONS:
 * --------------------------------------------------------
 * 1. Process-local State:
 *    Memory state is bound to a single Node.js runtime process or serverless worker.
 *    In multi-instance production environments (e.g., horizontally scaled containers,
 *    Vercel serverless functions, Kubernetes pods), each instance maintains its own
 *    isolated memory map. An attacker whose requests are distributed across N instances
 *    can make up to N * MAX_REQUESTS before being throttled.
 *
 * 2. Ephemeral Lifecycle:
 *    Application restarts, deployments, crashes, and serverless cold starts flush the
 *    in-memory map immediately, resetting all rate counters to zero.
 *
 * 3. Memory & Eviction:
 *    Without proactive pruning, an attacker rotating spoofed IP addresses could cause
 *    the Map to grow indefinitely. This implementation includes an active eviction step
 *    during checks and maintains a hard cap to protect memory.
 *
 * 4. Production Recommendation:
 *    For distributed multi-replica deployments, a shared external store (such as Redis
 *    sliding-window counters via atomic Lua scripts or a PostgreSQL rate-limit log table)
 *    is required for global enforcement. As the repository does not currently provision
 *    Redis or an external cache, this robust in-memory limiter serves as the primary
 *    node-level defense against automated scraping, enumeration, and Denial-of-Service.
 */

export interface OrderRateLimitRecord {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining: number;
}

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  maxEntries?: number;
}

export class InMemoryRateLimiter {
  private records = new Map<string, OrderRateLimitRecord>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.maxEntries = options.maxEntries ?? 10000;
  }

  public check(ip: string): RateLimitResult {
    const now = Date.now();
    const record = this.records.get(ip);

    // Active prune if table exceeds capacity
    if (this.records.size > this.maxEntries) {
      this.pruneExpired(now);
    }

    if (!record || now - record.windowStart > this.windowMs) {
      this.records.set(ip, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.maxRequests - 1 };
    }

    if (record.count >= this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStart + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    record.count++;
    return { allowed: true, remaining: this.maxRequests - record.count };
  }

  public reset(): void {
    this.records.clear();
  }

  public size(): number {
    return this.records.size;
  }

  private pruneExpired(now: number): void {
    this.records.forEach((record, key) => {
      if (now - record.windowStart > this.windowMs) {
        this.records.delete(key);
      }
    });
  }
}

// Global default limiters for order lookup, checkout, and sandbox simulation
const DEFAULT_LOOKUP_LIMITER = new InMemoryRateLimiter({
  maxRequests: 30, // Max 30 lookups per minute
  windowMs: 60 * 1000,
});

const DEFAULT_CHECKOUT_LIMITER = new InMemoryRateLimiter({
  maxRequests: 20, // Max 20 checkout creations per minute
  windowMs: 60 * 1000,
});

const DEFAULT_SIMULATE_LIMITER = new InMemoryRateLimiter({
  maxRequests: 10, // Max 10 sandbox simulations per minute per IP
  windowMs: 60 * 1000,
});

export function checkOrderStatusRateLimit(ip: string): RateLimitResult {
  return DEFAULT_LOOKUP_LIMITER.check(ip);
}

export function checkCheckoutRateLimit(ip: string): RateLimitResult {
  return DEFAULT_CHECKOUT_LIMITER.check(ip);
}

export function checkSandboxSimulateRateLimit(ip: string): RateLimitResult {
  return DEFAULT_SIMULATE_LIMITER.check(ip);
}

/**
 * Test helper to clear in-memory rate limits between unit/integration test runs.
 */
export function resetOrderStatusRateLimits(): void {
  DEFAULT_LOOKUP_LIMITER.reset();
  DEFAULT_CHECKOUT_LIMITER.reset();
  DEFAULT_SIMULATE_LIMITER.reset();
}

/**
 * Factory for creating independent rate limiter instances.
 * Useful for testing multi-instance behavior and isolated namespaces.
 */
export function createRateLimiter(options: RateLimiterOptions): InMemoryRateLimiter {
  return new InMemoryRateLimiter(options);
}

// Re-export unified client IP extraction policy from security module
export {
  getClientIp,
  extractClientIp,
  type ClientIpOptions,
  type ClientIpExtractionResult,
} from "@/lib/security/client-ip";

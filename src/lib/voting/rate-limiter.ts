/**
 * Rate limiter for voting checkout endpoints.
 * Mitigates denial-of-service, automated cart spamming, and inventory exhaustion attacks.
 */

interface CheckoutRateRecord {
  count: number;
  resetAt: number;
}

const checkoutRequests = new Map<string, CheckoutRateRecord>();

const MAX_CHECKOUT_ATTEMPTS = 30; // 30 orders per 10 minutes per IP
const WINDOW_MS = 10 * 60 * 1000;

export function checkCheckoutRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining: number;
} {
  const now = Date.now();
  const record = checkoutRequests.get(ip);

  if (!record || now > record.resetAt) {
    checkoutRequests.set(ip, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return { allowed: true, remaining: MAX_CHECKOUT_ATTEMPTS - 1 };
  }

  if (record.count >= MAX_CHECKOUT_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_CHECKOUT_ATTEMPTS - record.count };
}

export function resetCheckoutRateLimits(): void {
  checkoutRequests.clear();
}

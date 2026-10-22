/**
 * In-memory sliding window rate limiter for authentication endpoints.
 * Prevents brute-force credential stuffing and password guessing.
 */

interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil: number | null;
}

const loginAttempts = new Map<string, RateLimitRecord>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes block

export function checkLoginRateLimit(key: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
  remainingAttempts: number;
} {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS };
  }

  // Check if currently blocked
  if (record.blockedUntil && now < record.blockedUntil) {
    const retryAfterSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, retryAfterSeconds, remainingAttempts: 0 };
  }

  // Check if window has expired
  if (now - record.firstAttemptAt > WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    const retryAfterSeconds = Math.ceil(BLOCK_DURATION_MS / 1000);
    return { allowed: false, retryAfterSeconds, remainingAttempts: 0 };
  }

  return { allowed: true, remainingAttempts: MAX_ATTEMPTS - record.attempts };
}

export function recordFailedLoginAttempt(key: string): void {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    loginAttempts.set(key, {
      attempts: 1,
      firstAttemptAt: now,
      blockedUntil: null,
    });
  } else {
    record.attempts += 1;
    if (record.attempts >= MAX_ATTEMPTS) {
      record.blockedUntil = now + BLOCK_DURATION_MS;
    }
  }
}

export function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

// For unit testing
export function resetAllRateLimits(): void {
  loginAttempts.clear();
}

import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { Role, User } from "@prisma/client";

const COOKIE_NAME = "nuas_admin_session";
const SESSION_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

export interface SessionPayload {
  userId: string;
  email: string;
  role: Role;
  tokenVersion: number;
  exp: number;
}

function getSecretKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[FATAL SECURITY] SESSION_SECRET must be configured in production.");
    }
    return "dev-session-secret-fallback-minimum-32-chars";
  }
  return secret;
}

export function createSessionToken(user: Pick<User, "id" | "email" | "role" | "tokenVersion">): string {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadBase64)
    .digest("base64url");

  return `${payloadBase64}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadBase64)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf-8"));
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentAdminUser(request?: Request): Promise<User | null> {
  let token: string | undefined;

  if (request) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
      if (match) {
        token = match[1];
      }
    }
  }

  if (!token) {
    try {
      token = cookies().get(COOKIE_NAME)?.value;
    } catch {
      // Outside of Next.js server context or in unit tests
    }
  }

  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user || !user.isActive) {
    return null;
  }

  // Enforce session version: if tokenVersion does not match, session has been revoked
  if (user.tokenVersion !== payload.tokenVersion) {
    return null;
  }

  return user;
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tokenVersion: { increment: 1 },
    },
  });
}

export function validateCsrfProtection(request: Request): boolean {
  const method = request.method.toUpperCase();
  // Safe HTTP read methods are exempt from CSRF checks
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return true;
  }

  // If a custom non-browser header is provided (e.g. from tests or API clients)
  if (
    request.headers.get("x-requested-with") === "XMLHttpRequest" ||
    request.headers.get("x-csrf-protect") === "1"
  ) {
    return true;
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      return originHost === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer && host) {
    try {
      const refererHost = new URL(referer).host;
      return refererHost === host;
    } catch {
      return false;
    }
  }

  // In test runner or non-browser environments where origin/host may not be present
  if (process.env.NODE_ENV === "test" && !origin && !referer) {
    return true;
  }

  return false;
}

export function getSessionCookieConfig(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_EXPIRY_SECONDS,
  };
}

export function getClearSessionCookieConfig() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

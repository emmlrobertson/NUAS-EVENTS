import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, getSessionCookieConfig } from "@/lib/auth/session";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
} from "@/lib/auth/rate-limiter";
import { Role } from "@prisma/client";

// Pre-computed dummy hash to ensure constant-time response when user is not found
const DUMMY_HASH = "$2a$12$e80yqV8vLq4V5W2vW82yqeO7z9B.hC88qT6Z.21h2b0Uq83qE4qGe";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "127.0.0.1";
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email or password format." },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();
    const password = parsed.data.password;
    const rateLimitKey = `${ip}:${email}`;

    // Rate limiting check
    const rateLimit = checkLoginRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please try again after ${rateLimit.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds || 900),
          },
        }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      // Execute dummy bcrypt comparison to neutralize timing attack for user enumeration
      await bcrypt.compare(password, DUMMY_HASH);
      recordFailedLoginAttempt(rateLimitKey);
      return NextResponse.json(
        { error: "Invalid email or password credentials." },
        { status: 401 }
      );
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      recordFailedLoginAttempt(rateLimitKey);
      return NextResponse.json(
        { error: "Invalid email or password credentials." },
        { status: 401 }
      );
    }

    // Only SUPER_ADMIN and EVENT_ADMIN can access administrative management
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.EVENT_ADMIN) {
      recordFailedLoginAttempt(rateLimitKey);
      return NextResponse.json(
        { error: "Access denied. Insufficient administrative privileges." },
        { status: 403 }
      );
    }

    // Login successful: reset rate limit tracking
    clearLoginRateLimit(rateLimitKey);

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create session token and set cookie
    const token = createSessionToken(user);
    const cookieConfig = getSessionCookieConfig(token);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    response.cookies.set(cookieConfig);
    return response;
  } catch (error) {
    console.error("[Admin Login Error]", error);
    return NextResponse.json(
      { error: "An unexpected authentication error occurred." },
      { status: 500 }
    );
  }
}

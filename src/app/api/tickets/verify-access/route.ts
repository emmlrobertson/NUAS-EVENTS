import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyTicketOwnershipAndGrantAccess } from "@/lib/ticketing/ticket-access";
import { InMemoryRateLimiter } from "@/lib/voting/rate-limiter";
import { getClientIp } from "@/lib/security/client-ip";

// Rate limiter: Max 5 attempts per IP per 5 minutes to prevent brute-force enumeration
const accessVerificationLimiter = new InMemoryRateLimiter({
  maxRequests: 5,
  windowMs: 5 * 60 * 1000,
  maxEntries: 5000,
});

const verifyAccessSchema = z.object({
  ticketNumber: z.string().min(3).max(50),
  verificationInput: z.string().min(2).max(100),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = accessVerificationLimiter.check(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many verification attempts. Please wait before trying again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds ?? 300),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  try {
    const body = await request.json();
    const parsed = verifyAccessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid verification request parameters." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const result = await verifyTicketOwnershipAndGrantAccess({
      ticketNumber: parsed.data.ticketNumber,
      verificationInput: parsed.data.verificationInput,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Verification failed." },
        { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      {
        success: true,
        accessKey: result.accessKey,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[Ticket Access Verification Error]", error);
    return NextResponse.json(
      { error: "Internal server error verifying ticket access." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

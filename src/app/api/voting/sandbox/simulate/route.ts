import { NextRequest, NextResponse } from "next/server";
import { sandboxSimulationSchema } from "@/lib/voting/validation";
import { confirmVotingPayment } from "@/lib/voting/payment-adapter";
import { checkSandboxSimulateRateLimit, getClientIp } from "@/lib/voting/rate-limiter";
import { getEnv } from "@/lib/env";

export async function POST(request: NextRequest) {
  const env = getEnv();

  // 1. Strict Production & Live Payments Guard
  if (env.NODE_ENV === "production" || env.ENABLE_LIVE_PAYMENTS) {
    return NextResponse.json(
      { error: "Sandbox simulation is strictly disabled in production or when live payments are active." },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  // 2. Client IP Resolution & Rate Limiting
  const ip = getClientIp(request);
  const rateCheck = checkSandboxSimulateRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many simulation requests. Please wait a moment before trying again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.retryAfterSeconds ?? 60),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON body provided." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const parsed = sandboxSimulationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid simulation payload." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const userAgent = request.headers.get("user-agent") ?? undefined;

    const result = await confirmVotingPayment({
      orderNumber: parsed.data.orderNumber,
      outcome: parsed.data.outcome,
      amountInPesewas: parsed.data.amountInPesewas,
      currency: parsed.data.currency,
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Simulation failed.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

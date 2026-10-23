import { NextRequest, NextResponse } from "next/server";
import { sandboxSimulationSchema } from "@/lib/voting/validation";
import { confirmVotingPayment } from "@/lib/voting/payment-adapter";

export async function POST(request: NextRequest) {
  // 1. Strict Production & Live Payments Guard
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_LIVE_PAYMENTS === "true") {
    return NextResponse.json(
      { error: "Sandbox simulation is strictly disabled in production or when live payments are active." },
      { status: 403 }
    );
  }

  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body provided." }, { status: 400 });
    }

    const parsed = sandboxSimulationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid simulation payload." },
        { status: 400 }
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

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Simulation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

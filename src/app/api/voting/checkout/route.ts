import { NextRequest, NextResponse } from "next/server";
import { checkoutRequestSchema } from "@/lib/voting/validation";
import { createVotingOrder, VotingServiceError } from "@/lib/voting/order-service";
import { checkCheckoutRateLimit } from "@/lib/voting/rate-limiter";
import { SandboxMockPaymentGateway } from "@/lib/voting/payment-adapter";

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    const rateCheck = checkCheckoutRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: "Too many checkout requests. Please wait a moment before trying again.",
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateCheck.retryAfterSeconds ?? 60),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body provided." }, { status: 400 });
    }

    const parsed = checkoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message);
      return NextResponse.json(
        {
          error: issues[0] || "Invalid checkout payload.",
          details: issues,
        },
        { status: 400 }
      );
    }

    const userAgent = request.headers.get("user-agent") ?? undefined;

    const order = await createVotingOrder({
      eventId: parsed.data.eventId,
      voterPhone: parsed.data.voterPhone,
      voterEmail: parsed.data.voterEmail,
      allocations: parsed.data.allocations,
      idempotencyKey: parsed.data.idempotencyKey,
      ipAddress: ip,
      userAgent,
    });

    // Initialize sandbox checkout session
    const sandboxGateway = new SandboxMockPaymentGateway();
    const paymentSession = await sandboxGateway.initializePayment({
      orderNumber: order.orderNumber,
      amountInPesewas: order.totalAmountInPesewas,
      currency: "GHS",
      customerEmail: order.voterEmail ?? undefined,
      customerPhone: parsed.data.voterPhone,
      orderType: "VOTING",
      callbackUrl: `/vote/checkout?orderNumber=${encodeURIComponent(order.orderNumber)}`,
    });

    return NextResponse.json(
      {
        success: true,
        order,
        paymentSession,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof VotingServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    console.error("[Voting Checkout Error]", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while preparing your checkout. Please try again." },
      { status: 500 }
    );
  }
}

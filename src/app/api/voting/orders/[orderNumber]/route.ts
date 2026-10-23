import { NextRequest, NextResponse } from "next/server";
import { getVotingOrderByNumber } from "@/lib/voting/order-service";
import { checkOrderStatusRateLimit, getClientIp } from "@/lib/voting/rate-limiter";

interface RouteParams {
  params: {
    orderNumber: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  // 1. IP-based Rate Limiting to prevent scraping and brute-force probing
  const ip = getClientIp(request);

  const rateCheck = checkOrderStatusRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many order status lookup requests. Please wait before retrying." },
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
    const rawOrderNumber = params.orderNumber;
    if (!rawOrderNumber) {
      return NextResponse.json(
        { error: "Order number is required." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const orderNumber = decodeURIComponent(rawOrderNumber).trim();
    if (!orderNumber) {
      return NextResponse.json(
        { error: "Order number is required." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const order = await getVotingOrderByNumber(orderNumber);
    if (!order) {
      return NextResponse.json(
        { error: "Order not found." },
        { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Return sanitized DTO with masked PII and no internal secrets
    return NextResponse.json(
      {
        success: true,
        order,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("[Get Voting Order Error]", err);
    return NextResponse.json(
      { error: "Unable to retrieve order details." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getVotingOrderByNumber } from "@/lib/voting/order-service";

interface RouteParams {
  params: {
    orderNumber: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const orderNumber = decodeURIComponent(params.orderNumber);
    if (!orderNumber) {
      return NextResponse.json({ error: "Order number is required." }, { status: 400 });
    }

    const order = await getVotingOrderByNumber(orderNumber);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (err) {
    console.error("[Get Voting Order Error]", err);
    return NextResponse.json(
      { error: "Unable to retrieve order details." },
      { status: 500 }
    );
  }
}

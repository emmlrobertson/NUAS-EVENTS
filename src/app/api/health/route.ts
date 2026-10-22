import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Perform a lightweight query to verify database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "nuas-awards-api",
      },
      { status: 200 }
    );
  } catch (error) {
    // Log internal error safely on the server side
    console.error("[Health Check] Database connectivity check failed");

    // Return a generic response without leaking internal credentials, host, or stack trace
    return NextResponse.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        service: "nuas-awards-api",
        error: "Database connectivity check failed",
      },
      { status: 503 }
    );
  }
}

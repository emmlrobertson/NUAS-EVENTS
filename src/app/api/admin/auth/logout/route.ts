import { NextResponse } from "next/server";
import { getCurrentAdminUser, getClearSessionCookieConfig, revokeUserSessions } from "@/lib/auth/session";

export async function POST(request: Request) {
  const user = await getCurrentAdminUser(request);
  if (user) {
    // Invalidate all existing tokens server-side by incrementing tokenVersion
    await revokeUserSessions(user.id);
  }

  const response = NextResponse.json({ success: true, message: "Logged out successfully." });
  response.cookies.set(getClearSessionCookieConfig());
  return response;
}

import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getCurrentAdminUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

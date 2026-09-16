import { NextResponse } from "next/server";
import { DEMO_COOKIE_NAME, DEMO_COOKIE_VALUE } from "@/features/auth/demo";

export function GET() {
  const response = new NextResponse(null, { status: 303, headers: { Location: "/" } });
  response.cookies.set(DEMO_COOKIE_NAME, DEMO_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

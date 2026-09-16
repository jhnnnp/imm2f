import { NextResponse } from "next/server";
import { DEMO_COOKIE_NAME } from "@/features/auth/demo";

export function GET() {
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.delete(DEMO_COOKIE_NAME);
  return response;
}

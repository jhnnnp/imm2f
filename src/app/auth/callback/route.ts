import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const supabase = await createClient();

  if (code && supabase) {
    await supabase.auth.exchangeCodeForSession(code);
    await supabase.rpc("ensure_own_couple");
  }

  const destination = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(destination, origin));
}

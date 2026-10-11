import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/features/auth/redirectPath";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const authFailure = () => NextResponse.redirect(new URL("/login?error=auth_callback", origin));
  if (!code) return authFailure();
  let supabase;
  try {
    supabase = await createClient();
    if (!supabase) return authFailure();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return authFailure();
  } catch { return authFailure(); }
  // Authentication succeeded. Keep that session so workspace setup can be retried.
  try {
    const { error: setupError } = await supabase.rpc("ensure_own_couple");
    if (setupError) return NextResponse.redirect(new URL("/?error=space_setup", origin));
  } catch { return NextResponse.redirect(new URL("/?error=space_setup", origin)); }
  return NextResponse.redirect(new URL(next, origin));
}

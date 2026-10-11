import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { signedInAuthRedirect } from "@/features/auth/invitePath";
import { getSupabaseKey, getSupabaseUrl, isSupabaseConfigured } from "./env";
import { supabaseFetch } from "./fetch";

const PUBLIC_PREFIXES = ["/login", "/signup", "/invite", "/auth"];
const PUBLIC_MAP_APIS = ["/api/kakao-map-key", "/api/map-tiles", "/api/map-route"];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(prefix => matchesPrefix(pathname, prefix));
}

function preserveAuthResponse(response: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) response.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) response.headers.set(header, value);
  }
  return response;
}

export async function updateSession(request: NextRequest, forwardedHeaders = new Headers(request.headers)) {
  const passthrough = () => {
    // Cookie rotation must also reach the render; forwarding the original cookie
    // makes Server Components refresh the same token a second time.
    forwardedHeaders.set("cookie", request.headers.get("cookie") ?? "");
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  };
  const { pathname } = request.nextUrl;

  // Public map resources contain no user data. Tiles fan out into many requests,
  // so verifying a session on each one blocks map rendering unnecessarily.
  if (PUBLIC_MAP_APIS.some(prefix => matchesPrefix(pathname, prefix))) return passthrough();

  const unauthenticated = () => {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    const url = request.nextUrl.clone();
    const next = `${pathname}${url.search}`;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };
  if (!isSupabaseConfigured()) return isPublicPath(pathname) ? passthrough() : unauthenticated();

  let supabaseResponse = passthrough();
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseKey(), {
    global: { fetch: supabaseFetch },
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const refreshed = passthrough();
        preserveAuthResponse(refreshed, supabaseResponse);
        supabaseResponse = refreshed;
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  if (error && (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError" || (error.status ?? 0) >= 500)) {
    // Each private layout/action validates its own session and presents a
    // recoverable error. An Auth outage must not redirect a valid user to login.
    return supabaseResponse;
  }
  const user = data?.claims;
  if (!user && !isPublicPath(pathname)) return preserveAuthResponse(unauthenticated(), supabaseResponse);

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const destination = signedInAuthRedirect(pathname, request.nextUrl.searchParams);
    return preserveAuthResponse(NextResponse.redirect(new URL(destination, request.url)), supabaseResponse);
  }
  return supabaseResponse;
}

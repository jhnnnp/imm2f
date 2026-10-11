import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "./database.types";
import { getSupabaseKey, getSupabaseSecretKey, getSupabaseUrl, isSupabaseConfigured } from "./env";
import { supabaseFetch } from "./fetch";
import { getWorkspaceReadContext } from "./readContext";

// React's cache is scoped to a server render/request, never shared between users.
const createRequestClient = cache(async () => {
  if (!isSupabaseConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient<Database>(getSupabaseUrl(), getSupabaseKey(), {
    global: { fetch: supabaseFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session.
        }
      },
    },
  });
});

export async function createClient() {
  const read = getWorkspaceReadContext();
  if (read) return read.client ??= createRequestClient();
  return createRequestClient();
}

export function createServiceClient() {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!url || !secret) return null;
  return createAdminClient<Database>(url, secret, {
    global: { fetch: supabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

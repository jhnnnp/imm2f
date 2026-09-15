import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { getSupabaseKey, getSupabaseSecretKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

export async function createClient() {
  if (!isSupabaseConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient<Database>(getSupabaseUrl(), getSupabaseKey(), {
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
}

export function createServiceClient() {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!url || !secret) return null;
  return createAdminClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

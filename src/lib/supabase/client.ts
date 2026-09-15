import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabaseKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

export function createClient() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient<Database>(getSupabaseUrl(), getSupabaseKey());
}

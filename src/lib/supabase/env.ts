export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

export function getSupabaseKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    || ""
  );
}

export function getSupabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

export function isPublicSupabaseKey(value: string) {
  if (/^sb_publishable_[\w-]+$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part))) return false;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload)?.role === "anon";
  } catch {
    return false;
  }
}

export function publicConfig(env: Record<string, string | undefined>) {
  const key = (env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
  return {
    VITE_SUPABASE_URL: (env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim(),
    VITE_SUPABASE_ANON_KEY: isPublicSupabaseKey(key) ? key : "",
    VITE_API_URL: (env.VITE_API_URL || "").trim()
  };
}

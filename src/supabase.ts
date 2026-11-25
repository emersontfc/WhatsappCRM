import { createClient, type Session } from "@supabase/supabase-js";
import { isPublicSupabaseKey } from "../shared/publicConfig";

// Safely obtain runtime (window.__ENV__) or build-time (import.meta.env) credentials
const win = typeof window !== "undefined" ? (window as any) : {};
const env = win.__ENV__ || {};

const rawUrl = (
  env.VITE_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  ""
);
let supabaseUrl = (typeof rawUrl === "string" ? rawUrl : "").replace(/^["']|["']$/g, "").trim();

const rawAnon = (
  env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  ""
);
let supabaseAnonKey = (typeof rawAnon === "string" ? rawAnon : "").replace(/^["']|["']$/g, "").trim();

// Handle case where user only provides the project ref
if (supabaseUrl && !supabaseUrl.startsWith("http")) {
  supabaseUrl = `https://${supabaseUrl}.supabase.co`;
}

function getProjectUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash ? url.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

const projectUrl = getProjectUrl(supabaseUrl);
export const supabaseConfigured = projectUrl !== null && isPublicSupabaseKey(supabaseAnonKey);
const SESSION_TIMEOUT_MS = 4_000;
const AUTH_REQUEST_TIMEOUT_MS = 8_000;

const fetchSupabase: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(`${projectUrl}/auth/v1/`)) return fetch(input, init);

  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  return fetch(input, { ...init, signal });
};

export const supabase = supabaseConfigured
  ? createClient(projectUrl, supabaseAnonKey, { global: { fetch: fetchSupabase } })
  : new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'auth') {
          return new Proxy({}, {
            get: (target, authProp) => {
              if (authProp === 'getUser') {
                return async () => ({ data: { user: null }, error: null });
              }
              if (authProp === 'getSession') {
                return async () => ({ data: { session: null }, error: null });
              }
              if (authProp === 'onAuthStateChange') {
                return () => ({ data: { subscription: { unsubscribe: () => {} } } });
              }
              return () => { throw new Error("Supabase client not initialized."); };
            }
          });
        }
        return () => {
          throw new Error("Supabase client not initialized. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
        };
      }
    }) as any;

if (!supabaseConfigured) {
  console.warn("[Supabase] VITE_SUPABASE_URL or valid VITE_SUPABASE_ANON_KEY is missing in frontend configuration.");
}

// Reuse the in-flight lookup while bounding how long each caller waits for it.
let sessionPromise: Promise<Session | null> | null = null;

export const getSession = async (): Promise<Session | null> => {
  if (!sessionPromise) {
    sessionPromise = supabase.auth.getSession()
      .then(({ data: { session } }) => session)
      .catch(() => null)
      .finally(() => { sessionPromise = null; });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SESSION_TIMEOUT_MS);
  });
  return Promise.race([sessionPromise, deadline]).finally(() => clearTimeout(timer));
};

export const getUser = async () => {
  return (await getSession())?.user ?? null;
};

// Helper to get current user ID
export const getUserId = async () => {
  const user = await getUser();
  return user?.id || "guest-user";
};

// Helper to get current user email
export const getUserEmail = async () => {
  const user = await getUser();
  return user?.email;
};

// Helper to get current user name (from metadata)
export const getUserName = async () => {
  const user = await getUser();
  return user?.user_metadata?.full_name || user?.email?.split("@")[0];
};

// Helper to check if current user is an admin
export const isAdmin = async () => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  
  try {
    const { data: userData, error } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    
    if (error) {
      return false;
    }
    
    return userData?.role === "admin" || userData?.role === "superadmin";
  } catch (err) {
    return false;
  }
};

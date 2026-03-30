import { createClient } from "@supabase/supabase-js";

let supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Handle case where user only provides the project ref
if (supabaseUrl && !supabaseUrl.startsWith("http")) {
  supabaseUrl = `https://${supabaseUrl}.supabase.co`;
}

// Initialize client only if keys are present and valid
const isValidAnonKey = supabaseAnonKey && supabaseAnonKey.split('.').length === 3;

export const supabase = (supabaseUrl && isValidAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'auth') {
          return new Proxy({}, {
            get: (target, authProp) => {
              if (authProp === 'getUser') {
                return async () => ({ data: { user: null }, error: null });
              }
              return () => { throw new Error("Supabase client not initialized."); };
            }
          });
        }
        return () => {
          throw new Error("Supabase client not initialized. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Settings.");
        };
      }
    }) as any;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase URL or Anon Key is missing. Please configure them in Settings.");
} else if (!isValidAnonKey) {
  console.error("Supabase Anon Key is invalid. It should be a JWT token with 3 parts separated by dots.");
}

// Helper to get current session with simple promise caching to avoid concurrent auth lock issues
let sessionPromise: Promise<any> | null = null;

export const getSession = async () => {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("getSession: Error fetching session:", error);
      }
      return session;
    } catch (err) {
      console.error("Error in getSession:", err);
      return null;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
};

// Helper to get current user with simple caching to avoid concurrent auth lock issues
let cachedUser: any = null;
let lastUserFetchTime = 0;
let userPromise: Promise<any> | null = null;
const USER_CACHE_TTL = 1000 * 60; // 1 minute

export const getUser = async () => {
  const now = Date.now();
  if (cachedUser && (now - lastUserFetchTime < USER_CACHE_TTL)) {
    return cachedUser;
  }

  if (userPromise) {
    return userPromise;
  }

  userPromise = (async () => {
    try {
      const session = await getSession();
      const user = session?.user || null;
      console.log("getUser: Fetched user from session:", user?.email);
      cachedUser = user;
      lastUserFetchTime = Date.now();
      return cachedUser;
    } catch (err) {
      console.error("Error in getUser:", err);
      return null;
    } finally {
      userPromise = null;
    }
  })();

  return userPromise;
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
    
    return userData?.role === "admin";
  } catch (err) {
    return false;
  }
};

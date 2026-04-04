import { supabase } from "../supabase";

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function apiFetch(url: string, options: FetchOptions = {}) {
  const { timeout = 30000, ...fetchOptions } = options;

  let apiUrl = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
  
  // If we are in AI Studio (hostname ends with .run.app) or local dev, force relative URLs
  // so we test the code we just wrote, not the deployed Render backend.
  if (typeof window !== "undefined" && (
    window.location.hostname.endsWith(".run.app") || 
    window.location.hostname === "localhost" || 
    window.location.hostname === "127.0.0.1"
  )) {
    apiUrl = "";
  }

  let fullUrl = url.startsWith("http") ? url : `${apiUrl}${url}`;
  
  // Prevent double /api if both apiUrl and url have it
  if (apiUrl.endsWith("/api") && url.startsWith("/api")) {
    fullUrl = `${apiUrl.slice(0, -4)}${url}`;
  }

  // Try to get a fresh session
  let session = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session;
    
    // Proactively refresh if expired or about to expire
    const isExpired = session && session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60;
    
    if (!session || isExpired) {
      const { data: freshSessionData } = await supabase.auth.getSession();
      session = freshSessionData.session;
    }
  } catch (e) {
    console.error("[apiFetch] Error getting session:", e);
  }

  const token = session?.access_token;
  const headers = new Headers(fetchOptions.headers || {});
  
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  
  if (!headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(fullUrl, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(id);

    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { success: response.ok, message: text };
    }

    if (!response.ok) {
      if (response.status === 401) {
        console.error(`[apiFetch] 401 Unauthorized for ${fullUrl}`);
        
        // Only sign out if we're not already on a login/auth page to avoid loops
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login') && !window.location.pathname.includes('/auth')) {
          // Use a flag to prevent multiple sign-outs in a short period
          if (!(window as any)._isSigningOut) {
            (window as any)._isSigningOut = true;
            console.warn("[apiFetch] 401 detected, signing out to clear session...");
            supabase.auth.signOut().then(() => {
              window.location.href = '/login';
            }).finally(() => {
              setTimeout(() => { (window as any)._isSigningOut = false; }, 5000);
            });
          }
        }
      }
      
      const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
      throw new Error(`${errorMsg} (${response.status})`);
    }

    return data;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === "AbortError") {
      throw new Error(`Timeout na requisição (${url}).`);
    }
    console.error(`[apiFetch] Error for ${fullUrl}:`, error);
    throw error;
  }
}

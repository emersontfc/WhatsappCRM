import { supabase } from "../supabase";

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function apiFetch(url: string, options: FetchOptions = {}) {
  const { timeout = 30000, ...fetchOptions } = options;

  let apiUrl = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
  
  // If we are in AI Studio (hostname ends with .run.app), force relative URLs
  // so we test the code we just wrote, not the deployed Render backend.
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".run.app")) {
    apiUrl = "";
  }

  let fullUrl = url.startsWith("http") ? url : `${apiUrl}${url}`;
  
  // Prevent double /api if both apiUrl and url have it
  if (apiUrl.endsWith("/api") && url.startsWith("/api")) {
    fullUrl = `${apiUrl.slice(0, -4)}${url}`;
  }

  console.log(`[apiFetch] Requesting: ${fullUrl}`, { 
    method: fetchOptions.method || "GET",
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL || "NOT_SET").substring(0, 10) + "..."
  });

  // Try to get a fresh session
  let session;
  try {
    // 1. Get current session
    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session;
    
    // 2. Proactively refresh if expired or about to expire
    const isExpired = session && session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60; // 60s buffer
    
    if (!session || isExpired) {
      console.log("[apiFetch] Session missing or expired, refreshing via getUser()");
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: freshSessionData } = await supabase.auth.getSession();
        session = freshSessionData.session;
      }
    }
  } catch (e) {
    console.error("[apiFetch] Error getting/refreshing session:", e);
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
        console.error(`[apiFetch] 401 Unauthorized for ${fullUrl}. Token may be invalid or expired.`);
        
        // Check for project mismatch if we get a 401
        try {
          const debugRes = await fetch(`${apiUrl}/api/debug/auth`);
          if (debugRes.ok) {
            const debugData = await debugRes.json();
            const frontendUrl = (import.meta.env.VITE_SUPABASE_URL || "NOT_SET").substring(0, 15);
            const backendUrl = (debugData.supabaseUrl || "").substring(0, 15);
            
            if (frontendUrl !== backendUrl) {
              const backendDisplay = backendUrl === "NOT_SET" ? "NÃO CONFIGURADO" : `${backendUrl}...`;
              const mismatchMsg = `CRITICAL: Supabase Project Mismatch detected! Frontend: ${frontendUrl}..., Backend: ${backendDisplay}`;
              console.error(`[apiFetch] ${mismatchMsg}`);
              
              const toastMsg = backendUrl === "NOT_SET" 
                ? "Erro de Configuração: O Backend não possui as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY configuradas em Settings."
                : "Erro de Configuração: O Backend está configurado para um projeto Supabase diferente do Frontend. Verifique as variáveis de ambiente.";
              
              // Only toast once per session to avoid spamming
              if (!(window as any)._authMismatchToasted) {
                import("sonner").then(({ toast }) => {
                  toast.error(toastMsg, {
                    duration: 10000,
                    id: "auth-mismatch-toast"
                  });
                });
                (window as any)._authMismatchToasted = true;
              }
            }
          }
        } catch (e) {}
      }
      const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
      const isHtml = typeof data.message === 'string' && data.message.includes('<!DOCTYPE html>');
      const finalMsg = isHtml ? `Server returned HTML error (likely 404 or 500)` : errorMsg;
      throw new Error(`${finalMsg} (${response.status} at ${url})`);
    }

    return data;
  } catch (error: any) {
    clearTimeout(id);
    
    if (error.name === "AbortError") {
      console.warn(`[apiFetch] Request timed out or aborted for ${fullUrl}`);
      throw new Error(`O servidor demorou muito para responder (${url}). Por favor, tente novamente.`);
    }

    console.error(`[apiFetch] Error for ${fullUrl}:`, error);
    
    if (error.message === "Load failed" || error.message === "Failed to fetch" || error.message.includes("NetworkError")) {
      throw new Error(`Erro de conexão com o servidor em ${url}. Verifique sua internet ou tente novamente. (URL: ${fullUrl})`);
    }
    throw error;
  }
}

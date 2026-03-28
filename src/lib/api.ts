import { supabase } from "../supabase";

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function apiFetch(url: string, options: FetchOptions = {}) {
  const { timeout = 15000, ...fetchOptions } = options;

  const apiUrl = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
  let fullUrl = url.startsWith("http") ? url : `${apiUrl}${url}`;
  
  // Prevent double /api if both apiUrl and url have it
  if (apiUrl.endsWith("/api") && url.startsWith("/api")) {
    fullUrl = `${apiUrl.slice(0, -4)}${url}`;
  }

  const { data: { session } } = await supabase.auth.getSession();
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
      data = { success: response.ok, message: await response.text() };
    }

    if (!response.ok) {
      const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
      const isHtml = typeof data.message === 'string' && data.message.includes('<!DOCTYPE html>');
      const finalMsg = isHtml ? `Server returned HTML error (likely 404 or 500)` : errorMsg;
      throw new Error(`${finalMsg} (${response.status} at ${url})`);
    }

    return data;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === "AbortError") {
      throw new Error(`O servidor demorou muito para responder (${url}). Por favor, tente novamente.`);
    }
    if (error.message === "Load failed" || error.message === "Failed to fetch") {
      throw new Error(`Erro de conexão com o servidor em ${url}. Verifique sua internet ou tente novamente.`);
    }
    throw error;
  }
}

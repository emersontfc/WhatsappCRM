import { getSession } from "../supabase";

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function resolveApiUrl(path: string) {
  const browser = typeof window === "undefined" ? undefined : window;
  const origin = browser?.location.origin ?? "http://localhost";
  const runtime = (browser as (Window & { __ENV__?: { VITE_API_URL?: string } }) | undefined)?.__ENV__?.VITE_API_URL;
  const configured = (runtime?.trim() || import.meta.env.VITE_API_URL?.trim() || "").replace(/\/+$/, "");
  const base = new URL(configured || origin, origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new ApiError("O endereço configurado para a API é inválido.");
  }

  if (!path.startsWith("/") || path.startsWith("//")) throw new ApiError("Usa um caminho relativo da API AgentX.");
  const prefix = base.pathname.replace(/\/+$/, "");
  const apiPrefix = prefix.endsWith("/api") && (path === "/api" || path.startsWith("/api/")) ? prefix.slice(0, -4) : prefix;
  const url = new URL(base.origin + apiPrefix + path);
  if (url.origin !== base.origin) throw new ApiError("O endereço do pedido à API é inválido.");
  return url.href;
}

function getSessionBefore(signal: AbortSignal) {
  return new Promise<Awaited<ReturnType<typeof getSession>>>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    getSession().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function apiFetch(path: string, options: FetchOptions = {}) {
  const { timeout = 30000, signal: callerSignal, ...fetchOptions } = options;
  const url = resolveApiUrl(path);
  const controller = new AbortController();
  const { signal } = controller;
  const cancel = () => controller.abort(callerSignal?.reason);
  const timer = setTimeout(() => controller.abort(), timeout);
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener("abort", cancel, { once: true });
  try {
    const session = await getSessionBefore(signal);
    const headers = new Headers(fetchOptions.headers);
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
    headers.set("Accept", "application/json");
    if (typeof fetchOptions.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const response = await fetch(url, { ...fetchOptions, headers, signal });
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (response.status === 204 && response.ok) return undefined;
    const json = /[/+]json\b/i.test(response.headers.get("content-type") ?? "");
    let data;
    if (json) {
      try { data = await response.json(); } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiError("A API devolveu uma resposta inválida. Tenta novamente.", response.status, requestId);
      }
    }

    if (!response.ok) {
      const message = data?.error || data?.message || (response.status === 401
        ? "Sessão expirada. Inicia sessão novamente." : "O servidor não conseguiu concluir a operação.");
      throw new ApiError(`${message} (${response.status})`, response.status, requestId);
    }
    if (!json) throw new ApiError("A API devolveu uma resposta inesperada. Verifica a ligação ao servidor.", response.status, requestId);
    return data;
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (signal.aborted) throw new ApiError("O servidor demorou a responder. Verifica o estado antes de repetir uma operação.");
    if (error instanceof TypeError) throw new ApiError("Não foi possível ligar à API AgentX.");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", cancel);
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, runAI, runCustom, runGemini } from "../backend/agentManager.ts";
import { agentFallbackReply } from "../backend/services/agentFallback.ts";

const { geminiClient, generateContent } = vi.hoisted(() => ({ geminiClient: vi.fn(), generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
    constructor(options: unknown) { geminiClient(options); }
  }
}));

describe("AI provider resilience", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "gemini-flash-latest");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses only the Gemini environment credential and endpoint after another provider fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-fixture-key");
    const fetch = vi.fn().mockResolvedValue(new Response("{\"error\":\"expired\"}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    generateContent.mockResolvedValue({ text: "Resposta do Gemini." });
    const response = await runAI({ provider: "openai", api_key: encrypt("openai-fixture-key") }, "Olá", []);

    expect(response).toBe("Resposta do Gemini.");
    expect(geminiClient).toHaveBeenCalledExactlyOnceWith({ apiKey: "gemini-fixture-key", httpOptions: { retryOptions: { attempts: 1 } } });
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer openai-fixture-key");
  });

  it("tries a different Gemini model once when the configured model is unavailable", async () => {
    generateContent.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ text: "Olá!" });
    expect(await runGemini({ model: "expired-preview", api_key: encrypt("account-key") }, "Oi")).toBe("Olá!");
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual(["expired-preview", "gemini-flash-latest"]);
    expect(generateContent.mock.calls[0][0].config.abortSignal).toBe(generateContent.mock.calls[1][0].config.abortSignal);
  });

  it("keeps the configured Gemini model's retry bounded when the fallback model also fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-fixture-key");
    generateContent.mockRejectedValue({ status: 429 });
    const reply = await runAI({ provider: "gemini", model: "gemini-flash-latest" }, "Olá", []);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(reply).toBe("Olá! Diz-me qual é o produto que procuras ou pede para ver o catálogo.");
  });

  it("rejects provider error bodies and malformed tool calls", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "secret debug data" } }))
      .mockResolvedValueOnce(Response.json({ response: 'Vou criar. {"tool":"createOrder","args":{"productName":"Livro"}' }));
    vi.stubGlobal("fetch", fetch);
    const agent = { provider: "custom", api_url: "https://fixture.invalid" };

    await expect(runCustom(agent, "Olá")).rejects.toThrow("resposta inválida");
    await expect(runCustom(agent, "Comprar")).rejects.toThrow("resposta inválida");
    expect(geminiClient).not.toHaveBeenCalled();
  });

  it("keeps the response body covered by the request deadline", async () => {
    const controller = new AbortController();
    let enteredBody: () => void;
    const readingBody = new Promise<void>((resolve) => { enteredBody = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => ({
      ok: true,
      text: () => new Promise<string>((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        enteredBody();
      })
    })));
    const assertion = expect(runCustom({ api_url: "https://fixture.invalid" }, "Olá", undefined, controller.signal))
      .rejects.toThrow("demorou a responder");

    await readingBody;
    controller.abort();
    await assertion;
  });
});

describe("WhatsApp without a model", () => {
  const products = [
    { name: "Livro do piloto", price: "250", currency: "MT", stock: 2 },
    { name: "Camisa verde", price: 500, currency: "MT", stock: 0 }
  ];

  it("returns recorded prices and distinguishes products without stock", () => {
    expect(agentFallbackReply("Quanto custa o livro do piloto?", products)).toContain("Livro do piloto · 250 MT · 2 em stock");
    expect(agentFallbackReply("A camisa verde está disponível?", products)).toContain("Camisa verde · 500 MT · Esgotado");
    expect(agentFallbackReply("Quero ver o catálogo", products)).not.toContain("Camisa verde");
  });

  it("uses a previously named product for a short follow-up", () => {
    expect(agentFallbackReply("Preço?", products, ["User: Quero saber do livro do piloto", "Agent: Como posso ajudar?"]))
      .toContain("Livro do piloto");
  });

  it("leaves purchases, payments and unavailable catalogue data for the team", () => {
    expect(agentFallbackReply("Quero comprar o livro do piloto, quanto custa?", products)).toBeNull();
    expect(agentFallbackReply("Paguei 250 MT pelo livro do piloto, confirma?", products)).toBeNull();
    expect(agentFallbackReply("Mostra o catálogo", null)).toBeNull();
  });
});

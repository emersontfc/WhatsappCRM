import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, runAI, runCustom, runGemini } from "../backend/agentManager.ts";
import { agentFallbackReply, catalogOrderFromMessage, containsPaymentInstructions, isExplicitPurchase,
  isPaymentQuestion, requestedPaymentMethods, requestsHumanHandoff, suggestsHumanHandoff } from "../backend/services/agentFallback.ts";

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
    { id: "book", name: "Livro do piloto", price: "250", currency: "MT", stock: 2 },
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

  it("treats price questions as read-only even when the buyer mentions a purchase and payment", () => {
    const question = "Quero comprar o livro, quanto custa e aceitam M-Pesa?";
    expect(agentFallbackReply(question, products)).toContain("Livro do piloto · 250 MT · 2 em stock");
    expect(isExplicitPurchase(question)).toBe(false);
    expect(isPaymentQuestion(question)).toBe(true);
    expect(agentFallbackReply("Paguei 250 MT pelo livro do piloto, confirma?", products)).toBeNull();
    expect(agentFallbackReply("Mostra o catálogo", null)).toBeNull();
  });

  it("accepts explicit purchases and recognises an exact item and quantity without the model", () => {
    const order = "Quero comprar 2 unidades de Livro do piloto por e-Mola";
    expect(isExplicitPurchase(order)).toBe(true);
    expect(isPaymentQuestion(order)).toBe(false);
    expect(requestedPaymentMethods(order)).toEqual(["emola"]);
    expect(catalogOrderFromMessage(order, products)).toEqual({ productName: "book", quantity: 2 });
    expect(catalogOrderFromMessage("Quero comprar 2 livros", products)).toBeNull();
    expect(isExplicitPurchase("Não quero comprar o livro")).toBe(false);
  });

  it("recognises an explicit request for a person without assuming handoff for catalogue questions", () => {
    expect(requestsHumanHandoff("Quero falar com uma pessoa.")).toBe(true);
    expect(requestsHumanHandoff("Passe-me para um atendente.")).toBe(true);
    expect(requestsHumanHandoff("Não quero falar com a equipa. Quero consultar o catálogo.")).toBe(false);
    expect(requestsHumanHandoff("Quanto custa o livro?")).toBe(false);
    expect(requestsHumanHandoff("Tens o livro Como Falar Com Uma Pessoa?")).toBe(false);
    expect(suggestsHumanHandoff("Vou passar o teu caso para o atendimento humano.")).toBe(true);
  });

  it("identifies payment directions in untrusted provider replies", () => {
    expect(containsPaymentInstructions("Paga por M-Pesa para 84 123 4567")).toBe(true);
    expect(containsPaymentInstructions("Link de pagamento: https://payments.invalid")).toBe(true);
    expect(containsPaymentInstructions("Aceitamos M-Pesa. O livro custa 250 MT.")).toBe(false);
  });

  it("uses a short number follow-up only in the context of a payment conversation", () => {
    expect(isPaymentQuestion("E qual é o número?", ["User: Dá para pagar por e-Mola?", "Agent: Aceitamos e-Mola."])).toBe(true);
    expect(isPaymentQuestion("E qual é o número?", ["Agent: A loja abre às 9 horas."])).toBe(false);
  });
});

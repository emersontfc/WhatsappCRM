import { supabaseAdmin } from "./supabaseAdmin";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "your-fallback-encryption-key-32-chars-long";
const IV_LENGTH = 16;

export function encrypt(text: string) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
  } catch (e) {
    return text;
  }
}

export function decrypt(text: string) {
  try {
    const textParts = text.split(":");
    if (textParts.length !== 2) return text;
    const iv = Buffer.from(textParts.shift()!, "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text; // Fallback se não estiver criptografado
  }
}

export function normalizeResponse(data: any): string {
  if (typeof data === 'string') return data;
  
  if (data?.response) return data.response;
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data?.generated_text) return data.generated_text;
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (data?.text) return data.text;
  if (data?.message) return data.message;
  
  return JSON.stringify(data);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

async function runGemini(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = agent.api_key ? decrypt(agent.api_key) : process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API Key missing. Please set GEMINI_API_KEY in Settings.");
  
  const ai = new GoogleGenAI({ apiKey });
  const modelName = agent.model || "gemini-3-flash-preview";
  
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction
      }
    });
    return response.text || "Sem resposta.";
  } catch (err: any) {
    console.error(`[AI Engine] Gemini Error (${modelName}):`, err.message);
    if (err.message.includes("404") || err.message.includes("not found")) {
      // Try fallback model name
      const fallbackModel = "gemini-1.5-flash";
      console.log(`[AI Engine] Retrying with fallback model: ${fallbackModel}`);
      const fallbackRes = await ai.models.generateContent({
        model: fallbackModel,
        contents: prompt,
        config: { systemInstruction }
      });
      return fallbackRes.text || "Sem resposta.";
    }
    throw err;
  }
}

async function runOpenAI(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("OpenAI API Key missing");

  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${apiKey}` 
    },
    body: JSON.stringify({
      model: agent.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt }
      ],
      max_tokens: 500
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Error: ${err}`);
  }
  
  const data = await response.json();
  return normalizeResponse(data);
}

async function runDeepSeek(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("DeepSeek API Key missing");

  const url = agent.api_url || "https://api.deepseek.com/v1/chat/completions";
  console.log(`[AI Engine] DeepSeek request to: ${url}`);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${apiKey}` 
    },
    body: JSON.stringify({
      model: agent.model || "deepseek-chat",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt }
      ],
      max_tokens: 500
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek Error: ${err}`);
  }
  
  const data = await response.json();
  return normalizeResponse(data);
}

async function runHuggingFace(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("Hugging Face API Key missing");
  
  const model = agent.model || "mistralai/Mistral-7B-Instruct-v0.2";
  const fullPrompt = `SYSTEM:\n${systemInstruction}\n\n${prompt}`;

  const response = await fetchWithTimeout(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${apiKey}` 
    },
    body: JSON.stringify({
      inputs: fullPrompt,
      parameters: {
        max_new_tokens: 500,
        temperature: 0.7
      }
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Hugging Face Error: ${err}`);
  }
  
  const data = await response.json();
  return normalizeResponse(data);
}

async function runCustom(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  if (!agent.api_url) throw new Error("Custom API URL missing");
  
  const apiKey = agent.api_key ? decrypt(agent.api_key) : "";
  const isChatCompletion = agent.api_url.includes("/chat/completions") || agent.model;

  const body = isChatCompletion ? {
    model: agent.model || "gpt-3.5-turbo",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt }
    ],
    max_tokens: 500
  } : {
    message: prompt,
    system: systemInstruction,
    prompt: `SYSTEM:\n${systemInstruction}\n\nUSER:\n${prompt}`
  };

  const response = await fetchWithTimeout(agent.api_url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}) 
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Custom API Error: ${err}`);
  }
  
  const data = await response.json();
  return normalizeResponse(data);
}

export async function runAI(agent: any, message: string, context: string[]): Promise<string> {
  const systemInstruction = agent.instructions || "Você é um assistente útil.";
  const contextStr = context.slice(-5).join("\n");
  const prompt = contextStr ? `CONTEXT:\n${contextStr}\n\nUSER:\n${message}` : message;
  
  const providers: Record<string, (agent: any, prompt: string, systemInstruction?: string) => Promise<string>> = {
    gemini: runGemini,
    openai: runOpenAI,
    deepseek: runDeepSeek,
    huggingface: runHuggingFace,
    custom: runCustom,
  };

  const handler = providers[agent.provider || "gemini"];
  
  if (!handler) {
    console.error(`[AI Engine] Provider ${agent.provider} not supported.`);
    return "Desculpe, provedor de IA não suportado.";
  }

  try {
    console.log("Using AI model:", agent.model || agent.provider);
    console.log("Prompt:", systemInstruction);
    console.log(`[AI Engine] Requesting ${agent.provider}...`);
    return await handler(agent, prompt, systemInstruction);
  } catch (err: any) {
    console.error(`[AI Engine] Error in ${agent.provider}:`, err.message);
    
    // Fallback to Gemini if primary fails and it's not already Gemini
    if (agent.provider !== "gemini") {
      console.log(`[AI Engine] Falling back to Gemini...`);
      try {
        return await runGemini(agent, prompt, systemInstruction);
      } catch (fallbackErr: any) {
        console.error(`[AI Engine] Fallback to Gemini failed:`, fallbackErr.message);
      }
    }
    
    return "Desculpe, estou com dificuldade para responder agora.";
  }
}

// In-memory context cache
const contextCache: Map<string, string[]> = new Map();

export async function handleAgentMessage(whatsappManager: any, userId: string, jid: string, text: string) {
  try {
    const { data: agents, error } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(`[AI Engine] Error fetching agent for user ${userId}:`, error.message);
      return;
    }

    const agent = agents && agents.length > 0 ? agents[0] : null;
    if (!agent) {
      console.log(`[AI Engine] No active agent found for user ${userId}`);
      return;
    }
    
    if (jid.includes("@g.us")) {
      console.log(`[AI Engine] Skipping group message from ${jid}`);
      return;
    }
    
    if (text.trim().length < 2) {
      console.log(`[AI Engine] Message too short: "${text}"`);
      return;
    }

    // Check subscription
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!sub) {
      console.log(`[AI Engine] No subscription found for user ${userId}`);
      return;
    }

    // Check if subscription is expired (unless it's a Free plan)
    if (sub.plan !== 'Free' && sub.end_date) {
      const endDate = new Date(sub.end_date);
      if (endDate < new Date()) {
        console.log(`[AI Engine] User ${userId} subscription expired.`);
        return;
      }
    }

    // Fetch dynamic plan limits
    const { data: planData, error: planError } = await supabaseAdmin
      .from("plans")
      .select("max_messages_per_day, ai_enabled")
      .eq("id", sub.plan_id)
      .maybeSingle();

    if (planError || !planData) {
      console.log(`[AI Engine] Plan not found for user ${userId}.`);
      return;
    }

    if (!planData.ai_enabled) {
      console.log(`[AI Engine] AI is disabled for user ${userId}'s plan.`);
      return;
    }

    const limit = planData.max_messages_per_day;
    const currentUsed = sub.messages_used || 0;
    if (currentUsed >= limit) {
      console.log(`[AI Engine] User ${userId} reached message limit (${currentUsed}/${limit}).`);
      return;
    }

    const contextKey = `${userId}:${jid}`;
    let context = contextCache.get(contextKey) || [];
    
    await whatsappManager.sendPresenceUpdate(userId, jid, "composing");
    
    // Random delay between 5-15s to simulate human typing
    const delay = Math.floor(Math.random() * 10000) + 5000;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const responseText = await runAI(agent, text, context);
    
    await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

    if (responseText) {
      await whatsappManager.sendMessage(userId, jid, responseText);
      
      // Increment usage
      await supabaseAdmin
        .from("subscriptions")
        .update({ messages_used: currentUsed + 1 })
        .eq("user_id", userId);

      context.push(`User: ${text}`);
      context.push(`Agent: ${responseText}`);
      if (context.length > 10) context = context.slice(-10);
      contextCache.set(contextKey, context);

      await whatsappManager.log(userId, "info", `Agente IA respondeu para ${jid}`, { provider: agent.provider, response: responseText });
    }
  } catch (err) {
    console.error("Agent handler error:", err);
  }
}

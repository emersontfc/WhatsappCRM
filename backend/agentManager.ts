import { supabaseAdmin } from "./supabaseAdmin.ts";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { executeAction } from "./actionEngine.ts";
import { executeToolByName, getToolsPromptDescription, UserRole, ToolResult } from "./tools/index.ts";

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

async function fetchWithTimeout(url: string, options: RequestInit, timeout = 30000): Promise<Response> {
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

export async function runGemini(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
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
      const fallbackModel = "gemini-3-flash-preview";
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

export async function runOpenAI(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("OpenAI API Key missing");

  const url = (agent.api_url || "https://api.openai.com/v1/chat/completions").trim();

  const response = await fetchWithTimeout(url, {
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

export async function runDeepSeek(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("DeepSeek API Key missing");

  const url = (agent.api_url || "https://api.deepseek.com/v1/chat/completions").trim();
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

export async function runHuggingFace(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
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

export async function runOpenRouter(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = decrypt(agent.api_key);
  if (!apiKey) throw new Error("OpenRouter API Key missing");

  const url = (agent.api_url || "https://openrouter.ai/api/v1/chat/completions").trim();

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://agentex.com.br", // Optional, for OpenRouter rankings
      "X-Title": "Agentex" // Optional, for OpenRouter rankings
    },
    body: JSON.stringify({
      model: agent.model || "google/gemini-2.0-flash-001",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt }
      ],
      max_tokens: 500
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter Error: ${err}`);
  }
  
  const data = await response.json();
  return normalizeResponse(data);
}

export async function runCustom(agent: any, prompt: string, systemInstruction?: string): Promise<string> {
  let url = (agent.api_url || "").trim();
  if (!url) throw new Error("Custom API URL missing");
  
  const apiKey = agent.api_key ? decrypt(agent.api_key) : "";
  
  // Auto-append /chat/completions if it looks like a base URL and a model is provided
  if (agent.model && !url.includes("/chat/completions") && !url.includes("/completions")) {
    // If it ends with /models, it's likely the wrong endpoint for chat
    if (url.endsWith("/models")) {
      url = url.replace(/\/models$/, "/chat/completions");
    } else {
      url = url.replace(/\/$/, "") + "/chat/completions";
    }
  }

  const isChatCompletion = url.includes("/chat/completions") || agent.model;

  const body = isChatCompletion ? {
    ...(agent.model ? { model: agent.model } : {}),
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

  const response = await fetchWithTimeout(url, {
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

export async function runAI(agent: any, message: string, context: string[], role: UserRole = "lead"): Promise<string> {
  let roleHeader = "";
  let baseInstruction = "";

  if (role === "admin") {
    roleHeader = `ATENÇÃO: VOCÊ ESTÁ CONVERSANDO COM O SEU ADMINISTRADOR / CHEFE / DONO DO SISTEMA.
O SEU PAPEL É DE OPERADOR EXECUTIVO DO NEGÓCIO E CRM.
NÃO TENTE VENDER NADA PARA ELE! Ele é o proprietário / gestor da empresa.
Você tem total poder e acesso às ferramentas do sistema para executar o que ele pedir (consultar métricas do funil, verificar conversas pendentes, agendar mensagens, agendar postagens no status, criar regras de automação, pausar ou retomar IA, cadastrar leads, etc.).
Seja ágil, prestativo e direto.`;
    baseInstruction = "Seja extremamente eficiente e execute os comandos solicitados através das ferramentas apropriadas.";
  } else {
    roleHeader = "VOCÊ É O AGENTEX ATENDENTE, assistente virtual de atendimento ao cliente. Ajude o cliente com cordialidade, tire dúvidas e qualifique o interesse do lead.";
    baseInstruction = agent.instructions || "Você é um assistente útil e inteligente.";
  }

  const toolsInstruction = getToolsPromptDescription(role);
  const systemInstruction = `${roleHeader}\n\n${baseInstruction}\n\n${toolsInstruction}`;
  const contextStr = context.slice(-5).join("\n");
  const prompt = contextStr ? `CONTEXT:\n${contextStr}\n\nUSER:\n${message}` : message;
  
  const providers: Record<string, (agent: any, prompt: string, systemInstruction?: string) => Promise<string>> = {
    gemini: runGemini,
    openai: runOpenAI,
    openrouter: runOpenRouter,
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
        return await runGemini({ ...agent, model: "gemini-2.5-flash" }, prompt, systemInstruction);
      } catch (fallbackErr: any) {
        console.error(`[AI Engine] Fallback to Gemini failed:`, fallbackErr.message);
      }
    }
    
    return "Desculpe, estou com dificuldade para responder agora.";
  }
}

// In-memory context cache
const contextCache: Map<string, string[]> = new Map();

export function robustParseAgentJSON(raw: string): { reply: string; tool: string | null; args: any; action?: string; intent?: string; data?: any } | null {
  if (!raw) return null;
  let text = raw.trim();
  
  // 1. Strip markdown code fence
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

  // 2. Direct JSON.parse attempt
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") {
      return {
        reply: typeof obj.reply === "string" ? obj.reply : (obj.message || ""),
        tool: obj.tool || null,
        args: obj.args || {},
        action: obj.action,
        intent: obj.intent,
        data: obj.data
      };
    }
  } catch (e) {}

  // 3. Extract JSON object substring between first '{' and last '}'
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = text.substring(start, end + 1);
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === "object") {
        return {
          reply: typeof obj.reply === "string" ? obj.reply : (obj.message || ""),
          tool: obj.tool || null,
          args: obj.args || {},
          action: obj.action,
          intent: obj.intent,
          data: obj.data
        };
      }
    } catch (e2) {
      // 4. Try sanitizing unescaped newlines inside strings
      try {
        const sanitized = candidate.replace(/(:\s*"[\s\S]*?")/g, (match) => {
          return match.replace(/\r?\n/g, "\\n");
        });
        const obj = JSON.parse(sanitized);
        if (obj && typeof obj === "object") {
          return {
            reply: typeof obj.reply === "string" ? obj.reply : (obj.message || ""),
            tool: obj.tool || null,
            args: obj.args || {},
            action: obj.action,
            intent: obj.intent,
            data: obj.data
          };
        }
      } catch (e3) {}
    }
  }

  // 5. Regex extraction fallback if JSON syntax is damaged
  try {
    const toolMatch = text.match(/"tool"\s*:\s*("([^"]+)"|null)/i);
    const replyMatch = text.match(/"reply"\s*:\s*"([\s\S]*?)(?=",\s*"(tool|args)"|"\s*\})/i);
    let tool = toolMatch && toolMatch[2] ? toolMatch[2] : null;
    let reply = replyMatch ? replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : "";
    let args: any = {};
    const argsMatch = text.match(/"args"\s*:\s*(\{[\s\S]*?\})/i);
    if (argsMatch) {
      try { args = JSON.parse(argsMatch[1]); } catch (e4) {}
    }
    if (tool || reply) {
      return { reply, tool, args };
    }
  } catch (e5) {}

  return null;
}

export function formatToolOutputForWhatsApp(toolName: string, result: ToolResult): string {
  if (!result.success) {
    return `❌ *Falha ao executar ${toolName}*: ${result.message || 'Erro durante a operação.'}`;
  }

  let formatted = `✅ ${result.message || 'Operação realizada com sucesso.'}`;

  if (toolName === "get_pending_conversations" && result.data?.conversas?.length > 0) {
    const list = result.data.conversas.slice(0, 5).map((c: any, i: number) => {
      const unreadBadge = c.mensagensNaoLidas > 0 ? ` (${c.mensagensNaoLidas} não lidas)` : "";
      return `*${i + 1}. ${c.nome}* [${c.telefone}]${unreadBadge}\n   💬 _"${c.ultimaMensagem}"_`;
    }).join("\n\n");
    formatted += `\n\n📌 *Conversas Pendentes:*\n${list}`;
  } else if (toolName === "get_pipeline_metrics" && result.data) {
    const stages = result.data.distribuicaoEtapas || {};
    const stageLines = Object.entries(stages)
      .map(([st, count]) => `• *${st.toUpperCase()}*: ${count} lead(s)`)
      .join("\n");
    formatted += `\n\n📊 *Distribuição do Funil:*\n${stageLines || "Nenhum lead encontrado."}`;
  } else if (toolName === "search_contact" && result.data?.contact) {
    const c = result.data.contact;
    formatted += `\n\n👤 *${c.name || 'Sem nome'}*\n📱 Telefone: ${c.phone}\n🏷️ Tags: ${(c.tags || []).join(', ') || 'Nenhuma'}\n🤖 IA: ${c.ai_paused ? 'Pausada' : 'Ativa'}`;
  } else if (toolName === "create_lead" && result.data) {
    formatted += `\n\n👤 *Lead Cadastrado*: ${result.data.name || ''}\n📱 *Telefone*: ${result.data.phone || ''}\n🏷️ *Etapa*: ${result.data.stage || 'novo'}`;
  } else if (toolName === "schedule_message" && result.data) {
    formatted += `\n\n📅 *Agendado para*: ${result.data.dataAgendada || ''}\n👤 *Destinatário*: ${result.data.contacto || ''}`;
  } else if (toolName === "schedule_status" && result.data) {
    formatted += `\n\n📅 *Status agendado para*: ${result.data.dataAgendada || ''}`;
  }

  return formatted;
}

export async function handleAgentMessage(whatsappManager: any, userId: string, jid: string, text: string, isSelfMessage: boolean = false) {
  try {
    console.log(`[AI Engine] Checking agents for ${userId}, text: "${text}" (isSelfMessage: ${isSelfMessage})`);
    let { data: agents, error } = await supabaseAdmin
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

    if (!agents || agents.length === 0) {
      const { data: anyAgents } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("user_id", userId)
        .not("api_key", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (anyAgents && anyAgents.length > 0) {
        agents = anyAgents;
      }
    }

    const agent = agents && agents.length > 0 ? agents[0] : null;
    if (!agent) {
      console.log(`[AI Engine] No active or configured agent found for user ${userId}`);
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

    // Check contact and clean phone
    const phone = jid.split("@")[0];
    const cleanSenderPhone = phone.replace(/\D/g, "");

    const { data: contactData } = await supabaseAdmin
      .from("contacts")
      .select("id, ai_paused, name, tags")
      .eq("user_id", userId)
      .eq("phone", phone)
      .maybeSingle();

    // Determine if sender is the administrator, account owner or authorized manager
    const myInfo = whatsappManager.getMe(userId);
    const myPhone = myInfo?.id ? myInfo.id.split(":")[0].replace(/\D/g, "") : "";
    const myLid = myInfo?.lid ? myInfo.lid.split(":")[0].replace(/\D/g, "") : "";

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("phone, admin_phones, role")
      .eq("id", userId)
      .maybeSingle();

    // Number matching helper tolerating Mozambique 258 prefix differences
    const matchesNumber = (a: string, b: string) => {
      if (!a || !b) return false;
      const cleanA = a.replace(/\D/g, "");
      const cleanB = b.replace(/\D/g, "");
      if (!cleanA || !cleanB) return false;
      if (cleanA === cleanB) return true;
      const noPrefixA = cleanA.startsWith("258") ? cleanA.slice(3) : cleanA;
      const noPrefixB = cleanB.startsWith("258") ? cleanB.slice(3) : cleanB;
      return noPrefixA.length >= 8 && noPrefixB.length >= 8 && noPrefixA === noPrefixB;
    };

    const rawList = [
      myPhone,
      myLid,
      userData?.phone,
      ...(userData?.admin_phones ? userData.admin_phones.split(/[\n,;]+/) : [])
    ].filter(Boolean);

    const isContactAdmin = contactData && (
      /emerson/i.test(contactData.name || "") ||
      (Array.isArray(contactData.tags) && contactData.tags.some((t: string) => /admin|gerente|proprietario|dono/i.test(t)))
    );

    const isOwner = isSelfMessage || 
                    rawList.some(adminNum => matchesNumber(cleanSenderPhone, String(adminNum))) ||
                    (Boolean(myLid) && cleanSenderPhone === myLid) ||
                    (Boolean(myPhone) && cleanSenderPhone === myPhone) ||
                    Boolean(isContactAdmin);

    const role: UserRole = isOwner ? "admin" : "lead";

    console.log(`[AI Engine] Message evaluation for ${jid}:`);
    console.log(`  - cleanSenderPhone: ${cleanSenderPhone}, isSelf: ${isSelfMessage}`);
    console.log(`  - contactName: "${contactData?.name || ''}"`);
    console.log(`  - isOwner: ${isOwner}, role: ${role}`);

    if (isOwner) {
      console.log(`[AI Engine] Message from AUTHORIZED ADMIN/MANAGER (${cleanSenderPhone}). Granting operational tools.`);
    }

    // Leads are skipped if human takeover (ai_paused) is active
    if (!isOwner && contactData?.ai_paused) {
      console.log(`[AI Engine] AI is paused for contact ${phone} (${contactData.name || "Human assumed"}). Skipping AI.`);
      return;
    }

    const isAdmin = isOwner || userData?.role === 'admin';

    // Check subscription if not admin
    let currentUsed = 0;
    if (!isAdmin) {
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
      currentUsed = sub.messages_used || 0;
      if (currentUsed >= limit) {
        console.log(`[AI Engine] User ${userId} reached message limit (${currentUsed}/${limit}).`);
        return;
      }
    }

    const contextKey = `${userId}:${jid}`;
    let context = contextCache.get(contextKey) || [];
    
    await whatsappManager.sendPresenceUpdate(userId, jid, "composing");
    
    // Typing delay (faster for admin operator: 1.5-3s, human-like for leads: 3-6s)
    const delay = isOwner ? Math.floor(Math.random() * 1500) + 1200 : Math.floor(Math.random() * 3000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const responseText = await runAI(agent, text, context, role);
    
    await whatsappManager.sendPresenceUpdate(userId, jid, "paused");

    if (responseText) {
      const parsed = robustParseAgentJSON(responseText);
      let finalReply = responseText;
      let actionResult: any = null;

      // Handle structured tool or action execution
      if (parsed && typeof parsed === 'object') {
        finalReply = parsed.reply || "";
        
        // 1. Tool Registry execution (New Agentic Architecture)
        if (parsed.tool) {
          console.log(`[AI Engine] Executing Tool: "${parsed.tool}" for role "${role}" with args:`, JSON.stringify(parsed.args));
          const toolResult = await executeToolByName(parsed.tool, parsed.args || {}, {
            userId,
            phone: cleanSenderPhone,
            jid,
            role,
            whatsappManager,
            userPhone: myPhone
          });

          if (toolResult) {
            actionResult = toolResult;
            const formatted = formatToolOutputForWhatsApp(parsed.tool, toolResult);
            if (!finalReply || finalReply.trim().length === 0) {
              finalReply = formatted;
            } else {
              finalReply = `${finalReply}\n\n${formatted}`;
            }
          }
        } else if (parsed.action) {
          // 2. Legacy action execution fallback
          console.log(`[AI Engine] AI suggested legacy action: ${parsed.action} with intent: ${parsed.intent}`);
          actionResult = await executeAction({
            action: parsed.action,
            data: parsed.data || {},
            userId,
            phone: cleanSenderPhone,
            intent: parsed.intent
          });
        }
      } else {
        // Plain text fallback: strip markdown json wrappers if present
        finalReply = responseText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      }

      if (finalReply) {
        await whatsappManager.sendMessage(userId, jid, finalReply);
      }
      
      // Increment usage if not admin
      if (!isAdmin) {
        await supabaseAdmin
          .from("subscriptions")
          .update({ messages_used: currentUsed + 1 })
          .eq("user_id", userId);
      }

      context.push(`User: ${text}`);
      context.push(`Agent: ${finalReply}`);
      if (context.length > 10) context = context.slice(-10);
      contextCache.set(contextKey, context);

      await whatsappManager.log(userId, "info", `Agente IA respondeu para ${jid}`, { 
        provider: agent.provider, 
        response: finalReply,
        intent: parsed?.intent,
        action: parsed?.tool || parsed?.action,
        action_success: actionResult?.success
      });
    }
  } catch (err) {
    console.error("Agent handler error:", err);
  }
}

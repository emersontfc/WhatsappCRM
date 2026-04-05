import express from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { encrypt, decrypt } from "../agentManager.ts";
import { AuthRequest } from "../middleware/auth.ts";

const router = express.Router();

const ALLOWED_PROVIDERS = ["gemini", "openai", "openrouter", "deepseek", "huggingface", "custom"];

router.get("/providers/models", async (req: AuthRequest, res) => {
  console.log("[Agent API] Fetching providers/models...");
  res.json({
    success: true,
    data: {
      gemini: ["gemini-3-flash-preview", "gemini-3.1-flash-preview", "gemini-3.1-pro-preview"],
      openai: ["gpt-4o-mini", "gpt-3.5-turbo", "gpt-4o"],
      openrouter: ["google/gemini-2.0-flash-001", "meta-llama/llama-3.1-8b-instruct", "deepseek/deepseek-chat"],
      deepseek: ["deepseek-chat"],
      huggingface: ["mistralai/Mistral-7B-Instruct-v0.2"],
      custom: []
    }
  });
});

router.get("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const { data: agents, error } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
      
    if (error) {
      console.error("Error fetching agent:", error);
      // If table doesn't exist, return empty object
      if (error.code === '42P01') {
        return res.json({ success: true, data: {} });
      }
      throw error;
    }
    
    const data = agents && agents.length > 0 ? agents[0] : {};
    
    if (data && data.api_key) {
      // Don't send the full key, just a placeholder
      data.api_key = "********";
    }
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to fetch agent:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/create-or-update", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { provider, api_key, api_url, model, instructions, is_active } = req.body;
  
  console.log(`[Agent API] Saving config for user ${userId}, provider: ${provider}`);
  
  try {
    // Check if agent exists
    console.log(`[Agent API] Fetching existing agent...`);
    const { data: agents, error: fetchError } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error(`[Agent API] Error fetching existing agent:`, fetchError);
      throw fetchError;
    }

    const existingAgent = agents && agents.length > 0 ? agents[0] : null;

    console.log(`[Agent API] Existing agent found:`, !!existingAgent);

    console.log(`[Agent API] Processing API key...`);
    let encryptedKey = existingAgent?.api_key || null;
    
    if (api_key === "") {
      console.log(`[Agent API] Clearing API key...`);
      encryptedKey = null;
    } else if (api_key && api_key !== "********") {
      console.log(`[Agent API] Encrypting new API key...`);
      encryptedKey = encrypt(api_key);
    } else if (existingAgent && provider !== existingAgent.provider) {
      console.log(`[Agent API] Provider changed from ${existingAgent.provider} to ${provider}. Clearing old API key...`);
      encryptedKey = null;
    } else {
      console.log(`[Agent API] Keeping existing key (or null)...`);
    }

    // Validate provider
    let validatedProvider = provider || 'gemini';
    if (!ALLOWED_PROVIDERS.includes(validatedProvider)) {
      console.warn(`[Agent API] Invalid provider received: "${validatedProvider}". Defaulting to "gemini".`);
      validatedProvider = 'gemini';
    }

    // Workaround for database constraint: if provider is deepseek, we might need to use 'custom' 
    // if the DB hasn't been updated. But for now, let's try to save it as is.
    // If it fails with a constraint error, we can't easily fix it here without changing the DB.
    
    const agentData: any = {
      user_id: userId,
      provider: validatedProvider,
      api_key: encryptedKey,
      api_url: (api_url || (validatedProvider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : '')).trim(),
      model: model || (validatedProvider === 'gemini' ? 'gemini-3-flash-preview' : ''),
      instructions,
      is_active: is_active ?? existingAgent?.is_active ?? false,
      created_at: existingAgent ? existingAgent.created_at : new Date().toISOString(),
    };

    if (existingAgent) {
      agentData.id = existingAgent.id;
    }

    console.log(`[Agent API] Saving agent data to database...`);
    let result;
    try {
      if (existingAgent) {
        console.log(`[Agent API] Updating existing agent ${existingAgent.id}...`);
        result = await supabaseAdmin
          .from("agents")
          .update(agentData)
          .eq("id", existingAgent.id)
          .select()
          .single();
      } else {
        console.log(`[Agent API] Inserting new agent for user ${userId}...`);
        result = await supabaseAdmin
          .from("agents")
          .insert(agentData)
          .select()
          .single();
      }

      // Fallback for check constraint violation
      if (result.error && result.error.message.includes('violates check constraint "agents_provider_check"')) {
        console.warn(`[Agent API] Provider "${validatedProvider}" rejected by DB constraint. Retrying as "custom"...`);
        
        // If we already tried 'custom' and it failed, don't try again to avoid any weirdness
        if (validatedProvider === 'custom') {
          console.error(`[Agent API] Even "custom" provider failed DB constraint.`);
          throw result.error;
        }

        const fallbackData = { 
          ...agentData, 
          provider: 'custom',
          api_url: agentData.api_url || (validatedProvider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : '')
        };
        
        if (existingAgent) {
          result = await supabaseAdmin
            .from("agents")
            .update(fallbackData)
            .eq("id", existingAgent.id)
            .select()
            .single();
        } else {
          result = await supabaseAdmin
            .from("agents")
            .insert(fallbackData)
            .select()
            .single();
        }
      }
    } catch (dbErr: any) {
      console.error(`[Agent API] Database exception:`, dbErr);
      throw dbErr;
    }
    
    const { data, error } = result;

    if (error) {
      console.error(`[Agent API] Database error during save:`, error.message);
      console.error(`[Agent API] Error details:`, JSON.stringify(error, null, 2));
      console.error(`[Agent API] Attempted data:`, JSON.stringify(agentData, null, 2));
      throw error;
    }
    
    console.log(`[Agent API] Agent saved successfully with ID: ${data?.id}`);
    
    if (data && data.api_key) {
      data.api_key = "********";
    }
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("[Agent API] Failed to save agent:", err);
    res.status(500).json({ success: false, error: err.message || "Erro interno ao salvar agente" });
  }
});

router.post("/toggle", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { is_active } = req.body;
  
  try {
    // Check if agent exists
    const { data: existingAgent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    let data, error;

    if (existingAgent) {
      ({ data, error } = await supabaseAdmin
        .from("agents")
        .update({ is_active })
        .eq("id", existingAgent.id)
        .select()
        .single());
    } else {
      const defaultProvider = "gemini";
      ({ data, error } = await supabaseAdmin
        .from("agents")
        .insert({ 
          user_id: userId, 
          is_active, 
          provider: defaultProvider, 
          model: 'gemini-3-flash-preview',
          instructions: "Você é um assistente de vendas prestativo para o Agentex. Responda de forma educada e profissional." 
        })
        .select()
        .single());
    }

    if (error) {
      console.error(`[Agent API] Toggle error:`, error.message);
      console.error(`[Agent API] Toggle error details:`, JSON.stringify(error, null, 2));
      throw error;
    }
    
    if (data && data.api_key) {
      data.api_key = "********";
    }
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to toggle agent:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/test", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, error: "Message is required" });

  try {
    // Get agent config
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!agent) {
      return res.status(404).json({ success: false, error: "Agente não configurado." });
    }

    // Call agentManager directly for testing (bypassing subscription checks for the test route)
    const { runGemini, runOpenAI, runOpenRouter, runDeepSeek, runHuggingFace, runCustom } = await import("../agentManager.ts");
    
    let responseText = "";
    const systemPrompt = agent.instructions || "Você é um assistente útil.";
    
    switch (agent.provider) {
      case "gemini":
        responseText = await runGemini(agent, message, systemPrompt);
        break;
      case "openai":
        responseText = await runOpenAI(agent, message, systemPrompt);
        break;
      case "openrouter":
        responseText = await runOpenRouter(agent, message, systemPrompt);
        break;
      case "deepseek":
        responseText = await runDeepSeek(agent, message, systemPrompt);
        break;
      case "huggingface":
        responseText = await runHuggingFace(agent, message, systemPrompt);
        break;
      case "custom":
        responseText = await runCustom(agent, message, systemPrompt);
        break;
      default:
        return res.status(400).json({ success: false, error: "Provedor não suportado." });
    }

    res.json({ success: true, data: { response: responseText } });
  } catch (error: any) {
    console.error("[Agent Test Error]:", error);
    res.status(500).json({ success: false, error: error.message || "Erro interno ao testar agente." });
  }
});

export default router;

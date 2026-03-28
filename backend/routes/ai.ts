import express from "express";
import { GoogleGenAI } from "@google/genai";
import { decrypt } from "../agentManager";
import { AuthRequest } from "../middleware/auth";
import { supabaseAdmin } from "../supabaseAdmin";

const router = express.Router();

router.post("/suggest", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: "messages array is required" });
  }

  try {
    // Fetch user's agent config to see if they have their own API key
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "gemini")
      .maybeSingle();

    let apiKey = process.env.GEMINI_API_KEY!;
    if (agent && agent.api_key) {
      apiKey = decrypt(agent.api_key);
    }

    if (!apiKey) {
      return res.status(500).json({ success: false, error: "Gemini API Key missing" });
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = agent?.model || "gemini-3-flash-preview";

    const prompt = `
      Você é um assistente de CRM para WhatsApp. 
      Analise o histórico de mensagens abaixo e sugira uma resposta curta, profissional e amigável em português de Moçambique/Brasil.
      
      Contexto do Cliente: ${JSON.stringify(context || {})}
      
      Histórico:
      ${messages.map((m: any) => `${m.type === 'inbound' ? 'Cliente' : 'Você'}: ${m.text}`).join('\n')}
      
      Sugira apenas o texto da resposta, sem comentários adicionais.
    `;

    const result = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    res.json({ success: true, data: { suggestion: result.text } });
  } catch (err: any) {
    console.error("AI suggestion error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/subscription", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError) throw profileError;

    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("*, plans(*)")
      .eq("user_id", userId)
      .single();

    // It's okay if subscription doesn't exist yet, we'll return the profile
    res.json({ 
      success: true, 
      data: {
        ...profile,
        subscription: subscription || null,
        planDetails: subscription?.plans || null
      }
    });
  } catch (err: any) {
    console.error("Failed to fetch subscription:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import express from "express";
import { GoogleGenAI } from "@google/genai";
import { decrypt, runAI } from "../agentManager";
import { AuthRequest } from "../middleware/auth";
import { supabaseAdmin } from "../supabaseAdmin";

const router = express.Router();

router.post("/chat", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { message, agentId } = req.body;
  if (!message) return res.status(400).json({ success: false, error: "Message is required" });

  try {
    let agent;
    if (agentId) {
      const { data } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .eq("user_id", userId)
        .single();
      agent = data;
    } else {
      const { data } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      agent = data;
    }

    if (!agent) {
      console.log("Agent not found, using default fallback");
      agent = {
        provider: "gemini",
        model: "gemini-3-flash-preview",
        instructions: "Você é um assistente útil."
      };
    }

    console.log("Using AI model:", agent.model || agent.provider);
    console.log("Prompt:", agent.instructions);

    const reply = await runAI(agent, message, []);
    res.json({ reply });
  } catch (err: any) {
    console.error("AI chat error:", err);
    res.json({ reply: "Desculpe, estou com dificuldade para responder agora." });
  }
});

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
    console.log(`[AI API] Fetching/Initializing subscription for user ${userId}`);
    
    // 1. Ensure profile and subscription exist
    console.log(`[AI API] Calling supabaseAdmin for user ${userId}`);
    const [profileResult, subResult] = await Promise.all([
      supabaseAdmin.from("users").select("*").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("subscriptions").select("*, plans(*)").eq("user_id", userId).maybeSingle()
    ]);
    console.log(`[AI API] supabaseAdmin calls completed for user ${userId}`);

    let profile = profileResult.data;
    let subscription = subResult.data;

    const adminEmail = process.env.ADMIN_EMAIL || "alcindacharles@gmail.com";
    const isInitialAdmin = req.user?.email === adminEmail;

    if (profile && isInitialAdmin && profile.role !== "admin") {
      console.log(`[AI API] Upgrading user ${userId} to admin role`);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ role: "admin", plan: "Admin" })
        .eq("id", userId)
        .select()
        .single();
      if (updateError) console.error(`[AI API] Error upgrading profile:`, updateError);
      else profile = updatedProfile;
    }

    if (!profile) {
      console.log(`[AI API] Initializing profile for user ${userId}`);
      
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from("users")
        .insert({
          id: userId,
          email: req.user?.email,
          name: req.user?.email?.split("@")[0] || "User",
          role: isInitialAdmin ? "admin" : "user",
          plan: isInitialAdmin ? "Admin" : "Free"
        })
        .select()
        .single();
      if (profileError) console.error(`[AI API] Error creating profile:`, profileError);
      profile = newProfile;
    }

    if (!subscription) {
      console.log(`[AI API] Initializing subscription for user ${userId}`);
      const { data: newSub, error: subError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan: "Free",
          status: "active"
        })
        .select("*, plans(*)")
        .single();
      if (subError) console.error(`[AI API] Error creating subscription:`, subError);
      subscription = newSub;
    }

    // 2. Check plan status
    const plan = profile?.role === "admin" ? "Admin" : (subscription?.plan || profile?.plan || "Free");
    const isActive = subscription?.status === "active" || profile?.role === "admin" || true;

    if (!isActive) {
      return res.status(403).json({ success: false, error: "Subscription inactive" });
    }

    res.json({ 
      success: true, 
      data: {
        ...profile,
        plan,
        active: isActive,
        expires_at: subscription?.end_date || null,
        subscription: subscription,
        planDetails: subscription?.plans || null
      }
    });
  } catch (err: any) {
    console.error("[AI API] Failed to fetch subscription:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar assinatura" });
  }
});

export default router;

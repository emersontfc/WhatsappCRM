import express from "express";
import { GoogleGenAI } from "@google/genai";
import { decrypt, runAI } from "../agentManager.ts";
import { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

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

    const responseText = await runAI(agent, message, []);
    
    // Handle JSON response if AI returns it
    let reply = responseText;
    try {
      // Try to find JSON block if it's wrapped in markdown or other text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        reply = parsed.reply || "";
      }
    } catch (e) {
      // Not JSON or parsing failed, use original text
    }

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
      Você é um assistente de CRM para WhatsApp da Agentex. 
      Analise o histórico de mensagens abaixo e sugira uma resposta curta, profissional e amigável em português de Moçambique.
      
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
      supabaseAdmin.from("subscriptions").select("*, plans(*)").eq("user_id", userId).order("created_at", { ascending: false }).limit(1)
    ]);
    console.log(`[AI API] supabaseAdmin calls completed for user ${userId}`);

    let profile = profileResult.data;
    let subscription = subResult.data?.[0] || null;

    const adminEmails = (process.env.ADMIN_EMAIL || process.env.INITIAL_SUPERADMIN_EMAIL || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    const userEmail = (req.user?.email || "").toLowerCase();
    const isInitialAdmin = Boolean(userEmail && adminEmails.includes(userEmail));

    console.log(`[AI API] User email: ${userEmail}, Is configured admin: ${isInitialAdmin}`);

    if (profile && isInitialAdmin && profile.role !== "admin" && profile.role !== "superadmin") {
      console.log(`[AI API] Setting user ${userId} (${userEmail}) to admin role per environment config`);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ role: "admin", plan: "Admin" })
        .eq("id", userId)
        .select()
        .single();
      if (updateError) console.error(`[AI API] Error upgrading profile:`, updateError);
      else {
        profile = updatedProfile;
      }
    }

    if (!profile) {
      console.log(`[AI API] Initializing profile for user ${userId} (${userEmail})`);
      
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from("users")
        .insert({
          id: userId,
          email: userEmail,
          name: userEmail?.split("@")[0] || "User",
          role: isInitialAdmin ? "admin" : "user",
          plan: isInitialAdmin ? "Admin" : "Free"
        })
        .select()
        .single();
      
      if (profileError) {
        console.error(`[AI API] Error creating profile for ${userId}:`, profileError);
        if (profileError.code === '23505') {
           const { data: retryProfile } = await supabaseAdmin.from("users").select("*").eq("id", userId).maybeSingle();
           profile = retryProfile;
        }
      } else {
        console.log(`[AI API] Successfully created profile for user ${userId} with role: ${isInitialAdmin ? "admin" : "user"}`);
        profile = newProfile;
      }
    }

    if (!subscription) {
      console.log(`[AI API] Initializing subscription for user ${userId}`);
      
      // Fetch plan_id for "Free" plan
      let { data: planData } = await supabaseAdmin
        .from("plans")
        .select("id")
        .eq("name", "Free")
        .limit(1);

      let planId = planData?.[0]?.id;

      if (!planId) {
        console.log(`[AI API] "Free" plan not found, creating it.`);
        const { data: newPlan } = await supabaseAdmin
          .from("plans")
          .insert({
            name: "Free",
            max_connections: 1,
            max_contacts: 50,
            max_messages_per_day: 10,
            ai_enabled: true,
            automation_level: "basic",
            price: 0
          })
          .select("id")
          .single();
        
        planId = newPlan?.id;
      }

      if (planId) {
        const { data: newSub, error: subError } = await supabaseAdmin
          .from("subscriptions")
          .insert({
            user_id: userId,
            plan: isInitialAdmin ? "Premium" : "Free",
            plan_id: planId,
            status: "active",
            end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString()
          })
          .select("*, plans(*)")
          .single();
        
        if (!subError) {
          subscription = newSub;
        } else {
          // If already exists, fetch the existing one
          const { data: existingSubs } = await supabaseAdmin.from("subscriptions").select("*, plans(*)").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
          subscription = existingSubs?.[0] || null;
        }
      }
    }

    // 2. Check plan status
    const isAdmin = profile?.role === "admin" || isInitialAdmin;
    const plan = isAdmin ? "Admin" : (subscription?.plan || profile?.plan || "Free");
    const isActive = true;

    const adminPlanDetails = {
      name: "Admin",
      max_connections: 999,
      max_contacts: 999999,
      max_messages_per_day: 999999,
      ai_enabled: true,
      automation_level: "advanced",
      price: 0
    };

    const resolvedPlanDetails = isAdmin 
      ? adminPlanDetails 
      : (subscription?.plans || {
          name: plan,
          max_connections: 1,
          max_contacts: 50,
          max_messages_per_day: 20,
          ai_enabled: true,
          automation_level: "basic",
          price: 0
        });

    res.json({ 
      success: true, 
      data: {
        ...profile,
        plan,
        role: isAdmin ? "admin" : (profile?.role || "user"),
        active: isActive,
        expires_at: isAdmin ? null : (subscription?.end_date || null),
        subscription: subscription,
        planDetails: resolvedPlanDetails
      }
    });
  } catch (err: any) {
    console.error("[AI API] Failed to fetch subscription:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar assinatura" });
  }
});

router.post("/profile", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { name, phone, admin_phones } = req.body;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (admin_phones !== undefined) updateData.admin_phones = admin_phones;

    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (error: any) {
    console.error("[AI API] Error updating profile:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

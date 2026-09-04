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
      supabaseAdmin.from("subscriptions").select("*, plans(*)").eq("user_id", userId).maybeSingle()
    ]);
    console.log(`[AI API] supabaseAdmin calls completed for user ${userId}`);

    let profile = profileResult.data;
    let subscription = subResult.data;

    const adminEmails = (process.env.ADMIN_EMAIL || "alcindacharles@gmail.com,emersontorres42@gmail.com").split(",").map(e => e.trim());
    const userEmail = req.user?.email || "";
    const isInitialAdmin = adminEmails.includes(userEmail);

    console.log(`[AI API] User email: ${userEmail}, Admin emails: ${adminEmails.join(", ")}, Is initial admin: ${isInitialAdmin}`);

    if (profile && isInitialAdmin && profile.role !== "admin") {
      console.log(`[AI API] Upgrading user ${userId} (${userEmail}) to admin role`);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ role: "admin", plan: "Admin" })
        .eq("id", userId)
        .select()
        .single();
      if (updateError) console.error(`[AI API] Error upgrading profile:`, updateError);
      else {
        console.log(`[AI API] Successfully upgraded user ${userId} to admin`);
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
        // If insert failed because it already exists (race condition), try fetching again
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
      let { data: planData, error: planError } = await supabaseAdmin
        .from("plans")
        .select("id")
        .eq("name", "Free")
        .single();

      if (planError || !planData) {
        console.log(`[AI API] "Free" plan not found, creating it.`);
        const { data: newPlan, error: createError } = await supabaseAdmin
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
        
        if (createError) {
          console.error(`[AI API] Error creating "Free" plan:`, createError);
          throw new Error("Plano 'Free' não encontrado e falha ao criar.");
        }
        planData = newPlan;
      }

      const planId = planData.id;

      const { data: newSub, error: subError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan: "Free",
          plan_id: planId,
          status: "active",
          end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString() // Far future
        })
        .select("*, plans(*)")
        .single();
      
      if (subError) {
        // If it failed because it already exists (race condition), try fetching it
        if (subError.code === '23505') {
            const { data: existingSub } = await supabaseAdmin.from("subscriptions").select("*, plans(*)").eq("user_id", userId).single();
            subscription = existingSub;
        } else {
            console.error(`[AI API] Error creating subscription:`, subError);
            throw new Error(`Erro ao criar assinatura: ${subError.message}`);
        }
      } else {
        subscription = newSub;
      }
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

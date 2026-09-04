import express from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { AuthRequest } from "../middleware/auth.ts";

const router = express.Router();

router.get("/list", async (req: AuthRequest, res) => {
  try {
    const { data: templates, error } = await supabaseAdmin
      .from("templates")
      .select("id, name, description");

    if (error) throw error;
    res.json({ success: true, data: templates });
  } catch (err: any) {
    console.error("Error fetching templates:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/skip", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    await supabaseAdmin.from("users").update({ template_applied: true }).eq("id", userId);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error skipping template:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/apply/:templateId", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { templateId } = req.params;

  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    // 1. Fetch template
    const { data: template, error: tError } = await supabaseAdmin
      .from("templates")
      .select("*")
      .eq("id", templateId)
      .single();

    if (tError || !template) throw new Error("Template não encontrado");

    // 2. Insert automations (verificando se já existem para não sobrescrever)
    const { data: existingAutos } = await supabaseAdmin
      .from("automations")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (!existingAutos || existingAutos.length === 0) {
      // Assuming template.automations is a JSON object { "trigger": "response" }
      const automations = typeof template.automations === 'string' 
        ? JSON.parse(template.automations) 
        : template.automations;

      const automationsToInsert = Object.entries(automations).map(([key, value]) => ({
        user_id: userId,
        trigger: key,
        response: value,
        created_at: new Date().toISOString(),
      }));
      await supabaseAdmin.from("automations").insert(automationsToInsert);
    }

    // 3. Update AI Prompt na tabela oficial agents
    await supabaseAdmin
      .from("agents")
      .upsert({ user_id: userId, instructions: template.ai_prompt, provider: "gemini" }, { onConflict: 'user_id' });

    // 4. Mark user
    await supabaseAdmin.from("users").update({ template_applied: true }).eq("id", userId);

    res.json({ success: true });
  } catch (err: any) {
    console.error("Error applying template:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

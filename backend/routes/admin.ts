import express from "express";
import { supabaseAdmin } from "../supabaseAdmin";
import { authorizeAdmin, AuthRequest } from "../middleware/auth";

const router = express.Router();

// Apply authorizeAdmin middleware to all routes in this router
router.use(authorizeAdmin);

router.get("/keys", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("license_keys")
      .select("id, code, duration_days, plan, is_used, created_at")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to fetch keys:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/keys", async (req, res) => {
  const { code, duration_days, plan } = req.body;
  
  if (!code) {
    return res.status(400).json({ success: false, error: "O código da licença é obrigatório." });
  }

  const duration = parseInt(String(duration_days));
  if (isNaN(duration) || duration <= 0) {
    return res.status(400).json({ success: false, error: "A duração em dias deve ser um número positivo." });
  }

  try {
    // Fetch plan_id
    const { data: planData, error: planError } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("name", plan || "Premium")
      .single();

    if (planError || !planData) {
      return res.status(400).json({ success: false, error: "Plano inválido." });
    }

    const { data, error } = await supabaseAdmin.from("license_keys").insert({
      code,
      duration_days: duration,
      plan: plan || "Premium",
      is_used: false,
      created_at: new Date().toISOString(),
    }).select("id, code, duration_days, plan, is_used, created_at").single();

    if (error) {
      if (error.code === "23505") {
        return res.status(400).json({ success: false, error: "Este código de licença já existe." });
      }
      throw error;
    }
    
    if (!data) {
      throw new Error("Não foi possível recuperar os dados da senha gerada.");
    }

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to generate key:", err);
    res.status(500).json({ success: false, error: err.message || "Erro interno ao gerar senha." });
  }
});

router.delete("/keys/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    const { error } = await supabaseAdmin
      .from("license_keys")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete key:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Plan Management Routes
router.get("/plans", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("plans")
      .select("*")
      .order("price", { ascending: true });
      
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to fetch plans:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/plans/:id", async (req, res) => {
  const { id } = req.params;
    const { max_connections, max_contacts, max_messages_per_day, ai_enabled, automation_level, price } = req.body;
    
    // Ensure we only update the fields we expect, using the correct database column names
    const updateData = {
      max_connections: Number(max_connections),
      max_contacts: Number(max_contacts),
      max_messages_per_day: Number(max_messages_per_day),
      ai_enabled: Boolean(ai_enabled),
      automation_level: automation_level,
      price: Number(price)
    };
  
  try {
    const { data, error } = await supabaseAdmin
      .from("plans")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();
      
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to update plan:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// User Management Routes
router.get("/users", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to fetch users:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pack Management Routes
router.post("/packs", async (req, res) => {
  const { name, description, is_public } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, error: "Nome do pack é obrigatório." });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("model_packs")
      .insert({
        name,
        description: description || "",
        is_public: is_public !== undefined ? is_public : true,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
      
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to create pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/packs/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    const { error } = await supabaseAdmin
      .from("model_packs")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    // Delete from auth.users as well? 
    // Usually we just delete from public.users or mark as inactive.
    // But user asked for "apagar usuário".
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authError) console.warn("Failed to delete user from auth:", authError);

    const { error } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete user:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  try {
    const { error } = await supabaseAdmin
      .from("users")
      .update({ role })
      .eq("id", id);
      
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to update user role:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/users/:id/subscription", async (req, res) => {
  const { id } = req.params;
  const { plan, expires_at } = req.body;
  
  try {
    // Fetch plan_id
    const { data: planData, error: planError } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("name", plan || "Starter")
      .single();

    if (planError || !planData) {
      return res.status(400).json({ success: false, error: "Plano inválido." });
    }

    const { error } = await supabaseAdmin
      .from("users")
      .update({ 
        plan, 
        expires_at
      })
      .eq("id", id);
      
    if (error) throw error;
    
    // Also update subscriptions table for consistency
    const { error: subError } = await supabaseAdmin
      .from("subscriptions")
      .update({ 
        plan, 
        plan_id: planData.id,
        end_date: expires_at,
        status: "active"
      })
      .eq("user_id", id);

    if (subError) console.warn("Failed to update subscriptions table:", subError);
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to update user subscription:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ... existing routes ...

router.post("/packs/import", async (req: AuthRequest, res) => {
  const { name, description, is_public, items } = req.body;

  if (!name || !items || !Array.isArray(items)) {
    return res.status(400).json({ success: false, error: "Nome e lista de itens são obrigatórios." });
  }

  try {
    // 1. Create the pack
    const { data: pack, error: packError } = await supabaseAdmin
      .from("model_packs")
      .insert({
        name,
        description: description || "",
        is_public: is_public !== undefined ? is_public : true,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (packError) throw packError;

    // 2. Insert items
    const itemsToInsert = items.map((item: any) => ({
      pack_id: pack.id,
      trigger: item.trigger,
      response_text: item.response || item.response_text,
      match_type: item.match_type || 'exact',
      response_type: item.response_type || 'text',
      audio_url: item.audio_url || null
    }));

    const { error: itemsError } = await supabaseAdmin.from("model_items").insert(itemsToInsert);
    if (itemsError) throw itemsError;

    res.json({ success: true, data: pack });
  } catch (err: any) {
    console.error("Error importing pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/packs/:packId/items", async (req: AuthRequest, res) => {
  console.log("Admin pack items route hit for pack:", req.params.packId);
  const { packId } = req.params;
  const items = req.body; // Array of { trigger, response, match_type }

  try {
    const itemsToInsert = items.map((item: any) => ({
      pack_id: packId,
      trigger: item.trigger,
      response_text: item.response, // Mapping 'response' to 'response_text'
      match_type: item.match_type || 'exact',
      response_type: 'text' // Defaulting to text
    }));

    const { error } = await supabaseAdmin.from("model_items").insert(itemsToInsert);
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error adding items to pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import express from "express";
import { supabaseAdmin } from "../supabaseAdmin";
import { authorizeAdmin } from "../middleware/auth";

const router = express.Router();

// Apply authorizeAdmin middleware to all routes in this router
router.use(authorizeAdmin);

router.get("/keys", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("license_keys")
      .select("*")
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
    const { data, error } = await supabaseAdmin.from("license_keys").insert({
      code,
      duration_days: duration,
      plan: plan || "Premium",
      is_used: false,
      created_at: new Date().toISOString(),
    }).select().single();

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
    const { error } = await supabaseAdmin
      .from("users")
      .update({ 
        plan, 
        expires_at,
        isActivated: plan !== "Free"
      })
      .eq("id", id);
      
    if (error) throw error;
    
    // Also update subscriptions table for consistency
    const { error: subError } = await supabaseAdmin
      .from("subscriptions")
      .update({ 
        plan, 
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

export default router;

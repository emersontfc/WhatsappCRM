import express from "express";
import { supabaseAdmin } from "../supabaseAdmin";
import { authenticate } from "../middleware/auth";

const router = express.Router();

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

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  try {
    // Create user with email_confirm: true to skip verification emails in development
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name }
    });

    if (authError) throw authError;

    if (authUser.user) {
      const isAdminEmail = email === "alcindacharles@gmail.com" || email === "emersontorres42@gmail.com";
      
      const planName = isAdminEmail ? "Premium" : "Starter";
      const { data: planData } = await supabaseAdmin.from("plans").select("id").eq("name", planName).single();

      // Create profile in public.users
      const { error: profileError } = await supabaseAdmin
        .from("users")
        .insert({
          id: authUser.user.id,
          email: email,
          name: name,
          role: isAdminEmail ? "admin" : "user",
          created_at: new Date().toISOString(),
          expires_at: isAdminEmail ? "2099-12-31T23:59:59Z" : null,
          isActivated: true, // New users are activated by default on Starter plan
          plan: planName
        });

      if (profileError) {
        console.error("Profile creation error:", profileError);
      }

      // Create initial subscription
      const { error: subError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: authUser.user.id,
          plan: planName,
          plan_id: planData?.id,
          start_date: new Date().toISOString(),
          end_date: isAdminEmail ? "2099-12-31T23:59:59Z" : new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString(),
          expires_at: isAdminEmail ? "2099-12-31T23:59:59Z" : new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString(),
          status: "active",
          is_active: true
        });

      if (subError) {
        console.error("Subscription creation error:", subError);
      }

      res.json({ success: true, user: authUser.user });
    } else {
      throw new Error("Failed to create user");
    }
  } catch (err: any) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/activate-license", authenticate, async (req, res) => {
  const { code } = req.body;
  const userId = (req as any).user?.id;

  if (!code || !userId) {
    return res.status(400).json({ success: false, error: "Code and User ID are required" });
  }

  try {
    // 1. Find the license key
    const { data: keyData, error: keyFetchError } = await supabaseAdmin
      .from("license_keys")
      .select("*")
      .eq("code", code.trim())
      .eq("is_used", false)
      .single();

    if (keyFetchError || !keyData) {
      return res.status(400).json({ success: false, error: "Senha inválida ou já utilizada." });
    }

    // 2. Mark key as used (Transactional-ish)
    const { error: keyUpdateError } = await supabaseAdmin
      .from("license_keys")
      .update({
        is_used: true,
        used_by: userId,
        used_at: new Date().toISOString()
      })
      .eq("id", keyData.id);

    if (keyUpdateError) throw keyUpdateError;

    // 3. Create or update subscription
    const durationDays = keyData.duration_days;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + durationDays);

    const { error: subError } = await supabaseAdmin
      .from("subscriptions")
      .upsert({
        user_id: userId,
        plan: keyData.plan,
        plan_id: keyData.plan_id,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        expires_at: endDate.toISOString(),
        status: "active",
        is_active: true
      }, { onConflict: 'user_id' });

    if (subError) throw subError;
      
    // Also update user document
    const { error: userUpdateError } = await supabaseAdmin
      .from("users")
      .update({
        isActivated: true,
        expires_at: endDate.toISOString(),
        plan: keyData.plan
      })
      .eq("id", userId);

    if (userUpdateError) throw userUpdateError;

    res.json({ 
      success: true, 
      message: `Plano ${keyData.plan} ativado com sucesso por ${durationDays} dias!`,
      plan: keyData.plan,
      endDate: endDate.toISOString()
    });
  } catch (err: any) {
    console.error("Activation error:", err);
    res.status(500).json({ success: false, error: err.message || "Erro ao ativar senha." });
  }
});

export default router;

import express from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticate } from "../middleware/auth.ts";

const router = express.Router();

// Get all menus for a user
router.get("/", authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("smart_menus")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update a menu
router.post("/", authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id, name, message, footer, options, active } = req.body;

    console.log(`[Menus API] Saving menu for user ${userId}:`, { id, name, optionsCount: options?.length });

    const menuData = {
      user_id: userId,
      name,
      message,
      footer,
      options,
      active: active ?? true,
      updated_at: new Date().toISOString()
    };

    let result;
    if (id) {
      result = await supabaseAdmin
        .from("smart_menus")
        .update(menuData)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();
    } else {
      result = await supabaseAdmin
        .from("smart_menus")
        .insert(menuData)
        .select()
        .single();
    }

    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a menu
router.delete("/:id", authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("smart_menus")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

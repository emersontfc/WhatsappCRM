import express from "express";
import { supabaseAdmin } from "../supabaseAdmin";
import { AuthRequest } from "../middleware/auth";

const router = express.Router();

// List public packs
router.get("/list", async (req: AuthRequest, res) => {
  try {
    const { data: packs, error } = await supabaseAdmin
      .from("model_packs")
      .select("id, name, description")
      .eq("is_public", true);

    if (error) throw error;
    res.json({ success: true, data: packs });
  } catch (err: any) {
    console.error("Error fetching packs:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug route to list tables
router.get("/debug/tables", async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("information_schema.tables")
      .select("table_name")
      .eq("table_schema", "public");
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import pack into user's quick_replies
router.post("/import/:packId", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { packId } = req.params;

  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    // 1. Fetch pack items
    const { data: items, error: iError } = await supabaseAdmin
      .from("model_items")
      .select("*")
      .eq("pack_id", packId);

    if (iError) throw iError;
    if (!items || items.length === 0) throw new Error("Pack vazio ou não encontrado");

    // 2. Insert into quick_replies
    const repliesToInsert = items.map((item) => ({
      user_id: userId,
      trigger: item.trigger,
      response_text: item.response_text,
      response_type: item.response_type,
      audio_url: item.audio_url,
      match_type: item.match_type,
      created_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabaseAdmin
      .from("quick_reply")
      .insert(repliesToInsert);

    if (insertError) throw insertError;

    res.json({ success: true });
  } catch (err: any) {
    console.error("Error importing pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List user's quick replies
router.get("/my", async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { data, error } = await supabaseAdmin
      .from("quick_reply")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a quick reply
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { error } = await supabaseAdmin
      .from("quick_reply")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

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
      .from("quick_replies")
      .insert(repliesToInsert);

    if (insertError) throw insertError;

    res.json({ success: true });
  } catch (err: any) {
    console.error("Error importing pack:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

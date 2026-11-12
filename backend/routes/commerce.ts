import express from "express";
import { AuthRequest } from "../middleware/auth.ts";
import { commerceService } from "../services/commerceService.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = express.Router();

// 1. Products CRUD
router.get("/products", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const products = await commerceService.listProducts(userId);
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/products", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { name, description, price, currency, category, stock, type, digital_content } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: "Nome e preço são obrigatórios." });
  }

  try {
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        user_id: userId,
        name: name.trim(),
        description: description || "",
        price: Number(price) || 0,
        currency: currency || "MT",
        category: category || "Geral",
        stock: stock !== undefined ? Number(stock) : 999,
        type: type || "digital",
        digital_content: digital_content || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/products/:id", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { error } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true, message: "Produto excluído com sucesso." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Orders & Operations
router.get("/orders", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { status, limit } = req.query;
    let query = supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", String(status));
    }
    if (limit) {
      query = query.limit(Number(limit));
    }

    const { data: orders, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: orders || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/orders/:id/approve", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { notes } = req.body;
  try {
    const result = await commerceService.approveOrder(req.params.id, userId, notes);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/orders/:id/reject", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { reason } = req.body;
  if (!reason) {
    return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });
  }

  try {
    const result = await commerceService.rejectOrder(req.params.id, userId, reason);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/orders/:id/timeline", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const timeline = await commerceService.getOrderTimeline(req.params.id);
    res.json({ success: true, data: timeline });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Payment Verifications (Pending Proofs)
router.get("/verifications", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data: verifications, error } = await supabaseAdmin
      .from("payment_verifications")
      .select("*, orders(order_number, total_amount, customer_name, customer_phone)")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: verifications || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Operations Center Feed
router.get("/operations-feed", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data: ops, error } = await supabaseAdmin
      .from("agent_operations")
      .select("*, orders(order_number, total_amount, customer_name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    res.json({ success: true, data: ops || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

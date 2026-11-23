import express from "express";
import multer from "multer";
import { AuthRequest } from "../middleware/auth.ts";
import { commerceService } from "../services/commerceService.ts";
import { supabaseAdmin, supabaseAdminConfigured } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { parseSellerSettings, saveSellerSettings, sellerOverview } from "../services/sellerWorkspace.ts";
import { isSellerMethod } from "../../shared/seller.ts";
import { makePlatformChecks } from "../services/platformChecks.ts";

import { PRODUCT_FILE_LIMIT, productFilename, storeProductFile } from "../services/catalogDeliverables.ts";

const router = express.Router();
const platform = makePlatformChecks(supabaseAdminConfigured);
const upload = multer({ limits: { fileSize: PRODUCT_FILE_LIMIT, files: 1 } }).single("file");
const productUpload: express.RequestHandler = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "Anexo inválido. Limite de 20 MiB." });
      return;
    }
    next();
  });
};

router.get("/seller", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para abrir o Vendedor." });
  try {
    const sales = await platform.check("sales");
    if (sales === "migration_required") {
      return res.status(503).json({ error: "A instalação precisa das migrações 20 e 21 do Supabase. Pede ao administrador que atualize o esquema de vendas." });
    }
    if (sales !== "ready") return res.status(503).json({ error: "Não foi possível verificar a ligação ao esquema de vendas. Tenta atualizar." });
    const data = await sellerOverview(userId, whatsappManager.getSession(userId)?.status === "connected");
    return res.set("Cache-Control", "no-store").json({ success: true, data });
  } catch {
    return res.status(503).json({ error: "Não foi possível consultar o Vendedor. Tenta atualizar." });
  }
});

router.put("/seller/settings", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para guardar as definições." });
  const settings = parseSellerSettings(req.body);
  if (!settings) return res.status(400).json({ error: "Verifica o método, o titular e os números informados." });
  try {
    await saveSellerSettings(userId, settings);
    return res.json({ success: true, data: settings });
  } catch {
    return res.status(503).json({ error: "Não foi possível guardar as instruções de pagamento." });
  }
});

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

router.post("/products", productUpload, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { name, description, price, currency, category, stock, type, digital_content } = req.body;
  const file = req.file;
  const filename = file && productFilename(file);
  if (file && (!filename || (type && type !== "digital"))) {
    return res.status(400).json({ error: "Escolhe um PDF, EPUB ou uma imagem JPEG, PNG ou WebP para o produto digital." });
  }
  if (typeof name !== "string" || !name.trim() || price === "" || price == null ||
      !Number.isFinite(Number(price)) || Number(price) < 0 ||
      (stock !== undefined && (!Number.isInteger(Number(stock)) || Number(stock) < 0))) {
    return res.status(400).json({ error: "Nome e preço são obrigatórios." });
  }

  try {
    const deliverable = file && filename ? await storeProductFile(userId, file, filename) : {};
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
        ...deliverable,
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

router.put("/products/:id/deliverable", productUpload, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const filename = req.file && productFilename(req.file);
  if (!req.file || !filename) return res.status(400).json({ error: "Escolhe um PDF, EPUB ou uma imagem JPEG, PNG ou WebP." });
  try {
    const { data: product, error } = await supabaseAdmin.from("products").select("id")
      .eq("id", req.params.id).eq("user_id", userId).eq("type", "digital").maybeSingle();
    if (error) throw error;
    if (!product) return res.status(404).json({ error: "Produto digital não encontrado." });
    const deliverable = await storeProductFile(userId, req.file, filename);
    const { data: updated, error: updateError } = await supabaseAdmin.from("products").update(deliverable)
      .eq("id", product.id).eq("user_id", userId).select("id,deliverable_name").single();
    if (updateError) throw updateError;
    return res.json({ success: true, data: updated });
  } catch {
    return res.status(503).json({ error: "Não foi possível guardar o ficheiro." });
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

  const { settlementMethod, settlementVerified } = req.body ?? {};
  const amount = typeof req.body?.settlementAmount === "string" ? req.body.settlementAmount.trim().replace(",", ".") : "";
  const reference = typeof req.body?.settlementReference === "string" ? req.body.settlementReference.trim() : "";
  if (settlementVerified !== true) return res.status(400).json({ error: "Confirma a liquidação no prestador antes de aprovar." });
  if ((!isSellerMethod(settlementMethod) && settlementMethod !== "other") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{3,79}$/.test(reference) || reference.replace(/[^a-zA-Z0-9]/g, "").length < 4) {
    return res.status(400).json({ error: "Indica o método e a referência oficial do pagamento." });
  }
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: "Indica o valor recebido, conferido no prestador." });
  }
  try {
    const result = await commerceService.approveOrder(req.params.id, userId, settlementMethod, reference, amount);
    res.json(result);
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "Esta referência já foi usada para confirmar outro pedido." });
    if (err.code === "P0002") return res.status(404).json({ error: "Pedido não encontrado." });
    if (err.code === "22023" || err.code === "P0001") return res.status(409).json({ error: err.message });
    return res.status(503).json({ error: "Não foi possível verificar a confirmação do pagamento." });
  }
});

router.post("/orders/:id/delivery", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.json(await commerceService.fulfillOrder(req.params.id, userId));
  } catch {
    return res.status(503).json({ error: "Não foi possível verificar a entrega." });
  }
});

router.post("/orders/:id/reject", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 250) {
    return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });
  }

  try {
    const result = await commerceService.rejectOrder(req.params.id, userId, reason);
    res.json(result);
  } catch (err: any) {
    if (err.code === "P0002") return res.status(404).json({ error: "Pedido fora da fila de revisão." });
    return res.status(503).json({ error: "Não foi possível registar a rejeição." });
  }
});

router.get("/orders/:id/timeline", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const timeline = await commerceService.getOrderTimeline(req.params.id, userId);
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
      .select("*, orders(order_number, total_amount, currency, customer_name, customer_phone, payment_method)")
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


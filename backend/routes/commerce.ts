import express from "express";
import multer from "multer";
import { loadCommerceScope, requireCommerceRole, type CommerceRequest } from "../middleware/commerceScope.ts";
import { commerceService, sellerOperationSummary } from "../services/commerceService.ts";
import { supabaseAdmin, supabaseAdminConfigured } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { parseSellerSettings, saveSellerSettings, sellerOverview } from "../services/sellerWorkspace.ts";
import { reviewProofRecipient } from "../services/paymentProofSms.ts";
import { isSellerMethod } from "../../shared/seller.ts";
import { makePlatformChecks } from "../services/platformChecks.ts";

import { PRODUCT_FILE_LIMIT, productFilename, storeProductFile } from "../services/catalogDeliverables.ts";
import { downloadPaymentProofAttachment } from "./groupProofs.ts";

const router = express.Router();
const platform = makePlatformChecks(supabaseAdminConfigured);
const ownerOnly = requireCommerceRole("owner");
const salesTeam = requireCommerceRole("owner", "operator");
const financeTeam = requireCommerceRole("owner", "finance_admin");
const productFields = "id,name,description,price,currency,category,stock,type,deliverable_name";
const orderFields = "id,order_number,customer_name,customer_phone,total_amount,currency,status,reservation_expires_at,payment_method,delivery_started_at,delivery_error,created_at,order_items(id,product_name,quantity,unit_price,total_price)";
const proofFields = "id,order_id,customer_phone,provider,transaction_reference,amount,currency,sender_name,sender_phone,proof_type,proof_raw_text,proof_media_url,confidence_score,created_at,extracted_data,orders(order_number,total_amount,currency,customer_name,customer_phone,payment_method,seller_payment)";
const orderUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
router.use(loadCommerceScope);
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

router.get("/access", (req: CommerceRequest, res) => {
  const { organizationId, role, name } = req.commerce!;
  return res.json({ success: true, data: { organizationId, role, name } });
});

router.get("/seller", ownerOnly, async (req: CommerceRequest, res) => {
  const { accountId: userId } = req.commerce!;
  try {
    const sales = await platform.check("sales");
    if (sales === "migration_required") {
      return res.status(503).json({ error: "A instalação precisa das migrações 20 a 22 do Supabase. Pede ao administrador que atualize o esquema de vendas." });
    }
    if (sales !== "ready") return res.status(503).json({ error: "Não foi possível verificar a ligação ao esquema de vendas. Tenta atualizar." });
    const data = await sellerOverview(userId, whatsappManager.getSession(userId)?.status === "connected");
    return res.set("Cache-Control", "no-store").json({ success: true, data });
  } catch {
    return res.status(503).json({ error: "Não foi possível consultar o Vendedor. Tenta atualizar." });
  }
});

router.put("/seller/settings", ownerOnly, async (req: CommerceRequest, res) => {
  const { accountId: userId } = req.commerce!;
  const settings = parseSellerSettings(req.body);
  if (!settings) return res.status(400).json({ error: "Verifica o método, o titular e os números informados." });
  try {
    const data = await saveSellerSettings(userId, settings, req.body?.payment_destinations !== undefined);
    return res.json({ success: true, data });
  } catch {
    return res.status(503).json({ error: "Não foi possível guardar as instruções de pagamento." });
  }
});

// 1. Products CRUD
router.get("/products", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;
  try {
    if (role === "owner") return res.json({ success: true, data: await commerceService.listProducts(userId) });
    const { data, error } = await supabaseAdmin.from("products").select(productFields)
      .eq("user_id", userId).eq("is_active", true).order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({ success: true, data: data ?? [] });
  } catch {
    return res.status(503).json({ error: "Não foi possível consultar o catálogo." });
  }
});

router.post("/products", salesTeam, productUpload, async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;

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
      .select(role === "owner" ? "*" : productFields)
      .single();

    if (error) throw error;
    res.json({ success: true, data: product });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return res.status(409).json({ error: "Já existe um produto com esses dados." });
    return res.status(503).json({ error: "Não foi possível criar o produto." });
  }
});

router.put("/products/:id/deliverable", salesTeam, productUpload, async (req: CommerceRequest, res) => {
  const { accountId: userId } = req.commerce!;
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

router.delete("/products/:id", ownerOnly, async (req: CommerceRequest, res) => {
  const { accountId: userId } = req.commerce!;
  try {
    const { error } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true, message: "Produto excluído com sucesso." });
  } catch (error) {
    if ((error as { code?: string })?.code === "P0001") return res.status(409).json({ error: "O produto tem reservas ativas." });
    return res.status(503).json({ error: "Não foi possível remover o produto." });
  }
});

// 2. Orders & Operations
router.get("/orders", async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;
  try {
    const { status, limit } = req.query;
    let query = supabaseAdmin
      .from("orders")
      .select(role === "owner" ? "*, order_items(*)" : orderFields)
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
  } catch {
    return res.status(503).json({ error: "Não foi possível consultar os pedidos." });
  }
});

router.post("/orders/:id/cancel", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, actorId, organizationId, role } = req.commerce!;
  const orderId = req.params.id.toLowerCase();
  if (!orderUuid.test(orderId)) {
    return res.status(400).json({ error: "Pedido inválido." });
  }

  try {
    const request = organizationId ? supabaseAdmin.rpc("agentx_seller_team_cancel_order", {
      p_actor: actorId, p_org: organizationId, p_order: orderId
    }) : supabaseAdmin.rpc("agentx_seller_cancel_order", { p_user: userId, p_order: orderId });
    const { data, error } = await request.abortSignal(AbortSignal.timeout(8_000));
    if (error?.code === "42501") return res.status(403).json({ error: "Já não podes cancelar pedidos desta empresa." });
    if (error?.code === "P0002") return res.status(404).json({ error: "Pedido não encontrado." });
    if (error?.code === "P0001" || error?.code === "22023") {
      return res.status(409).json({ error: "O estado do pedido mudou. Atualiza a lista e confirma se existe um pagamento ou comprovativo pendente." });
    }
    if (error || data?.id !== orderId || !["cancelled", "expired"].includes(data.status)) {
      throw new Error("Cancellation was not acknowledged");
    }
    return res.json({ success: true, data: role === "owner" ? data : { id: data.id, status: data.status } });
  } catch {
    return res.status(503).json({ error: "A base não confirmou o cancelamento. Atualiza a lista antes de repetir." });
  }
});

router.post("/orders/:id/approve", financeTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, actorId, organizationId, role } = req.commerce!;
  if (!orderUuid.test(req.params.id)) return res.status(400).json({ error: "Pedido inválido." });

  const { settlementMethod, settlementVerified, proofId } = req.body ?? {};
  const amount = typeof req.body?.settlementAmount === "string" ? req.body.settlementAmount.trim().replace(",", ".") : "";
  const reference = typeof req.body?.settlementReference === "string" ? req.body.settlementReference.trim() : "";
  if (settlementVerified !== true) return res.status(400).json({ error: "Confirma a liquidação no prestador antes de aprovar." });
  if (settlementMethod != null && settlementMethod !== "other" && !isSellerMethod(settlementMethod)) {
    return res.status(400).json({ error: "Escolhe um método de pagamento válido." });
  }
  if (reference && (!/^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{3,79}$/.test(reference) || reference.replace(/[^a-zA-Z0-9]/g, "").length < 4)) {
    return res.status(400).json({ error: "A referência oficial indicada é inválida." });
  }
  if (amount && (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
    return res.status(400).json({ error: "Indica o valor recebido, conferido no prestador." });
  }
  if (proofId != null && (typeof proofId !== "string" || !orderUuid.test(proofId))) {
    return res.status(400).json({ error: "Escolhe um comprovativo válido." });
  }
  try {
    const result = await commerceService.approveOrder(req.params.id, userId, {
      verified: settlementVerified, method: settlementMethod ?? null, reference: reference || null,
      amount: amount || null, proofId: proofId ?? null
    }, organizationId ? { actorId, organizationId } : undefined);
    const { id, order_number, status } = result.order;
    return res.json(role === "owner" ? result : { ...result, order: { id, order_number, status } });
  } catch (err: any) {
    if (err.code === "42501") return res.status(403).json({ error: "Já não podes rever pagamentos desta empresa." });
    if (err.code === "23505") return res.status(409).json({ error: "Este comprovativo ou referência já foi usado para confirmar outro pedido." });
    if (err.code === "P0002") return res.status(404).json({ error: "Pedido não encontrado." });
    if (err.code === "22023" || err.code === "P0001") return res.status(409).json({ error: err.message });
    return res.status(503).json({ error: "Não foi possível verificar a confirmação do pagamento." });
  }
});

router.post("/orders/:id/delivery", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, actorId, organizationId } = req.commerce!;
  if (!orderUuid.test(req.params.id)) return res.status(400).json({ error: "Pedido inválido." });
  try {
    return res.json(await commerceService.fulfillOrder(req.params.id, userId, organizationId ? { actorId, organizationId } : undefined));
  } catch (error) {
    if ((error as { code?: string })?.code === "42501") return res.status(403).json({ error: "Já não podes gerir entregas desta empresa." });
    return res.status(503).json({ error: "Não foi possível verificar a entrega." });
  }
});

router.post("/orders/:id/delivery/confirm", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, actorId, organizationId } = req.commerce!;
  if (req.body?.deliveryVerified !== true) return res.status(400).json({ error: "Confirma com o cliente que recebeu a entrega completa." });
  const orderId = req.params.id.toLowerCase();
  if (!orderUuid.test(orderId)) {
    return res.status(400).json({ error: "Pedido inválido." });
  }
  try {
    const request = organizationId ? supabaseAdmin.rpc("agentx_seller_team_confirm_delivery", {
      p_actor: actorId, p_org: organizationId, p_order: orderId
    }) : supabaseAdmin.rpc("agentx_seller_confirm_delivery", { p_user: userId, p_order: orderId });
    const { data, error } = await request.abortSignal(AbortSignal.timeout(8_000));
    if (error?.code === "42501") return res.status(403).json({ error: "Já não podes gerir entregas desta empresa." });
    if (error?.code === "P0002") return res.status(404).json({ error: "Pedido não encontrado." });
    if (error?.code === "22023") return res.status(409).json({ error: "O pedido já mudou de estado. Atualiza a lista antes de rever a entrega." });
    if (error || data?.id !== orderId) throw new Error("Delivery reconciliation could not be recorded");
    return res.json({ success: true, delivered: true });
  } catch {
    return res.status(503).json({ error: "Não foi possível registar a revisão. Atualiza o pedido antes de tentar novamente." });
  }
});

router.post("/orders/:id/reject", financeTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, actorId, organizationId } = req.commerce!;
  if (!orderUuid.test(req.params.id)) return res.status(400).json({ error: "Pedido inválido." });

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const proofId = req.body?.proofId;
  if (reason.length < 3 || reason.length > 250) {
    return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });
  }
  if (proofId != null && (typeof proofId !== "string" || !orderUuid.test(proofId))) {
    return res.status(400).json({ error: "Escolhe um comprovativo válido." });
  }

  try {
    const result = await commerceService.rejectOrder(req.params.id, userId, reason, proofId, { actorId, organizationId });
    res.json(result);
  } catch (err: any) {
    if (err.code === "42501") return res.status(403).json({ error: "Já não podes rever pagamentos desta empresa." });
    if (err.code === "P0002") return res.status(404).json({ error: "Pedido fora da fila de revisão." });
    if (err.code === "22023") return res.status(409).json({ error: err.message });
    return res.status(503).json({ error: "Não foi possível registar a rejeição." });
  }
});

router.get("/orders/:id/timeline", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;
  try {
    const timeline = await commerceService.getOrderTimeline(req.params.id, userId, role === "owner");
    res.json({ success: true, data: timeline });
  } catch {
    res.status(503).json({ error: "Não foi possível consultar o histórico do pedido." });
  }
});

// 3. Payment Verifications (Pending Proofs)
router.get("/verifications/:id/attachment", financeTeam, downloadPaymentProofAttachment);

router.get("/verifications", financeTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;
  try {
    const payments = supabaseAdmin.from("payment_verifications");
    const reviews = role === "owner"
      ? payments.select("*, orders(order_number,total_amount,currency,customer_name,customer_phone,payment_method,seller_payment)")
      : payments.select(proofFields);
    const { data: verifications, error } = await reviews
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: (verifications ?? []).map((verification) => {
      const recipientEvidence = reviewProofRecipient(verification, verification.orders?.seller_payment);
      if (role === "owner") return { ...verification, recipientEvidence };
      const marker = verification.proof_media_url;
      return { ...verification, recipientEvidence, extracted_data: { source: verification.extracted_data?.source },
        proof_media_url: /^(?:agentx-group-proof:|agentx-proof-sha256:)/.test(marker ?? "") ? marker : null };
    }) });
  } catch {
    res.status(503).json({ error: "Não foi possível consultar os comprovativos." });
  }
});

// 4. Operations Center Feed
router.get("/operations-feed", salesTeam, async (req: CommerceRequest, res) => {
  const { accountId: userId, role } = req.commerce!;

  try {
    const events = supabaseAdmin.from("agent_operations");
    const feed = role === "owner" ? events.select("*, orders(order_number,total_amount,customer_name)")
      : events.select("id,step,created_at,orders(order_number,total_amount,customer_name)");
    const { data: ops, error } = await feed
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    const data = role === "owner" ? ops ?? []
      : (ops ?? []).map((event) => ({ ...event, description: sellerOperationSummary(event.step) }));
    return res.json({ success: true, data });
  } catch {
    res.status(503).json({ error: "Não foi possível consultar o histórico de operações." });
  }
});

export default router;


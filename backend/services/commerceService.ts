import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { loadProductFile, PRODUCT_FILE_LIMIT, ProductFileError } from "./catalogDeliverables.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { reviewProofRecipient, type ExtractedPaymentData } from "./paymentProofSms.ts";
import { sellerSettings } from "./sellerWorkspace.ts";
import { readSellerAvailableStock } from "./sellerStock.ts";

export interface CreateOrderParams {
  userId: string;
  customerPhone: string;
  customerName: string;
  contactId?: string;
  paymentMethod?: string;
  productId: string;
  sourceMessageId?: string;
  quantity: number;
  expectedUnitPrice?: number | string;
  expectedCurrency?: string;
}

export const normalizeCatalogText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

export class CommerceService {
  /**
   * Lists active products for a user/company
   */
  async listProducts(userId: string, category?: string) {
    let query = supabaseAdmin
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async listAgentProducts(userId: string) {
    const [{ data, error }, available] = await Promise.all([
      supabaseAdmin.from("products").select("id,name,description,price,currency,category,stock")
        .eq("user_id", userId).eq("is_active", true)
        .order("created_at", { ascending: false }).order("id"),
      readSellerAvailableStock(userId)
    ]);
    if (error) throw error;
    return (data ?? []).map((item) => ({ ...item, stock: available.get(item.id) ?? 0 }));
  }

  async createOrder(params: CreateOrderParams) {
    const { data: order, error } = await supabaseAdmin.rpc("agentx_seller_create_reserved_order", {
      p_user: params.userId,
      p_product: params.productId,
      p_quantity: params.quantity,
      p_phone: normalizeContactPhone(params.customerPhone),
      p_customer: params.customerName,
      p_contact: params.contactId ?? null,
      p_method: params.paymentMethod ?? null,
      p_order_number: `AGX-${randomBytes(6).toString("hex").toUpperCase()}`,
      p_source_message: params.sourceMessageId ?? null,
      p_expected_price: params.expectedUnitPrice ?? null,
      p_expected_currency: params.expectedCurrency ?? null
    });
    if (error) throw error;
    if (!order?.id || !order?.order_number) throw new Error("Order write returned no identifier");
    return { order };
  }

  async submitPaymentProof(userId: string, order: { id: string; order_number: string; customer_phone: string },
    messageId: string | undefined, proof: ExtractedPaymentData) {
    const { data, error } = await supabaseAdmin.rpc("agentx_seller_submit_proof", {
      p_user: userId, p_order: order.id, p_phone: order.customer_phone, p_source_message: messageId ?? null,
      p_proof: {
        provider: proof.provider, transaction_reference: proof.transactionReference,
        amount: proof.amount, sender_phone: proof.senderPhone ?? "", sender_name: proof.senderName ?? "",
        proof_type: proof.provider === "other" ? "text" : "sms", proof_raw_text: proof.rawText,
        confidence_score: proof.confidenceScore, extracted_data: proof
      }
    });
    if (error) throw error;
    if (!data?.id) throw new Error("A base de dados não confirmou a receção do comprovativo.");
    if (data.created) await this.notifyProofReviewer(userId, order);
    return data as { id: string; created: boolean };
  }

  async notifyProofReviewer(userId: string, order: { order_number: string; customer_phone: string }) {
    try {
      const settings = await sellerSettings(userId);
      if (settings?.notification_phone && settings.notification_phone !== normalizeContactPhone(order.customer_phone)) {
        await whatsappManager.sendMessage(userId, `${settings.notification_phone}@s.whatsapp.net`,
          `AgentX: o pedido ${order.order_number} tem um comprovativo pendente. Abra Vendedor → Comprovativos e confirme o recebimento no prestador.`);
      }
    } catch {
      console.warn("[Commerce] Could not send seller proof notification.");
    }
  }

  async approveOrder(orderId: string, adminUserId: string, confirmation: {
    verified: boolean; method: string | null; reference: string | null; amount: string | null; proofId: string | null
  }) {
    let proofs = supabaseAdmin.from("payment_verifications").select("id,proof_raw_text,extracted_data")
      .eq("order_id", orderId).eq("user_id", adminUserId).eq("status", "pending");
    if (confirmation.proofId) proofs = proofs.eq("id", confirmation.proofId);
    const [{ data: expected, error: orderError }, { data: proof, error: proofError }] = await Promise.all([
      supabaseAdmin.from("orders").select("seller_payment").eq("id", orderId).eq("user_id", adminUserId).maybeSingle(),
      proofs.order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (orderError || proofError) throw orderError ?? proofError;
    if (proof && reviewProofRecipient(proof, expected?.seller_payment).recipientMatch === "mismatch") {
      throw { code: "22023", message: "O destinatário indicado no comprovativo difere do destino de pagamento do pedido." };
    }
    const { data: order, error } = await supabaseAdmin.rpc("agentx_seller_confirm_payment", {
      p_user: adminUserId, p_order: orderId, p_verified: confirmation.verified, p_method: confirmation.method,
      p_reference: confirmation.reference, p_amount: confirmation.amount, p_proof: confirmation.proofId ?? proof?.id ?? null,
      p_note: "Liquidação conferida no prestador pelo responsável da conta."
    });
    if (error) throw error;
    if (!order?.id) throw new Error("Payment confirmation returned no order");
    try {
      const fulfillment = await this.fulfillOrder(orderId, adminUserId);
      return { success: true, order, fulfillment };
    } catch {
      return { success: true, order,
        fulfillment: { delivered: false, message: "Pagamento confirmado. Consulta o pedido para verificar ou retomar a entrega." } };
    }
  }

  /**
   * Rejects an order with explicit reason
   */
  async rejectOrder(orderId: string, adminUserId: string, reason: string, proofId?: string | null) {
    const params = { p_user: adminUserId, p_order: orderId, p_reason: reason };
    const { data, error } = proofId
      ? await supabaseAdmin.rpc("agentx_seller_reject_proof", { ...params, p_proof: proofId })
      : await supabaseAdmin.rpc("agentx_seller_reject_order", params);
    if (error) throw error;
    const order = proofId ? data?.order : data;
    const notify = !proofId || data?.notify === true;
    if (!order?.id) throw new Error("Rejection returned no order");
    if (!notify) return { success: true, notified: false, awaitingOtherProofs: order.status === "verification_pending" };
    let notified = false;
    try {
      const phone = normalizeContactPhone(order.customer_phone);
      if (!phone) return { success: true, notified: false };
      const result = await whatsappManager.sendMessage(adminUserId,
        `${phone}@s.whatsapp.net`,
        `O comprovativo do pedido ${order.order_number} foi rejeitado. Motivo: ${reason}. Envie um novo comprovativo ou fale com a equipa.`);
      notified = Boolean(result?.key?.id);
    } catch {
      console.warn("[Commerce] Could not send rejection notification.");
    }
    return { success: true, notified };
  }

  /**
   * Delivers digital goods/service credentials to customer via WhatsApp with duplicate protection
   */
  async fulfillOrder(orderId: string, userId: string) {
    const { data: order, error } = await supabaseAdmin.from("orders")
      .select("*, order_items(*)").eq("id", orderId).eq("user_id", userId).single();
    if (error || !order) throw new Error("Pedido não encontrado.");
    if (order.status === "fulfilled") return { success: true, delivered: true };
    if (order.status !== "paid") throw new Error("O pagamento ainda aguarda confirmação.");
    if (order.delivery_started_at) return { success: false, delivered: false, message: "Envio em curso ou por confirmar. Verifique a conversa antes de qualquer reenvio." };

    const phone = normalizeContactPhone(order.customer_phone);
    if (!phone) return { success: false, delivered: false, message: "O número do cliente não está disponível para entrega." };
    const jid = `${phone}@s.whatsapp.net`;
    const lines: string[] = [];
    const writtenDeliverables: string[] = [];
    const files: Awaited<ReturnType<typeof loadProductFile>>[] = [];
    let remainingBytes = PRODUCT_FILE_LIMIT;
    for (const item of order.order_items ?? []) {
      let deliverable = item.deliverable_snapshot;
      if (!deliverable && item.product_id) {
        const { data: product, error: productError } = await supabaseAdmin.from("products")
          .select("type,digital_content,deliverable_path,deliverable_name")
          .eq("id", item.product_id).eq("user_id", userId).maybeSingle();
        if (productError) throw productError;
        if (product) deliverable = {
          type: product.type, text: product.digital_content,
          path: product.deliverable_path, name: product.deliverable_name
        };
      }
      let line = `• ${item.product_name} (x${item.quantity})`;
      const written = typeof deliverable?.text === "string" ? deliverable.text.trim() : "";
      const objectPath = typeof deliverable?.path === "string" ? deliverable.path : "";
      if (!written && (!objectPath || deliverable.type !== "digital")) {
        return { success: false, delivered: false, message: "Pagamento confirmado. Este pedido precisa de preparação ou entrega manual." };
      }
      if (written) {
        line += `\n${written}`;
        writtenDeliverables.push(line);
      }
      if (objectPath) {
        try {
          const name = typeof deliverable.name === "string" ? deliverable.name : item.product_name;
          const file = await loadProductFile(userId, objectPath, name, remainingBytes);
          remainingBytes -= file.content.byteLength;
          files.push(file);
        } catch (fileError) {
          return { success: false, delivered: false,
            message: fileError instanceof ProductFileError ? fileError.message
              : "O ficheiro ainda não pôde ser preparado. Verifique o catálogo e tente novamente." };
        }
      }
      lines.push(line);
    }
    if (!lines.length) {
      return { success: false, delivered: false, message: "Pagamento confirmado. Este pedido precisa de preparação ou entrega manual." };
    }

    const startedAt = new Date().toISOString();
    const { data: claim, error: claimError } = await supabaseAdmin.from("orders")
      .update({ delivery_started_at: startedAt, delivery_error: null })
      .eq("id", orderId).eq("user_id", userId).eq("status", "paid").is("delivery_started_at", null)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claim) return { success: false, delivered: false, message: "Outro processo está a tratar da entrega." };

    const payment = order.payment_reference
      ? `\nValor recebido: ${order.total_amount} ${order.currency}. Referência: ${order.payment_reference}.` : "";
    const confirmation = `Pagamento confirmado para o pedido *${order.order_number}*.${payment}`;
    let acknowledged = 0;
    try {
      for (const file of files) {
        const caption = acknowledged === 0
          ? `${confirmation}\n\nObrigado pela compra!` : `Ficheiro do pedido ${order.order_number}.`;
        const result = await whatsappManager.sendMessage(userId, jid, caption, file.content, "document", undefined,
          file.mimetype, file.name);
        if (!result?.key?.id) throw new Error("Envio sem identificador WhatsApp.");
        acknowledged += 1;
      }
      if (!files.length || writtenDeliverables.length) {
        const body = files.length
          ? `Conteúdo do pedido ${order.order_number}:\n\n${writtenDeliverables.join("\n\n")}`
          : `${confirmation}\n\n${lines.join("\n\n")}\n\nObrigado pela compra!`;
        const result = await whatsappManager.sendMessage(userId, jid, body);
        if (!result?.key?.id) throw new Error("Envio sem identificador WhatsApp.");
      }
    } catch (error) {
      const canRetry = !acknowledged && error instanceof Error && error.message === "WhatsApp session not connected.";
      const { error: updateError } = await supabaseAdmin.from("orders").update({
        delivery_error: canRetry ? "WhatsApp desligado" : acknowledged ? "Envio parcial por verificar" : "Envio por confirmar",
        ...(canRetry ? { delivery_started_at: null } : {})
      }).eq("id", orderId).eq("user_id", userId).eq("status", "paid").eq("delivery_started_at", startedAt);
      if (updateError) console.warn("[Commerce] Could not persist delivery recovery state:", updateError.code);
      return { success: false, delivered: false, message: canRetry && !updateError
        ? "WhatsApp desligado. Ligue a sessão e tente a entrega novamente."
        : "O envio ficou por confirmar. Verifique a conversa antes de qualquer reenvio." };
    }

    const deliveredAt = new Date().toISOString();
    const { data: delivered, error: deliveryError } = await supabaseAdmin.from("orders")
      .update({ status: "fulfilled", fulfilled_at: deliveredAt, updated_at: deliveredAt })
      .eq("id", orderId).eq("user_id", userId).eq("status", "paid").eq("delivery_started_at", startedAt)
      .select("id").maybeSingle();
    if (deliveryError || !delivered) return { success: false, delivered: false, message: "O WhatsApp recebeu a entrega, mas o estado está por confirmar. Verifique a conversa." };
    await this.recordTimelineEvent({
      userId, orderId, phone: order.customer_phone, step: "fulfilled",
      description: `Entrega do pedido ${order.order_number} aceite pelo WhatsApp.`,
      metadata: { deliveredAt, attachments: files.length }
    });
    return { success: true, delivered: true };
  }

  /**
   * Records a timeline event into agent_operations
   */
  async recordTimelineEvent(params: {
    userId: string;
    orderId?: string;
    contactId?: string;
    phone: string;
    step: string;
    description: string;
    metadata?: any;
  }) {
    try {
      await supabaseAdmin.from("agent_operations").insert({
        user_id: params.userId,
        order_id: params.orderId || null,
        contact_id: params.contactId || null,
        phone: params.phone,
        step: params.step,
        description: params.description,
        metadata: params.metadata || {},
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error("[CommerceService] Error recording timeline event:", e);
    }
  }

  /**
   * Retrieves timeline events for an order or user
   */
  async getOrderTimeline(orderId: string, userId: string) {
    const { data, error } = await supabaseAdmin
      .from("agent_operations")
      .select("*")
      .eq("order_id", orderId).eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }
}

export const commerceService = new CommerceService();


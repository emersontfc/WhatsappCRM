import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { PRODUCT_FILE_BUCKET } from "./catalogDeliverables.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import type { ExtractedPaymentData } from "./paymentProofSms.ts";
import { sellerSettings } from "./sellerWorkspace.ts";

export interface CreateOrderParams {
  userId: string;
  customerPhone: string;
  customerName: string;
  contactId?: string;
  paymentMethod: string;
  productId: string;
  sourceMessageId?: string;
  quantity: number;
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
    const { data, error } = await supabaseAdmin.from("products")
      .select("id,name,description,price,currency,category,stock")
      .eq("user_id", userId).eq("is_active", true)
      .order("created_at", { ascending: false }).order("id");
    if (error) throw error;
    return data ?? [];
  }

  async createOrder(params: CreateOrderParams) {
    const { data: order, error } = await supabaseAdmin.rpc("agentx_seller_create_order", {
      p_user: params.userId,
      p_product: params.productId,
      p_quantity: params.quantity,
      p_phone: normalizeContactPhone(params.customerPhone),
      p_customer: params.customerName,
      p_contact: params.contactId ?? null,
      p_method: params.paymentMethod,
      p_order_number: `AGX-${randomBytes(6).toString("hex").toUpperCase()}`,
      p_source_message: params.sourceMessageId ?? null
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
    if (data.created) {
      try {
        const settings = await sellerSettings(userId);
        if (settings?.notification_phone && settings.notification_phone !== normalizeContactPhone(order.customer_phone)) {
          const message = `AgentX: o pedido ${order.order_number} tem um comprovativo pendente. Abra Vendedor → Comprovativos e confirme o recebimento no prestador.`;
          await whatsappManager.sendMessage(userId, `${settings.notification_phone}@s.whatsapp.net`, message);
        }
      } catch {
        console.warn("[Commerce] Could not send seller proof notification.");
      }
    }
    return data as { id: string; created: boolean };
  }

  async approveOrder(orderId: string, adminUserId: string, method: string, reference: string, amount: string) {
    const { data: order, error } = await supabaseAdmin.rpc("agentx_seller_approve_order", {
      p_user: adminUserId, p_order: orderId, p_method: method, p_reference: reference, p_amount: amount,
      p_note: "Liquidação conferida no prestador pelo responsável da conta."
    });
    if (error) throw error;
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
  async rejectOrder(orderId: string, adminUserId: string, reason: string) {
    const { data: order, error } = await supabaseAdmin.rpc("agentx_seller_reject_order", {
      p_user: adminUserId, p_order: orderId, p_reason: reason
    });
    if (error) throw error;
    let notified = false;
    try {
      const result = await whatsappManager.sendMessage(adminUserId,
        `${normalizeContactPhone(order.customer_phone)}@s.whatsapp.net`,
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

    const lines: string[] = [];
    let manualDelivery = false;
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
      if (!deliverable || (deliverable.type !== "digital" && !deliverable.text) ||
          (!deliverable.text && !deliverable.path)) {
        manualDelivery = true;
        break;
      }
      let line = `• ${item.product_name} (x${item.quantity})`;
      if (deliverable.text) line += `\n${deliverable.text}`;
      if (deliverable.path) {
        if (!deliverable.path.startsWith(`${userId}/`)) throw new Error("Ficheiro fora do catálogo da conta.");
        const { data, error: signedError } = await supabaseAdmin.storage.from(PRODUCT_FILE_BUCKET)
          .createSignedUrl(deliverable.path, 86400, { download: deliverable.name || true });
        if (signedError || !data) return { success: false, delivered: false, message: "Não foi possível preparar o ficheiro. Pode tentar a entrega novamente." };
        line += `\n${data.signedUrl} (válido por 24 horas)`;
      }
      lines.push(line);
    }
    if (manualDelivery || !lines.length) {
      return { success: false, delivered: false, message: "Pagamento confirmado. Este pedido precisa de preparação ou entrega manual." };
    }

    const { data: claim, error: claimError } = await supabaseAdmin.from("orders")
      .update({ delivery_started_at: new Date().toISOString(), delivery_error: null })
      .eq("id", orderId).eq("user_id", userId).eq("status", "paid").is("delivery_started_at", null)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claim) return { success: false, delivered: false, message: "Outro processo está a tratar da entrega." };

    try {
      const payment = order.payment_reference
        ? `\nValor recebido: ${order.total_amount} ${order.currency}. Referência: ${order.payment_reference}.\n` : "";
      const result = await whatsappManager.sendMessage(userId, `${order.customer_phone}@s.whatsapp.net`,
        `Pagamento confirmado para o pedido *${order.order_number}*.${payment}\n\n${lines.join("\n\n")}\n\nObrigado pela compra!`);
      if (!result?.key?.id) throw new Error("Envio sem identificador WhatsApp.");
    } catch (error) {
      const disconnected = error instanceof Error && error.message === "WhatsApp session not connected.";
      await supabaseAdmin.from("orders").update({
        delivery_error: disconnected ? "WhatsApp desligado" : "Envio por confirmar",
        ...(disconnected ? { delivery_started_at: null } : {})
      }).eq("id", orderId).eq("user_id", userId);
      return { success: false, delivered: false, message: disconnected
        ? "WhatsApp desligado. Ligue a sessão e tente a entrega novamente."
        : "O WhatsApp não confirmou o envio. Verifique a conversa antes de qualquer reenvio." };
    }

    const deliveredAt = new Date().toISOString();
    const { error: deliveryError } = await supabaseAdmin.from("orders")
      .update({ status: "fulfilled", fulfilled_at: deliveredAt, updated_at: deliveredAt })
      .eq("id", orderId).eq("user_id", userId).eq("status", "paid");
    if (deliveryError) return { success: false, delivered: false, message: "O WhatsApp recebeu a entrega, mas o estado está por confirmar. Verifique a conversa." };
    await this.recordTimelineEvent({
      userId, orderId, phone: order.customer_phone, step: "fulfilled",
      description: `Entrega do pedido ${order.order_number} aceite pelo WhatsApp.`,
      metadata: { deliveredAt }
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


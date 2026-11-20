import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { PRODUCT_FILE_BUCKET } from "./catalogDeliverables.ts";
import { whatsappManager } from "../whatsappManager.ts";

export interface CreateOrderParams {
  userId: string;
  customerPhone: string;
  customerName: string;
  contactId?: string;
  paymentMethod: string;
  productId: string;
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
    const { data: order, error } = await supabaseAdmin.rpc("agentx_catalog_create_order", {
      p_user: params.userId,
      p_product: params.productId,
      p_quantity: params.quantity,
      p_phone: params.customerPhone.replace(/\D/g, ""),
      p_customer: params.customerName,
      p_contact: params.contactId ?? null,
      p_method: params.paymentMethod,
      p_order_number: `AGX-${randomBytes(6).toString("hex").toUpperCase()}`
    });
    if (error) throw error;
    await this.recordTimelineEvent({
      userId: params.userId, orderId: order.id, contactId: params.contactId,
      phone: order.customer_phone, step: "order_created",
      description: `Pedido ${order.order_number} criado. Aguardando pagamento.`
    });
    return { order };
  }

  /**
   * Submits a payment proof for an order or user, pending admin review
   */
  async submitPaymentProof(params: {
    userId: string;
    orderId?: string;
    customerPhone: string;
    provider: string;
    transactionReference: string;
    amount: number;
    senderPhone?: string;
    senderName?: string;
    proofType: "sms" | "image" | "pdf" | "text";
    proofRawText?: string;
    proofMediaUrl?: string;
    confidenceScore?: number;
    extractedData?: any;
  }) {
    const { 
      userId, 
      orderId, 
      customerPhone, 
      provider, 
      transactionReference, 
      amount, 
      senderPhone, 
      senderName, 
      proofType, 
      proofRawText, 
      proofMediaUrl, 
      confidenceScore = 0.85, 
      extractedData = {} 
    } = params;

    const cleanPhone = customerPhone.replace(/\D/g, "");

    if (orderId) {
      const { data: eligible, error } = await supabaseAdmin.from("orders").select("id")
        .eq("id", orderId).eq("user_id", userId).eq("customer_phone", cleanPhone)
        .in("status", ["created", "awaiting_payment", "verification_pending", "rejected"]).maybeSingle();
      if (error || !eligible) throw new Error("Pedido indisponível para receber comprovativos.");
    }

    // 1. Create verification record
    const { data: verification, error: verErr } = await supabaseAdmin
      .from("payment_verifications")
      .insert({
        order_id: orderId || null,
        user_id: userId,
        customer_phone: cleanPhone,
        provider,
        transaction_reference: transactionReference,
        amount,
        currency: "MT",
        sender_phone: senderPhone || "",
        sender_name: senderName || "",
        proof_type: proofType,
        proof_raw_text: proofRawText || "",
        proof_media_url: proofMediaUrl || "",
        confidence_score: confidenceScore,
        extracted_data: extractedData,
        status: "pending",
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (verErr) throw verErr;

    // 2. If orderId exists, update order status to verification_pending
    if (orderId) {
      await supabaseAdmin
        .from("orders")
        .update({
          status: "verification_pending",
          proof_url: proofMediaUrl || null,
          proof_data: { verificationId: verification.id, ...extractedData },
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId).eq("user_id", userId)
        .in("status", ["created", "awaiting_payment", "verification_pending", "rejected"]);

      await this.recordTimelineEvent({
        userId,
        orderId,
        phone: cleanPhone,
        step: "verification_pending",
        description: `Comprovativo ${transactionReference} (${amount} MT) recebido. Pendente de validação humana.`,
        metadata: { verificationId: verification.id, provider, amount }
      });
    }

    return { success: true, verification };
  }

  /**
   * Approves an order by an authorized human administrator and triggers digital fulfillment
   */
  async approveOrder(orderId: string, adminUserId: string, notes?: string) {
    const { data: order, error } = await supabaseAdmin.rpc("agentx_catalog_approve_order", {
      p_user: adminUserId, p_order: orderId, p_note: notes?.trim() || "Pagamento conferido no prestador."
    });
    if (error) throw error;
    const fulfillment = await this.fulfillOrder(orderId, adminUserId);
    return { success: true, order, fulfillment };
  }

  /**
   * Rejects an order with explicit reason
   */
  async rejectOrder(orderId: string, adminUserId: string, reason: string) {
    const nowISO = new Date().toISOString();
    const { data: order, error: getErr } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, customer_phone, order_number")
      .eq("id", orderId).eq("user_id", adminUserId)
      .eq("status", "verification_pending").single();

    if (getErr || !order) throw new Error("Pedido não encontrado.");

    const { data: rejected, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: "rejected",
        rejected_reason: reason,
        approved_by: adminUserId,
        approved_at: nowISO,
        updated_at: nowISO
      })
      .eq("id", orderId).eq("user_id", adminUserId).eq("status", "verification_pending")
      .select("id").maybeSingle();
    if (updateError || !rejected) throw new Error("O pedido já saiu da fila de verificação.");

    await supabaseAdmin
      .from("payment_verifications")
      .update({
        status: "rejected",
        reviewed_by: adminUserId,
        reviewed_at: nowISO
      })
      .eq("order_id", orderId).eq("user_id", adminUserId).eq("status", "pending");

    await this.recordTimelineEvent({
      userId: order.user_id,
      orderId,
      phone: order.customer_phone,
      step: "admin_rejected",
      description: `Pedido ${order.order_number} rejeitado: ${reason}`,
      metadata: { reason, adminUserId }
    });

    // Notify customer on WhatsApp
    try {
      const jid = `${order.customer_phone}@s.whatsapp.net`;
      await whatsappManager.sendMessage(
        order.user_id,
        jid,
        `⚠️ *Aviso sobre o Pedido ${order.order_number}*\n\nNão foi possível validar o seu pagamento pelo seguinte motivo: *${reason}*.\n\nPor favor, envie um novo comprovativo legível ou fale com o nosso suporte.`
      );
    } catch (e) {
      console.warn("[CommerceService] Could not send rejection message:", e);
    }

    return { success: true };
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
      const result = await whatsappManager.sendMessage(userId, `${order.customer_phone}@s.whatsapp.net`,
        `Pagamento confirmado para o pedido *${order.order_number}*.\n\n${lines.join("\n\n")}\n\nObrigado pela compra!`);
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


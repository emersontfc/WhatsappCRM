import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";

export interface CreateOrderParams {
  userId: string;
  customerPhone: string;
  customerName?: string;
  contactId?: string;
  paymentMethod?: "mpesa" | "emola" | "bank_transfer" | "reference" | "other";
  items: {
    productId?: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }[];
}

export class CommerceService {
  /**
   * Generates a human-friendly unique order reference e.g. AGX-8492
   */
  private generateOrderNumber(): string {
    const random = Math.floor(1000 + Math.random() * 9000);
    return `AGX-${random}`;
  }

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

  /**
   * Creates a new commercial order with items and records timeline event
   */
  async createOrder(params: CreateOrderParams) {
    const { userId, customerPhone, customerName, contactId, paymentMethod = "mpesa", items } = params;
    
    if (!items || items.length === 0) {
      throw new Error("O pedido precisa conter pelo menos 1 item.");
    }

    const cleanPhone = customerPhone.replace(/\D/g, "");
    const orderNumber = this.generateOrderNumber();
    const totalAmount = items.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);

    // 1. Insert order
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        user_id: userId,
        contact_id: contactId || null,
        customer_name: customerName || "Cliente",
        customer_phone: cleanPhone,
        total_amount: totalAmount,
        currency: "MT",
        status: "awaiting_payment",
        payment_method: paymentMethod,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    // 2. Insert items
    const orderItemsPayload = items.map(i => ({
      order_id: order.id,
      product_id: i.productId || null,
      product_name: i.productName,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      total_price: i.quantity * i.unitPrice,
      created_at: new Date().toISOString()
    }));

    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(orderItemsPayload);
    if (itemsErr) console.warn("[CommerceService] Error inserting order items:", itemsErr.message);

    // 3. Record timeline step
    await this.recordTimelineEvent({
      userId,
      orderId: order.id,
      contactId,
      phone: cleanPhone,
      step: "order_created",
      description: `Pedido ${orderNumber} criado no valor de ${totalAmount} MT. Aguardando pagamento.`,
      metadata: { items, totalAmount, paymentMethod }
    });

    return {
      success: true,
      order,
      items: orderItemsPayload
    };
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
        .eq("id", orderId);

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
    const { data: order, error: getErr } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();

    if (getErr || !order) throw new Error("Pedido não encontrado.");

    if (order.status === "paid" || order.status === "fulfilled") {
      return { success: true, message: "Pedido já aprovado anteriormente.", order };
    }

    // 1. Update order status to paid
    const nowISO = new Date().toISOString();
    const { data: updatedOrder, error: upErr } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        approved_by: adminUserId,
        approved_at: nowISO,
        verification_notes: notes || "Aprovado pelo administrador.",
        updated_at: nowISO
      })
      .eq("id", orderId)
      .select()
      .single();

    if (upErr) throw upErr;

    // 2. Update payment verification status
    await supabaseAdmin
      .from("payment_verifications")
      .update({
        status: "approved",
        reviewed_by: adminUserId,
        reviewed_at: nowISO
      })
      .eq("order_id", orderId);

    // 3. Record timeline step
    await this.recordTimelineEvent({
      userId: order.user_id,
      orderId,
      phone: order.customer_phone,
      step: "admin_approved",
      description: `Pagamento aprovado pelo administrador (${order.total_amount} MT). Iniciando entrega.`,
      metadata: { adminUserId, notes }
    });

    // 4. Automatically trigger fulfillment of digital products
    const fulfillmentResult = await this.fulfillOrder(orderId);

    return {
      success: true,
      order: updatedOrder,
      fulfillment: fulfillmentResult
    };
  }

  /**
   * Rejects an order with explicit reason
   */
  async rejectOrder(orderId: string, adminUserId: string, reason: string) {
    const nowISO = new Date().toISOString();
    const { data: order, error: getErr } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, customer_phone, order_number")
      .eq("id", orderId)
      .single();

    if (getErr || !order) throw new Error("Pedido não encontrado.");

    await supabaseAdmin
      .from("orders")
      .update({
        status: "rejected",
        rejected_reason: reason,
        approved_by: adminUserId,
        approved_at: nowISO,
        updated_at: nowISO
      })
      .eq("id", orderId);

    await supabaseAdmin
      .from("payment_verifications")
      .update({
        status: "rejected",
        reviewed_by: adminUserId,
        reviewed_at: nowISO
      })
      .eq("order_id", orderId);

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
  async fulfillOrder(orderId: string) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();

    if (!order) throw new Error("Pedido não encontrado.");
    if (order.status === "fulfilled") {
      return { success: true, message: "Pedido já entregue anteriormente." };
    }

    const items = order.order_items || [];
    let deliveryMessage = `🎉 *PAGAMENTO CONFIRMADO!*\n\nOlá *${order.customer_name || "Cliente"}*! O seu pedido *${order.order_number}* foi confirmado e aprovado com sucesso.\n\n📦 *SEUS PRODUTOS:*\n`;

    // Fetch product details for digital content
    for (const item of items) {
      if (item.product_id) {
        const { data: prod } = await supabaseAdmin
          .from("products")
          .select("name, digital_content, type")
          .eq("id", item.product_id)
          .maybeSingle();

        if (prod?.digital_content) {
          deliveryMessage += `\n• *${item.product_name}* (Qtd: ${item.quantity}):\n${prod.digital_content}\n`;
        } else {
          deliveryMessage += `\n• *${item.product_name}* (Qtd: ${item.quantity}) — Liberado e ativo no sistema.\n`;
        }
      } else {
        deliveryMessage += `\n• *${item.product_name}* (Qtd: ${item.quantity}) — Concluído.\n`;
      }
    }

    deliveryMessage += `\nMuito obrigado pela sua preferência! Se tiver qualquer dúvida, estamos à disposição.`;

    // Dispatch WhatsApp delivery
    const nowISO = new Date().toISOString();
    try {
      const jid = `${order.customer_phone}@s.whatsapp.net`;
      await whatsappManager.sendMessage(order.user_id, jid, deliveryMessage);
    } catch (e) {
      console.warn("[CommerceService] Error delivering order via WhatsApp:", e);
    }

    // Mark as fulfilled
    await supabaseAdmin
      .from("orders")
      .update({
        status: "fulfilled",
        fulfilled_at: nowISO,
        updated_at: nowISO
      })
      .eq("id", orderId);

    await this.recordTimelineEvent({
      userId: order.user_id,
      orderId,
      phone: order.customer_phone,
      step: "fulfilled",
      description: `Produtos do pedido ${order.order_number} entregues ao cliente via WhatsApp.`,
      metadata: { deliveredAt: nowISO }
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
  async getOrderTimeline(orderId: string) {
    const { data, error } = await supabaseAdmin
      .from("agent_operations")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }
}

export const commerceService = new CommerceService();


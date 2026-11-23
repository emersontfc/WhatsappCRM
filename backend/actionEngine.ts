import { supabaseAdmin } from "./supabaseAdmin.ts";
import { normalizeContactPhone } from "../shared/contactPhone.ts";

export interface ActionPayload {
  action: string;
  data: any;
  userId: string;
  phone: string;
  contactId?: string | null;
  intent?: string;
}

const ALLOWED_ACTIONS = ["create_lead", "create_reminder", "pause_bot"];

export async function executeAction(payload: ActionPayload) {
  const { action, data, userId, contactId, intent } = payload;
  const phone = normalizeContactPhone(payload.phone);

  if (!ALLOWED_ACTIONS.includes(action)) {
    console.warn(`[Action Engine] Action "${action}" is not allowed.`);
    return { success: false, error: "Action not allowed" };
  }
  if (!phone) return { success: false, error: "Telefone do contacto indisponível." };

  try {
    const variants = /^2588[2-7]\d{7}$/.test(phone) ? [phone, phone.slice(3)] : [phone];
    const { data: lead, error: lookupError } = await supabaseAdmin
      .from("leads")
      .select("last_action, updated_at")
      .eq("user_id", userId)
      .in("phone", variants)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (lead?.last_action === action && Date.now() - new Date(lead.updated_at).getTime() < 300000) {
      return { success: false, error: "Action cooldown" };
    }

    const isLeadAction = action === "create_lead";
    const name = isLeadAction && typeof data?.name === "string" ? data.name.trim().slice(0, 150) || null : null;
    const message = isLeadAction && typeof data?.notes === "string" ? data.notes.trim().slice(0, 500) || null : null;
    const { data: leadId, error: captureError } = await supabaseAdmin.rpc("agentx_capture_sales_lead", {
      p_user: userId, p_phone: phone, p_contact: contactId ?? null,
      p_name: name, p_activity: isLeadAction ? "interest" : "inbound", p_message: message
    });
    if (captureError) throw captureError;
    if (!leadId) throw new Error("Lead capture returned no identifier");

    const { error: memoryError } = await supabaseAdmin.from("leads")
      .update({ intent, last_action: action, updated_at: new Date().toISOString() })
      .eq("id", leadId).eq("user_id", userId).select("id").single();
    if (memoryError) throw memoryError;

    const { error: logError } = await supabaseAdmin.from("agent_logs").insert({
      user_id: userId,
      phone,
      intent,
      action,
      data
    });
    if (logError) console.warn("[Action Engine] Activity log unavailable:", logError.code);

    switch (action) {
      case "create_lead":
        return { success: true, message: "Interesse guardado no CRM." };
      case "create_reminder":
        return await handleCreateReminder(userId, phone, data);
      case "pause_bot":
        return await handlePauseBot(userId, phone, contactId);
      default:
        return { success: false, error: "Action not implemented" };
    }
  } catch (error) {
    console.warn("[Action Engine] Could not execute action:", action, (error as { code?: string })?.code ?? "unavailable");
    return { success: false, error: "Não foi possível concluir a ação no CRM." };
  }
}

async function handleCreateReminder(userId: string, phone: string, data: any) {
  const { text, date } = data;
  
  const scheduledAt = date ? new Date(date) : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default to 24h later
  
  const { error } = await supabaseAdmin.from("reminders").insert({
    user_id: userId,
    phone,
    message: text || "Lembrete de acompanhamento",
    scheduled_at: scheduledAt.toISOString(),
    sent: false
  });

  if (error) throw error;
  return { success: true, message: "Reminder scheduled successfully" };
}

async function handlePauseBot(userId: string, phone: string, contactId?: string | null) {
  let query = supabaseAdmin
    .from("contacts")
    .update({
      ai_paused: true,
      ai_paused_at: new Date().toISOString()
    })
    .eq("user_id", userId);
  query = contactId ? query.eq("id", contactId) : query.eq("phone", phone);
  const { data, error } = await query.select("id").limit(1).maybeSingle();

  if (error) throw error;
  if (!data) return { success: false, error: "Contacto não encontrado." };
  return { success: true, message: "Bot pausado para este contacto (Modo Humano activado)" };
}

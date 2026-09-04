import { supabaseAdmin } from "./supabaseAdmin.ts";

export interface ActionPayload {
  action: string;
  data: any;
  userId: string;
  phone: string;
  intent?: string;
}

const ALLOWED_ACTIONS = ["create_lead", "trigger_price_flow", "create_reminder", "pause_bot"];

export async function executeAction(payload: ActionPayload) {
  const { action, data, userId, phone, intent } = payload;

  if (!ALLOWED_ACTIONS.includes(action)) {
    console.warn(`[Action Engine] Action "${action}" is not allowed.`);
    return { success: false, error: "Action not allowed" };
  }

  // 8. Action Cooldown (Anti-loop)
  try {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("last_action, updated_at")
      .eq("user_id", userId)
      .eq("phone", phone)
      .maybeSingle();

    if (lead && lead.last_action === action) {
      const lastActionTime = new Date(lead.updated_at).getTime();
      const now = Date.now();
      // If same action within 5 minutes, ignore to prevent loops
      if (now - lastActionTime < 300000) {
        console.log(`[Action Engine] Cooldown active for action "${action}" on ${phone}`);
        return { success: false, error: "Action cooldown" };
      }
    }
  } catch (e) {
    console.error("[Action Engine] Error checking cooldown:", e);
  }

  console.log(`[Action Engine] Executing action: ${action} for ${phone}`);

  try {
    // 10. Logging System
    await supabaseAdmin.from("agent_logs").insert({
      user_id: userId,
      phone,
      intent,
      action,
      data
    });

    // 9. Intent Memory
    await supabaseAdmin.from("leads").upsert({
      user_id: userId,
      phone,
      intent,
      last_action: action,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id, phone" });

    switch (action) {
      case "create_lead":
        return await handleCreateLead(userId, phone, data);
      case "trigger_price_flow":
        return await handleTriggerPriceFlow(userId, phone, data);
      case "create_reminder":
        return await handleCreateReminder(userId, phone, data);
      case "pause_bot":
        return await handlePauseBot(userId, phone);
      default:
        return { success: false, error: "Action not implemented" };
    }
  } catch (err: any) {
    console.error(`[Action Engine] Error executing ${action}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function handleCreateLead(userId: string, phone: string, data: any) {
  const { name, email, notes } = data;
  
  // Also try to find contact_id
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", phone)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("leads").upsert({
    user_id: userId,
    contact_id: contact?.id || null,
    phone,
    name: name || null,
    last_message: notes || "Lead atualizado via IA",
    status: "qualified",
    stage: "em_atendimento",
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,phone" });

  if (error) throw error;
  return { success: true, message: "Lead created/updated successfully" };
}

async function handleTriggerPriceFlow(userId: string, phone: string, data: any) {
  console.log(`[Action Engine] Price flow triggered for ${phone}. Data:`, data);
  return { success: true, message: "Price flow triggered" };
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

async function handlePauseBot(userId: string, phone: string) {
  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      ai_paused: true,
      ai_paused_at: new Date().toISOString()
    })
    .eq("user_id", userId)
    .eq("phone", phone);

  if (error) throw error;
  return { success: true, message: "Bot pausado para este contacto (Modo Humano activado)" };
}

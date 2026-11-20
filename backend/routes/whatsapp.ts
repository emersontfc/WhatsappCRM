import { dispatchScheduled } from "../services/scheduledDispatch.ts";
import express from "express";
import { whatsappManager } from "../whatsappManager.ts";
import { AuthRequest } from "../middleware/auth.ts";
import { getPlan } from "../lib/plan.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = express.Router();

// Debug middleware for this router
router.use((req, res, next) => {
  console.log(`[WhatsApp Router] ${req.method} ${req.url}`);
  next();
});

router.get("/operator-settings", async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const { data, error } = await supabaseAdmin.from("whatsapp_operator_settings").select("contact_alerts")
      .eq("user_id", req.user.id).maybeSingle();
    if (error) return res.status(503).json({ error: "Preferências indisponíveis." });
    return res.json({ data: { contact_alerts: data?.contact_alerts ?? false } });
  } catch {
    return res.status(503).json({ error: "Preferências indisponíveis." });
  }
});

router.put("/operator-settings", async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    if (typeof req.body?.contact_alerts !== "boolean") return res.status(400).json({ error: "Preferência inválida." });
    const { error } = await supabaseAdmin.from("whatsapp_operator_settings")
      .upsert({ user_id: req.user.id, contact_alerts: req.body.contact_alerts });
    if (error) return res.status(503).json({ error: "Não foi possível guardar as preferências." });
    return res.json({ data: { contact_alerts: req.body.contact_alerts } });
  } catch {
    return res.status(503).json({ error: "Preferências indisponíveis." });
  }
});

router.post("/send-scheduled*", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { id, type } = req.body ?? {};
  if (typeof id !== "string" || !["status", "contact"].includes(type)) {
    return res.status(400).json({ error: "Agendamento inválido." });
  }
  try {
    const result = await dispatchScheduled(type === "status" ? "scheduled_status" : "scheduled_messages", id, userId);
    return res.status(result.success ? 200 : 409).json(result);
  } catch {
    return res.status(503).json({ error: "Não foi possível confirmar o envio. Consulte a agenda antes de tentar novamente." });
  }
});

router.get(["/chats", "/chats/"], async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data: contacts, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) throw error;
    res.json({ success: true, chats: contacts });
  } catch (err: any) {
    console.error("[WhatsApp Sync] Error for user", userId, ":", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/chats/:contactId/toggle-ai", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { contactId } = req.params;
  const { paused } = req.body;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    let nextPaused = paused;
    if (nextPaused === undefined) {
      const { data: current } = await supabaseAdmin
        .from("contacts")
        .select("ai_paused")
        .eq("id", contactId)
        .eq("user_id", userId)
        .single();
      nextPaused = !current?.ai_paused;
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .update({ 
        ai_paused: nextPaused,
        ai_paused_at: nextPaused ? new Date().toISOString() : null
      })
      .eq("id", contactId)
      .eq("user_id", userId)
      .select("id, ai_paused, ai_paused_at")
      .single();

    if (error) throw error;
    res.json({ success: true, ai_paused: data?.ai_paused, data });
  } catch (err: any) {
    console.error("[WhatsApp Chat] toggle-ai error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/chats/:contactId/read", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { contactId } = req.params;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    try {
      await supabaseAdmin
        .from("contacts")
        .update({ unread_count: 0 })
        .eq("id", contactId)
        .eq("user_id", userId);
    } catch (e) {
      // unread_count column might not exist yet
    }

    try {
      await supabaseAdmin
        .from("messages")
        .update({ is_read: true })
        .eq("contact_id", contactId)
        .eq("user_id", userId)
        .eq("is_read", false);
    } catch (e) {
      // is_read column might not exist yet
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[WhatsApp Chat] read error:", err);
    res.json({ success: true });
  }
});

router.post(["/sync", "/sync/"], async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const session = whatsappManager.getSession(userId);
    if (!session || session.status !== "connected") {
      return res.json({ success: false, error: "WhatsApp não conectado. Por favor, conecte primeiro no Dashboard." });
    }

    // Return current contacts
    const { data: contacts, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) throw error;
    res.json({ success: true, chats: contacts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/sync-contacts", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const result = await whatsappManager.syncCurrentSessionContacts(userId);
    res.json(result);
  } catch (err: any) {
    console.error("[WhatsApp sync-contacts] error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/status", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { mediaUrl, mediaType, text } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!text?.trim() && !mediaUrl) {
    return res.status(400).json({ success: false, code: "INVALID_ARGUMENTS", error: "Texto ou Mídia é obrigatório para publicar Status no WhatsApp." });
  }

  const session = whatsappManager.getSession(userId);
  if (!session || session.status !== "connected") {
    return res.status(400).json({ 
      success: false, 
      code: "SESSION_NOT_CONNECTED", 
      error: "Sessão WhatsApp desconectada. Conecte o aparelho antes de publicar no Status.",
      retryable: true 
    });
  }

  try {
    let detectedMediaType = mediaType;
    if (mediaUrl && !detectedMediaType) {
      detectedMediaType = mediaUrl.match(/\.(mp4|mov|avi|webm)/i) ? "video" : "image";
    }

    const result = await whatsappManager.sendMessage(userId, "status@broadcast", text || "", mediaUrl, detectedMediaType);
    res.json({ success: true, message: "Status publicado com sucesso no WhatsApp!", result });
  } catch (err: any) {
    console.error("[WhatsApp Status Post Error]:", err.message);
    res.status(500).json({ 
      success: false, 
      code: "EXECUTION_FAILED",
      error: err.message || "Erro ao publicar no Status do WhatsApp." 
    });
  }
});

router.post("/connect", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const plan = await getPlan(userId);
  if (!plan) return res.status(403).json({ success: false, error: "Plan not found" });

  try {
    await whatsappManager.deleteSession(userId);
    await whatsappManager.createSession(userId);
    const session = whatsappManager.getSession(userId);
    res.json({ success: true, status: session?.status || "connecting" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/qr", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const session = whatsappManager.getSession(userId);
    if (!session) {
      console.log(`[WhatsApp QR] No session found for user: ${userId}. Creating one...`);
      whatsappManager.createSession(userId); // Trigger session creation if it doesn't exist
      return res.json({ success: true, status: "connecting", qr: null });
    }

    console.log(`[WhatsApp QR] Returning QR for user: ${userId}, status: ${session.status}, hasQR: ${!!session.qr}`);

    res.json({
      success: true,
      qr: session.qr || null,
      status: session.status,
    });
  } catch (error) {
    console.error(`[WhatsApp QR] Error for user ${userId}:`, error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/status", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const session = whatsappManager.getSession(userId);
    let status = session?.status || "disconnected";
    
    // If status is QR but we don't have the code yet, report as connecting
    if (status === "qr" && !session?.qr) {
      status = "connecting";
    }

    res.json({
      success: true,
      status,
      connected: status === "connected",
      pairingCode: session?.pairingCode || null,
    });
  } catch (error) {
    console.error(`[WhatsApp Status] Error for user ${userId}:`, error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/pair-code", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: "Número de telefone é obrigatório" });
  }

  try {
    const code = await whatsappManager.requestPairingCode(userId, phoneNumber);
    res.json({ success: true, code });
  } catch (error: any) {
    console.error(`[WhatsApp Pair Code] Error for user ${userId}:`, error);
    res.status(500).json({ success: false, error: error.message || "Falha ao gerar código de pareamento" });
  }
});

router.post("/reset", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await whatsappManager.deleteSession(userId);
    res.json({ success: true, message: "Sessão resetada com sucesso" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/me", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const me = whatsappManager.getMe(userId);
  res.json({ success: true, me });
});

router.post("/send", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  let { jid, text, to, mediaUrl, mediaType, duration, contactId } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const plan = await getPlan(userId);
  if (!plan) return res.status(403).json({ success: false, error: "Plan not found" });

  // Handle both 'jid' and 'to' for backward compatibility
  if (!jid && to) jid = to;

  if (!jid || (!text && !mediaUrl)) {
    return res.status(400).json({ success: false, error: "jid and (text or mediaUrl) are required" });
  }

  // Enforce max messages per day
  const { data: subs } = await supabaseAdmin
    .from("subscriptions")
    .select("messages_used")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const sub = subs?.[0];
  const currentUsed = sub?.messages_used || 0;
  const maxMessages = plan.max_messages_per_day || 150;

  if (currentUsed >= maxMessages) {
    return res.status(403).json({ 
      success: false, 
      error: `Limite de mensagens atingido. Seu plano permite ${maxMessages} mensagens por dia.` 
    });
  }

  let resolvedContactId = contactId;
  let contactRecord: any = null;
  if (resolvedContactId) {
    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("id, phone, lid")
      .eq("id", resolvedContactId)
      .eq("user_id", userId)
      .maybeSingle();
    contactRecord = c;
  }

  // Determine formatted JID
  let formattedJid = jid;
  if (contactRecord) {
    if (contactRecord.lid && (!contactRecord.phone || contactRecord.phone === contactRecord.lid)) {
      const cleanLid = contactRecord.lid.replace("@lid", "").replace(/\D/g, "");
      formattedJid = `${cleanLid}@lid`;
    } else if (contactRecord.phone) {
      let clean = contactRecord.phone.replace(/\D/g, "");
      if (clean.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(clean.slice(0, 2))) {
        clean = `258${clean}`;
      }
      formattedJid = clean.startsWith("120363") ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;
    }
  }

  if (!formattedJid) {
    let cleanDigits = (jid || "").replace(/@s\.whatsapp\.net|@g\.us|@broadcast|@newsletter|@lid/g, "").replace(/\D/g, "");
    if (cleanDigits.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(cleanDigits.slice(0, 2))) {
      cleanDigits = `258${cleanDigits}`;
    }
    const isLid = (jid || "").includes("@lid") || (cleanDigits.length === 15 && !cleanDigits.startsWith("258"));
    if (cleanDigits.startsWith("120363") || (jid || "").includes("@g.us")) {
      formattedJid = `${cleanDigits}@g.us`;
    } else if (isLid) {
      formattedJid = `${cleanDigits}@lid`;
    } else {
      formattedJid = `${cleanDigits}@s.whatsapp.net`;
    }
  }

  try {
    const result = await whatsappManager.sendMessage(userId, formattedJid, text || "", mediaUrl, mediaType, duration);
    
    // Increment usage
    await supabaseAdmin
      .from("subscriptions")
      .update({ messages_used: currentUsed + 1 })
      .eq("user_id", userId);

    let savedMessage = result?.savedMessage || null;
    if (!savedMessage && result?.key?.id) {
      const { data: existing } = await supabaseAdmin
        .from("messages")
        .select("*")
        .eq("user_id", userId)
        .eq("msg_id", result.key.id)
        .maybeSingle();
      savedMessage = existing;
    }

    if (savedMessage?.contact_id) {
      resolvedContactId = savedMessage.contact_id;
    }

    res.json({ success: true, result, message: savedMessage, contact_id: resolvedContactId });
  } catch (err: any) {
    console.error("Failed to send message:", err);
    if (err.message && err.message.includes("WhatsApp session not connected")) {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post("/test", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const me = whatsappManager.getMe(userId);
    if (!me) throw new Error("Bot não conectado.");
    
    // Send to self
    const jid = me.id.split(":")[0] + "@s.whatsapp.net";
    await whatsappManager.sendMessage(userId, jid, "🚀 Teste de conexão Agentex bem-sucedido! Seu bot está pronto para automatizar.");
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to send test message:", err);
    if (err.message && (err.message.includes("WhatsApp session not connected") || err.message === "Bot não conectado.")) {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/pause", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const result = await whatsappManager.pauseSession(userId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("Failed to pause WhatsApp:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/groups", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const groupsObj = await whatsappManager.getGroups(userId);
    const groups = Object.values(groupsObj || {});
    res.json({ success: true, groups });
  } catch (err: any) {
    if (err.message === "WhatsApp não conectado") {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/groups/:jid", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const metadata = await whatsappManager.getGroupMetadata(userId, jid);
    res.json({ success: true, metadata });
  } catch (err: any) {
    if (err.message === "WhatsApp não conectado") {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/groups/:jid/participants", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  const { participants, action } = req.body; // action: 'add', 'remove', 'promote', 'demote'
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!participants || !action) return res.status(400).json({ error: "participants and action are required" });

  try {
    const result = await whatsappManager.updateGroupParticipants(userId, jid, participants, action);
    res.json({ success: true, result });
  } catch (err: any) {
    if (err.message === "WhatsApp não conectado") {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/groups/:jid/subject", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  const { subject } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!subject) return res.status(400).json({ error: "subject is required" });

  try {
    const result = await whatsappManager.updateGroupSubject(userId, jid, subject);
    res.json({ success: true, result });
  } catch (err: any) {
    if (err.message === "WhatsApp não conectado") {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/groups/:jid/leave", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const result = await whatsappManager.leaveGroup(userId, jid);
    res.json({ success: true, result });
  } catch (err: any) {
    if (err.message === "WhatsApp não conectado") {
      return res.json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/groups/:jid/rules", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data, error } = await supabaseAdmin
      .from("group_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("group_jid", jid)
      .maybeSingle();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/groups/:jid/rules", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { jid } = req.params;
  const rules = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { id, created_at, ...rulesToSave } = rules;
    const { data, error } = await supabaseAdmin
      .from("group_rules")
      .upsert({
        user_id: userId,
        group_jid: jid,
        ...rulesToSave,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,group_jid' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all for unmatched WhatsApp routes to help debug 404s
router.use((req, res) => {
  console.warn(`[WhatsApp Router] Route not handled: ${req.method} ${req.url} (Original: ${req.originalUrl})`);
  res.status(404).json({ 
    success: false, 
    error: `Rota não encontrada no WhatsApp Router: ${req.method} ${req.url}` 
  });
});

export default router;

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

router.post("/send-scheduled*", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { id, type } = req.body;
  
  console.log(`[WhatsApp Router] Handling /send-scheduled: user=${userId}, id=${id}, type=${type}, url=${req.url}`);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const table = type === 'status' ? "scheduled_status" : "scheduled_messages";
    const { data: item, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !item) throw new Error("Agendamento não encontrado");

    let jid = "";
    if (type === 'status') {
      jid = "status@broadcast";
    } else {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("phone")
        .eq("id", item.contact_id)
        .single();
      if (!contact?.phone) throw new Error("Contato sem telefone");
      jid = `${contact.phone}@s.whatsapp.net`;
    }

    console.log(`[WhatsApp Router] Sending scheduled content to ${jid}`);

    await whatsappManager.sendMessage(
      userId,
      jid,
      type === 'status' ? item.caption : item.message,
      item.media_url,
      item.media_type,
      undefined,
      item.media_mimetype,
      item.media_filename
    );

    await supabaseAdmin
      .from(table)
      .update({ status: "sent" })
      .eq("id", id);

    res.json({ success: true });
  } catch (err: any) {
    console.error(`[WhatsApp Router] Error in /send-scheduled:`, err.message);
    res.status(500).json({ success: false, error: err.message });
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

router.post("/status", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { mediaUrl, mediaType, text } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!mediaUrl || !mediaType) return res.status(400).json({ error: "Mídia é obrigatória para Status" });

  try {
    const result = await whatsappManager.sendMessage(userId, "status@broadcast", text || "", mediaUrl, mediaType);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
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
    });
  } catch (error) {
    console.error(`[WhatsApp Status] Error for user ${userId}:`, error);
    res.status(500).json({ success: false, error: "Internal server error" });
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
  let { jid, text, to, mediaUrl, mediaType, duration } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const plan = await getPlan(userId);
  if (!plan) return res.status(403).json({ success: false, error: "Plan not found" });

  // Handle both 'jid' and 'to' for backward compatibility
  if (!jid && to) jid = to;

  if (!jid || (!text && !mediaUrl)) {
    return res.status(400).json({ success: false, error: "jid and (text or mediaUrl) are required" });
  }

  // Enforce max messages per day
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("messages_used")
    .eq("user_id", userId)
    .single();

  const currentUsed = sub?.messages_used || 0;
  const maxMessages = plan.max_messages_per_day || 150;

  if (currentUsed >= maxMessages) {
    return res.status(403).json({ 
      success: false, 
      error: `Limite de mensagens atingido. Seu plano permite ${maxMessages} mensagens por dia.` 
    });
  }

  // Ensure jid is correctly formatted for WhatsApp
  if (!jid.includes("@")) {
    jid = `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
  }

  try {
    const result = await whatsappManager.sendMessage(userId, jid, text || "", mediaUrl, mediaType, duration);
    
    // Increment usage
    await supabaseAdmin
      .from("subscriptions")
      .update({ messages_used: currentUsed + 1 })
      .eq("user_id", userId);

    res.json({ success: true, result });
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

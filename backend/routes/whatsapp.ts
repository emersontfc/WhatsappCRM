import express from "express";
import { whatsappManager } from "../whatsappManager";
import { AuthRequest } from "../middleware/auth";
import { getPlan } from "../lib/plan";
import { supabaseAdmin } from "../supabaseAdmin";

const router = express.Router();

// Debug middleware for this router
router.use((req, res, next) => {
  console.log(`[WhatsApp Router] ${req.method} ${req.url}`);
  next();
});

router.post("/connect", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { phoneNumber } = req.body;
  
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const plan = await getPlan(userId);
  if (!plan) return res.status(403).json({ success: false, error: "Plan not found" });

  try {
    await whatsappManager.deleteSession(userId);
    await whatsappManager.createSession(userId, phoneNumber);
    const session = whatsappManager.getSession(userId);
    res.json({ success: true, status: session?.status || "connecting" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/qr", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const session = whatsappManager.getSession(userId);
    if (!session) {
      console.log(`[WhatsApp QR] No session found for user: ${userId}`);
      return res.json({ success: true, status: "disconnected" });
    }

    console.log(`[WhatsApp QR] Returning QR for user: ${userId}, status: ${session.status}, hasQR: ${!!session.qr}`);

    res.json({
      success: true,
      qr: session.qr,
      status: session.status,
      pairingCode: session.pairingCode
    });
  } catch (error) {
    console.error(`[WhatsApp QR] Error for user ${userId}:`, error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/status", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  console.log(`[WhatsApp Status] Checking status for user: ${userId}`);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const session = whatsappManager.getSession(userId);
  const status = session?.status || "disconnected";

  res.json({
    success: true,
    status,
    connected: status === "connected"
  });
});

router.post("/reset", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await whatsappManager.deleteSession(userId);
    await whatsappManager.createSession(userId);
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
  let { jid, text, to, mediaUrl, mediaType } = req.body;
  
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
    const result = await whatsappManager.sendMessage(userId, jid, text || "", mediaUrl, mediaType);
    
    // Increment usage
    await supabaseAdmin
      .from("subscriptions")
      .update({ messages_used: currentUsed + 1 })
      .eq("user_id", userId);

    res.json({ success: true, result });
  } catch (err: any) {
    console.error("Failed to send message:", err);
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
    await whatsappManager.sendMessage(userId, jid, "🚀 Teste de conexão WhatsCRM bem-sucedido! Seu bot está pronto para automatizar.");
    res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to send test message:", err);
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

// Catch-all for unmatched WhatsApp routes to help debug 404s
router.use((req, res) => {
  console.warn(`[WhatsApp Route Not Found] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false, 
    error: `Rota não encontrada: ${req.method} ${req.originalUrl}` 
  });
});

export default router;

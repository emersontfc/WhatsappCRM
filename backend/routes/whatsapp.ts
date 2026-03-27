import express from "express";
import { whatsappManager } from "../whatsappManager";
import { AuthRequest } from "../middleware/auth";

const router = express.Router();

router.post("/connect", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { phoneNumber } = req.body;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    await whatsappManager.createSession(userId, phoneNumber);
    
    // Wait for QR or Pairing Code
    let session = whatsappManager.getSession(userId);
    let attempts = 0;
    while (attempts < 10 && session?.status === "connecting" && !session?.qr && !session?.pairingCode) {
      await new Promise(resolve => setTimeout(resolve, 500));
      session = whatsappManager.getSession(userId);
      attempts++;
    }
    
    res.json({ 
      success: true,
      status: session?.status || "connecting", 
      qr: session?.qr,
      pairingCode: session?.pairingCode
    });
  } catch (err: any) {
    console.error("Failed to connect WhatsApp:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

import fs from "fs";
import path from "path";

router.get("/status", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const session = whatsappManager.getSession(userId);
  let status = session?.status || "disconnected";

  // Check if session is paused
  if (status === "disconnected") {
    const pausedFile = path.join(process.cwd(), "sessions", userId as string, "paused.txt");
    if (fs.existsSync(pausedFile)) {
      status = "paused";
    }
  }

  res.json({ 
    success: true,
    status, 
    qr: session?.qr,
    pairingCode: session?.pairingCode,
    me: whatsappManager.getMe(userId as string)
  });
});

router.get("/me", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const me = whatsappManager.getMe(userId);
  res.json({ success: true, me });
});

router.post("/send", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  let { jid, text, to } = req.body;
  
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  // Handle both 'jid' and 'to' for backward compatibility
  if (!jid && to) jid = to;

  if (!jid || !text) {
    return res.status(400).json({ success: false, error: "jid and text are required" });
  }

  // Ensure jid is correctly formatted for WhatsApp
  if (!jid.includes("@")) {
    jid = `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
  }

  try {
    const result = await whatsappManager.sendMessage(userId, jid, text);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error("Failed to send message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/test", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

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

router.post("/reset", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const result = await whatsappManager.resetSession(userId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("Failed to reset WhatsApp:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/pause", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const result = await whatsappManager.pauseSession(userId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("Failed to pause WhatsApp:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

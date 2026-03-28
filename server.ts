import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";

import whatsappRoutes from "./backend/routes/whatsapp";
import aiRoutes from "./backend/routes/ai";
import adminRoutes from "./backend/routes/admin";
import authRoutes from "./backend/routes/auth";
import agentRoutes from "./backend/routes/agent";

import { startScheduler } from "./backend/scheduler";
import { authenticate } from "./backend/middleware/auth";

import { whatsappManager } from "./backend/whatsappManager";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // ================================
  // 🔐 ROTAS DA API
  // ================================

  app.use("/api/auth", authRoutes);

  app.use("/api/whatsapp", authenticate, whatsappRoutes);
  app.use("/api/ai", authenticate, aiRoutes);
  app.use("/api/admin", authenticate, adminRoutes);
  app.use("/api/agent", authenticate, agentRoutes);

  // ================================
  // ⏱ BACKGROUND TASKS
  // ================================
  startScheduler();

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ================================
  // ⚙️ VITE DEV MODE
  // ================================
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware integrated.");
    } catch (err) {
      console.error("Failed to initialize Vite server:", err);
    }
  }

  // ================================
  // 🌐 ROOT
  // ================================
  app.get("/", (req, res) => {
    res.send("API NO TOLETO 🚀");
  });

  // ================================
  // 🔥 SESSÕES WHATSAPP (CORE DO SISTEMA)
  // ================================

  /**
   * 📌 CRIAR SESSÃO
   * 👉 Inicializa uma nova sessão WhatsApp para um usuário
   * 👉 Dispara geração de QR internamente
   */
  app.get("/connect/:userId", async (req, res) => {
    const { userId } = req.params;

    try {
      console.log("🟡 Criando sessão para:", userId);

      await whatsappManager.createSession(userId);

      res.json({
        success: true,
        message: "Sessão iniciada. Aguarde o QR...",
      });
    } catch (err) {
      console.error("❌ Erro ao criar sessão:", err);

      res.status(500).json({
        error: "Erro ao criar sessão",
      });
    }
  });

  /**
   * 📌 OBTER QR CODE
   * 👉 Retorna o QR gerado para aquela sessão
   */
  app.get("/qr/:userId", (req, res) => {
    const { userId } = req.params;

    const session = whatsappManager.sessions.get(userId);

    // 🔍 DEBUG (importante)
    console.log("🔎 Buscando QR para:", userId);
    console.log("📦 Sessão encontrada:", !!session);

    if (!session || !session.qr) {
      return res.status(404).json({
        error: "QR não disponível",
      });
    }

    res.json({
      qr: session.qr,
    });
  });

  /**
   * 📌 DEBUG DE SESSÕES
   * 👉 Mostra todas sessões ativas
   */
  app.get("/sessions", (req, res) => {
    const allSessions = Array.from(whatsappManager.sessions.keys());

    res.json({
      total: allSessions.length,
      sessions: allSessions,
    });
  });

  // ================================
  // 🚀 START SERVER
  // ================================
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);

    // 🔁 Reconectar sessões existentes
    try {
      await whatsappManager.reconnectAllSessions();
      console.log("♻️ Sessões reconectadas");
    } catch (err) {
      console.error("❌ Failed to reconnect sessions:", err);
    }
  });
}

startServer().catch((err) => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});

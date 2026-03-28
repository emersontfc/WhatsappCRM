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

  // API Routes
  app.use("/api/auth", authRoutes);
  
  // Protected Routes
  app.use("/api/whatsapp", authenticate, (req, res, next) => {
    console.log(`WhatsApp API hit: ${req.method} ${req.url}`);
    next();
  }, whatsappRoutes);
  
  app.use("/api/ai", authenticate, (req, res, next) => {
    console.log(`AI API hit: ${req.method} ${req.url}`);
    next();
  }, aiRoutes);

  app.use("/api/admin", authenticate, (req, res, next) => {
    console.log(`Admin API hit: ${req.method} ${req.url}`);
    next();
  }, adminRoutes);

  app.use("/api/agent", authenticate, agentRoutes);

  // Start background tasks
  startScheduler();

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Vite middleware for development
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
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Reconnect existing WhatsApp sessions
    try {
      await whatsappManager.reconnectAllSessions();
    } catch (err) {
      console.error("Failed to reconnect WhatsApp sessions:", err);
    }
  });
}

startServer().catch((err) => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});

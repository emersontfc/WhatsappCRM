import { voiceUploadOwner } from "./shared/voiceAudio.ts";
import "./backend/loadEnv.ts";
import express from "express";
import { randomUUID } from "node:crypto";
import { publicConfig } from "./shared/publicConfig.ts";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import whatsappRoutes from "./backend/routes/whatsapp.ts";
import contactRoutes from "./backend/routes/contacts.ts";
import leadRoutes from "./backend/routes/leads.ts";
import aiRoutes from "./backend/routes/ai.ts";
import adminRoutes from "./backend/routes/admin.ts";
import authRoutes from "./backend/routes/auth.ts";
import agentRoutes from "./backend/routes/agent.ts";
import templateRoutes from "./backend/routes/templates.ts";
import packRoutes from "./backend/routes/packs.ts";
import mediaRoutes from "./backend/routes/media.ts";
import menuRoutes from "./backend/routes/menus.ts";
import appointmentRoutes from "./backend/routes/appointments.ts";
import scheduleRoutes from "./backend/routes/schedule.ts";
import groupProofRoutes, { downloadGroupProofAttachment } from "./backend/routes/groupProofs.ts";
import commerceRoutes from "./backend/routes/commerce.ts";
import catalogCampaignRoutes from "./backend/routes/catalogCampaigns.ts";
import v2CommerceRoutes from "./backend/routes/v2Commerce.ts";
import companyRoutes from "./backend/routes/company.ts";
import { startScheduler } from "./backend/scheduler.ts";
import { authenticate } from "./backend/middleware/auth.ts";
import fs from "fs";

import { whatsappManager } from "./backend/whatsappManager.ts";
import { supabaseAdmin, supabaseAdminConfigured } from "./backend/supabaseAdmin.ts";
import { registerOperations } from "./backend/routes/operations.ts";
import { frontendProblem } from "./backend/services/releaseReadiness.ts";
import { startDigitalDeliveryWorker, type DeliveryWorkerState } from "./backend/services/digitalDeliveryWorker.ts";

async function startServer() {
  console.log("[Startup] Starting server...");
  console.log("[Startup] NODE_ENV:", process.env.NODE_ENV);
  console.log("[Startup] PORT:", process.env.PORT);
  
  const app = express();
  const PORT = process.env.PORT || 3000;
  const lifecycle = new AbortController();
  const runtimeEnv = publicConfig(process.env);
  const release = /^[0-9a-f]{7,40}$/.test(process.env.AGENTX_RELEASE ?? "") ? process.env.AGENTX_RELEASE! : null;
  const schedulerEnabled = supabaseAdminConfigured && process.env.DISABLE_SCHEDULER !== "true";
  const deliveryEnabled = supabaseAdminConfigured && process.env.DISABLE_DIGITAL_DELIVERY_WORKER !== "true";
  let delivery: ReturnType<typeof startDigitalDeliveryWorker> | undefined;
  const deliveryState: DeliveryWorkerState = deliveryEnabled ? "starting" : "disabled";

  // Trust reverse proxy (Nginx, Traefik, Docker, Cloudflare)
  app.set("trust proxy", 1);

  app.use(cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["X-Request-Id"]
  }));
  app.use("/api", (req, res, next) => {
    const requestId = randomUUID();
    res.set("X-Request-Id", requestId);
    if (req.path !== "/ready") res.once("finish", () => {
      if (res.statusCode >= 500) console.warn("[API] Request failed", { requestId, method: req.method, status: res.statusCode });
    });
    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      message: "API is working 🚀",
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV
    });
  });

  // Global Request Logger (Simplified for production)
  app.use((req, res, next) => {
    if (req.url.startsWith("/api") && process.env.NODE_ENV !== "production") {
      console.log(`[API Request] ${req.method} ${req.url}`);
    }
    next();
  });

  const { checkCore } = registerOperations(app, {
    databaseConfigured: supabaseAdminConfigured,
    frontendReady: () => process.env.NODE_ENV !== "production" ||
      frontendProblem(process.env, path.join(process.cwd(), "dist", "index.html")) === null,
    release,
    schedulerEnabled,
    whatsappStatus: (userId) => whatsappManager.getSession(userId)?.status,
    deliveryStatus: () => delivery?.status() ?? { state: deliveryState, lastSuccessAt: null }
  });

  // API Routes
  app.use("/api/whatsapp/groups/:jid/payment-proofs", authenticate, groupProofRoutes);
  app.use("/api/whatsapp", authenticate, whatsappRoutes);
  app.use("/api/contacts", authenticate, contactRoutes);
  app.use("/api/leads", authenticate, leadRoutes);
  app.use("/api/auth", authRoutes);
  
  // Public Plans Route
  app.get("/api/plans", async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Database not connected");
      const { data, error } = await supabaseAdmin
        .from("plans")
        .select("*")
        .order("price", { ascending: true });
        
      if (error) throw error;
      res.json({ success: true, data });
    } catch (err: any) {
      console.error("Failed to fetch plans:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  // Protected Routes
  app.use("/api/ai", authenticate, aiRoutes);
  app.use("/api/admin", authenticate, adminRoutes);
  app.use("/api/agent", authenticate, agentRoutes);
  app.use("/api/templates", authenticate, templateRoutes);
  app.use("/api/packs", authenticate, packRoutes);
  app.use("/api/media", authenticate, mediaRoutes);
  app.use("/api/menus", authenticate, menuRoutes);
  app.use("/api/appointments", appointmentRoutes);
  app.use("/api/schedule", authenticate, scheduleRoutes);
  app.get("/api/commerce/verifications/:id/attachment", authenticate, downloadGroupProofAttachment);
  app.use("/api/commerce", authenticate, commerceRoutes);
  app.use("/api/catalog-campaigns", authenticate, catalogCampaignRoutes);
  app.use("/api/v2/commerce", authenticate, v2CommerceRoutes);
  app.use("/api/company", authenticate, companyRoutes);

  // Secure uploads access with strict Path Traversal sanitization
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.get("/uploads/:filename", (req, res) => {
    const rawFilename = req.params.filename;
    // Strict basename extraction to completely block path traversal attacks
    const safeFilename = path.basename(rawFilename);
    if (voiceUploadOwner(safeFilename)) {
      return res.status(404).json({ success: false, error: "Ficheiro indisponível." });
    }
    const filePath = path.join(uploadsDir, safeFilename);

    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "Arquivo não encontrado." });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(filePath);
  });

  // Ensure whatsapp_sessions_data directory exists
  const sessionsDir = path.join(process.cwd(), "whatsapp_sessions_data");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  app.all(["/api", "/api/*"], (_req, res) => {
    res.status(404).json({ success: false, error: "Rota da API indisponível." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { 
          middlewareMode: true,
          watch: {
            ignored: [
              '**/whatsapp_sessions_data/**',
              '**/uploads/**',
              '**/scratch/**',
              '**/*.log',
              '**/*.json',
              '**/.gemini/**'
            ]
          }
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware integrated.");
    } catch (err) {
      console.error("Failed to initialize Vite server:", err);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    console.log("[Startup] Serving static files from:", distPath);
    
    // Helper to serve index.html with runtime window.__ENV__ dynamically injected
    const sendInjectedHtml = (res: express.Response) => {
      const indexPath = path.join(distPath, "index.html");
      if (!fs.existsSync(indexPath)) {
        console.error("[Static] index.html not found at:", indexPath);
        return res.status(404).send("Frontend build not found. Please run 'npm run build'.");
      }
      
      try {
        let html = fs.readFileSync(indexPath, "utf-8");
        const envJson = JSON.stringify(runtimeEnv).replace(/</g, "\\u003c");
        const envScript = `<script>window.__ENV__ = ${envJson};</script>`;
        if (html.includes("<head>")) {
          html = html.replace("<head>", `<head>\n    ${envScript}`);
        } else {
          html = `${envScript}\n${html}`;
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(html);
      } catch (err) {
        console.error("[Static] Error reading/injecting index.html:", err);
        res.sendFile(indexPath);
      }
    };

    // Root path handler
    app.get("/", (req, res) => sendInjectedHtml(res));

    // Serve static files (assets, css, js) without overriding root index.html
    app.use(express.static(distPath, { index: false }));
    
    // Fallback route for SPA client-side routing
    app.get("*", (req, res) => sendInjectedHtml(res));
  }

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error handler caught:", err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  });

  // Global Process Error Handlers
  process.on("unhandledRejection", (reason, promise) => {
    console.error("CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
  });

  process.on("uncaughtException", (err: any) => {
    if (err.code === 'EPIPE') return;
    console.error("CRITICAL: Uncaught Exception:", err);
  });

  let scheduler: ReturnType<typeof startScheduler> | undefined;
  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    const address = server.address();
    console.log(`[Startup] Server listening on port ${typeof address === "object" ? address?.port : PORT}`);
    if (supabaseAdminConfigured) {
      void checkCore().then(({ crm, sales }) => {
        if (crm === "migration_required" || sales === "migration_required") {
          console.warn("[Startup] Esquema Supabase por atualizar.", { crm, sales });
          console.warn("[Startup] Para uma instalação existente, aplica as migrações indicadas em DEPLOY_VPS.md. Para um projeto Supabase vazio, usa migrations/install_agentx_fresh.sql.");
        } else if (crm !== "ready" || sales !== "ready") {
          console.warn("[Startup] O Supabase está indisponível. Verifica a ligação e as credenciais do servidor.");
        }
      });
    }
    if (schedulerEnabled) scheduler = startScheduler();
    if (deliveryEnabled) {
      delivery = startDigitalDeliveryWorker(lifecycle.signal);
      void delivery.completion.catch((error) => console.error("[Digital delivery] Worker stopped:", error));
    }
    
    // Reconnect existing WhatsApp sessions in background
    if (supabaseAdminConfigured && process.env.DISABLE_WHATSAPP_RECONNECT !== "true") {
      whatsappManager.reconnectAllSessions().catch(err => {
        console.error("Failed to start session reconnection process:", err);
      });
    }
  });

  // Graceful shutdown handling for Docker, PM2 and VPS process managers
  let isShuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    lifecycle.abort();
    scheduler?.stop();
    console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);

    try {
      whatsappManager.closeAllSessions();
    } catch (e) {
      console.error("[Shutdown] Error while closing WhatsApp sessions:", e);
    }

    server.close(() => {
      console.log("[Shutdown] HTTP server closed cleanly.");
      process.exit(0);
    });

    // Timeout safety fallback
    setTimeout(() => {
      console.warn("[Shutdown] Forcefully terminating process after timeout.");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});

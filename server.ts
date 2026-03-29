import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import whatsappRoutes from "./backend/routes/whatsapp";
import aiRoutes from "./backend/routes/ai";
import adminRoutes from "./backend/routes/admin";
import authRoutes from "./backend/routes/auth";
import agentRoutes from "./backend/routes/agent";
import templateRoutes from "./backend/routes/templates";
import packRoutes from "./backend/routes/packs";
import mediaRoutes from "./backend/routes/media";
import logsRoutes from "./backend/routes/logs";
import { startScheduler } from "./backend/scheduler";
import { authenticate } from "./backend/middleware/auth";
import fs from "fs";

import { whatsappManager } from "./backend/whatsappManager";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Global Request Logger
  app.use((req, res, next) => {
    if (req.url.startsWith("/api")) {
      console.log(`[API Request] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
    }
    next();
  });

  app.get("/api/debug/auth", (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "NOT_SET";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "NOT_SET";
    
    res.json({
      success: true,
      supabaseUrl: supabaseUrl === "NOT_SET" ? "NOT_SET" : supabaseUrl.substring(0, 15) + "...",
      hasServiceRoleKey: serviceRoleKey !== "NOT_SET" && serviceRoleKey.length > 50,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  // API Routes
  app.use("/api/whatsapp", (req, res, next) => {
    console.log(`[WhatsApp Route Attempt] ${req.method} ${req.url}`);
    next();
  }, authenticate, whatsappRoutes);

  app.use("/api/auth", authRoutes);
  
  // Public Plans Route (Duplicated from auth for convenience)
  app.get("/api/plans", async (req, res) => {
    try {
      const { data, error } = await (await import("./backend/supabaseAdmin")).supabaseAdmin
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
  app.use("/api/logs", authenticate, logsRoutes);

  // Serve uploads directory
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  // Catch-all for unmatched API routes
  app.all("/api/*", (req, res) => {
    console.warn(`[API Route Not Found] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      success: false, 
      error: `API route not found: ${req.method} ${req.originalUrl}` 
    });
  });

  // Start background tasks
  startScheduler();

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
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

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { logError } = require("./backend/lib/logger");
    logError(`Global error handler caught: ${err.message}`, err, {
      userId: (req as any).user?.id,
      category: "system",
      details: {
        path: req.path,
        method: req.method,
        query: req.query,
        ip: req.ip
      }
    }).catch(console.error);

    console.error("Global error handler caught:", err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Erro interno do servidor",
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack
    });
  });

  // Global Process Error Handlers
  process.on("unhandledRejection", (reason, promise) => {
    const { logError } = require("./backend/lib/logger");
    logError(`Unhandled Rejection: ${String(reason)}`, reason, {
      category: "system",
      details: { promise }
    }).catch(console.error);
    
    console.error("CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
  });

  process.on("uncaughtException", (err) => {
    const { logError } = require("./backend/lib/logger");
    // We use a sync log here if possible, but our logger is async.
    // In a real app, we might want to use a sync logger for uncaughtException.
    logError(`Uncaught Exception: ${err.message}`, err, {
      category: "system"
    }).then(() => {
      console.error("CRITICAL: Uncaught Exception:", err);
      // process.exit(1);
    }).catch(console.error);
  });

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Startup] SUPABASE_URL present: ${!!process.env.SUPABASE_URL}`);
    console.log(`[Startup] VITE_SUPABASE_URL present: ${!!process.env.VITE_SUPABASE_URL}`);
    console.log(`[Startup] SUPABASE_SERVICE_ROLE_KEY present: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    console.log(`[Startup] SUPABASE_SERVICE_KEY present: ${!!process.env.SUPABASE_SERVICE_KEY}`);
    
    // Reconnect existing WhatsApp sessions in background
    whatsappManager.reconnectAllSessions().catch(err => {
      console.error("Failed to start session reconnection process:", err);
    });
  });
}

startServer().catch((err) => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});

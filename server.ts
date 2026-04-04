import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
import whatsappRoutes from "./backend/routes/whatsapp.ts";
import aiRoutes from "./backend/routes/ai.ts";
import adminRoutes from "./backend/routes/admin.ts";
import authRoutes from "./backend/routes/auth.ts";
import agentRoutes from "./backend/routes/agent.ts";
import templateRoutes from "./backend/routes/templates.ts";
import packRoutes from "./backend/routes/packs.ts";
import mediaRoutes from "./backend/routes/media.ts";
import menuRoutes from "./backend/routes/menus.ts";
import { startScheduler } from "./backend/scheduler.ts";
import { authenticate } from "./backend/middleware/auth.ts";
import fs from "fs";

import { whatsappManager } from "./backend/whatsappManager.ts";
import { supabaseAdmin } from "./backend/supabaseAdmin.ts";

async function initDatabase() {
  try {
    console.log("[Database] Initializing tables...");
    const sql = `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Plans table
      CREATE TABLE IF NOT EXISTS plans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        price NUMERIC NOT NULL,
        duration_days INTEGER NOT NULL,
        max_messages_per_day INTEGER NOT NULL,
        ai_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Insert default plans if none exist
      INSERT INTO plans (name, price, duration_days, max_messages_per_day, ai_enabled)
      SELECT 'Free', 0, 30, 50, false
      WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Free');

      INSERT INTO plans (name, price, duration_days, max_messages_per_day, ai_enabled)
      SELECT 'Premium', 99, 30, 5000, true
      WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Premium');

      -- Users table (profiles)
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        plan TEXT DEFAULT 'Free',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Subscriptions table
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        plan_id UUID REFERENCES plans(id),
        status TEXT DEFAULT 'active',
        messages_used INTEGER DEFAULT 0,
        start_date TIMESTAMPTZ DEFAULT NOW(),
        end_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Contacts table
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, phone)
      );

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL, -- 'inbound' or 'outbound'
        msg_id TEXT,
        is_automated BOOLEAN DEFAULT FALSE,
        automation_id UUID,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );

      -- Automations table
      CREATE TABLE IF NOT EXISTS automations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL, -- 'keyword'
        keyword TEXT,
        response TEXT NOT NULL,
        response_type TEXT DEFAULT 'text', -- 'text', 'menu', 'audio'
        media_url TEXT,
        media_type TEXT,
        delay INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Scheduled messages table
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        media_url TEXT,
        media_type TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Group rules table
      CREATE TABLE IF NOT EXISTS group_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        group_jid TEXT NOT NULL,
        anti_link BOOLEAN DEFAULT FALSE,
        anti_spam BOOLEAN DEFAULT FALSE,
        anti_flood BOOLEAN DEFAULT FALSE,
        anti_delete BOOLEAN DEFAULT FALSE,
        welcome_msg TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, group_jid)
      );

      -- Smart menus table
      CREATE TABLE IF NOT EXISTS smart_menus (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        footer TEXT,
        options JSONB NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- WhatsApp sessions table
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        session_data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Agents table
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT,
        api_key TEXT,
        api_url TEXT,
        instructions TEXT,
        is_active BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Add smart_menu_id to automations if it doesn't exist
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='automations' AND column_name='smart_menu_id') THEN
          ALTER TABLE automations ADD COLUMN smart_menu_id UUID REFERENCES smart_menus(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // Try to check if table exists first
    const { error: checkError } = await supabaseAdmin.from('plans').select('id').limit(1);
    const { error: agentsCheckError } = await supabaseAdmin.from('agents').select('id').limit(1);
    
    const plansMissing = checkError && (checkError.code === 'PGRST116' || checkError.message.includes('does not exist'));
    const agentsMissing = agentsCheckError && (agentsCheckError.code === 'PGRST116' || agentsCheckError.message.includes('does not exist'));

    if (plansMissing || agentsMissing) {
      console.log(`[Database] Missing required tables. Attempting to create...`);
      const { error: createError } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });
      
      if (createError) {
        console.warn("[Database] Could not run automatic migration via exec_sql RPC.");
        console.warn("[Database] PLEASE RUN THIS SQL IN SUPABASE SQL EDITOR TO FIX DATABASE:");
        console.warn(sql);
      } else {
        console.log("[Database] Database tables created/updated successfully.");
      }
    } else {
      console.log("[Database] All required database tables already exist.");
    }
  } catch (err) {
    console.error("[Database] Initialization error:", err);
  }
}

async function startServer() {
  console.log("[Startup] Starting server...");
  console.log("[Startup] NODE_ENV:", process.env.NODE_ENV);
  console.log("[Startup] PORT:", process.env.PORT);
  
  if (supabaseAdmin) {
    await initDatabase();
  } else {
    console.warn("[Startup] Skipping database initialization because Supabase Admin is not available.");
  }

  const app = express();
  const PORT = process.env.PORT || 10000;

  app.use(cors());
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

  app.get("/api/debug/db", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('agents').select('id').limit(1);
      res.json({ success: true, data, error });
    } catch (err: any) {
      res.json({ success: false, error: err.message });
    }
  });

  // API Routes
  app.use("/api/whatsapp", authenticate, whatsappRoutes);
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

  // Serve uploads directory
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  // Catch-all for unmatched API routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ 
      success: false, 
      error: `API route not found: ${req.method} ${req.originalUrl}` 
    });
  });

  // Disable problematic background tasks for now if requested
  if (process.env.DISABLE_SCHEDULER !== "true") {
    try {
      startScheduler();
    } catch (err) {
      console.error("Failed to start scheduler:", err);
    }
  }

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
    console.log("[Startup] Serving static files from:", distPath);
    
    // Serve static files from dist
    app.use(express.static(distPath));
    
    // Fallback route for SPA
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error("[Static] index.html not found at:", indexPath);
        res.status(404).send("Frontend build not found. Please run 'npm run build'.");
      }
    });
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

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`[Startup] Server listening on port ${PORT}`);
    
    // Reconnect existing WhatsApp sessions in background
    if (process.env.DISABLE_WHATSAPP_RECONNECT !== "true") {
      whatsappManager.reconnectAllSessions().catch(err => {
        console.error("Failed to start session reconnection process:", err);
      });
    }
  });
}

startServer().catch((err) => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});

import express from "express";
import { authenticate } from "../middleware/auth";
import { logEvent, LogLevel, LogSource, LogCategory } from "../lib/logger";

const router = express.Router();

/**
 * Endpoint for frontend to send logs.
 * Authenticated users only.
 */
router.post("/frontend", authenticate, async (req, res) => {
  const { 
    message, 
    level = LogLevel.INFO, 
    category = LogCategory.SYSTEM, 
    details = {} 
  } = req.body;
  const userId = (req as any).user?.id;

  if (!message) {
    return res.status(400).json({ success: false, error: "Message is required" });
  }

  try {
    await logEvent(message, {
      userId,
      level: level as LogLevel,
      source: LogSource.FRONTEND,
      category: category as LogCategory,
      details: {
        ...details,
        url: req.headers.referer || "unknown",
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error("[Logs API] Error processing frontend log:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * Admin endpoint to fetch logs.
 */
router.get("/admin", authenticate, async (req, res) => {
  const userRole = (req as any).user?.role;
  if (userRole !== "admin") {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }

  const { 
    level, 
    category, 
    source, 
    limit = 50, 
    offset = 0,
    search
  } = req.query;

  try {
    const { supabaseAdmin } = require("../supabaseAdmin");
    let query = supabaseAdmin
      .from("logs")
      .select("*, users(email, name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (level) query = query.eq("level", level);
    if (category) query = query.eq("category", category);
    if (source) query = query.eq("source", source);
    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({ 
      success: true, 
      data, 
      total: count,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (err: any) {
    console.error("[Logs API] Error fetching logs:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;

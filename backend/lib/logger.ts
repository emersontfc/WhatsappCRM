import { supabaseAdmin } from "../supabaseAdmin";

export enum LogLevel {
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  DEBUG = "debug"
}

export enum LogSource {
  BACKEND = "backend",
  FRONTEND = "frontend",
  WORKER = "worker"
}

export enum LogCategory {
  AUTH = "auth",
  SUBSCRIPTION = "subscription",
  WHATSAPP = "whatsapp",
  AI = "ai",
  SYSTEM = "system",
  DATABASE = "database"
}

interface LogOptions {
  userId?: string;
  level?: LogLevel;
  source?: LogSource;
  category?: LogCategory;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Logs an event to the database.
 * Designed to be safe and non-blocking (doesn't throw if logging fails).
 */
export async function logEvent(message: string, options: LogOptions = {}) {
  const {
    userId = null,
    level = LogLevel.INFO,
    source = LogSource.BACKEND,
    category = LogCategory.SYSTEM,
    details = {},
    ipAddress = null,
    userAgent = null
  } = options;

  try {
    // Console log for immediate visibility in server logs
    const logMsg = `[${level.toUpperCase()}] [${category.toUpperCase()}] ${message}`;
    if (level === LogLevel.ERROR) {
      console.error(logMsg, details);
    } else if (level === LogLevel.WARN) {
      console.warn(logMsg, details);
    } else {
      console.log(logMsg);
    }

    // Insert into Supabase
    const { error } = await supabaseAdmin
      .from("logs")
      .insert({
        user_id: userId,
        level,
        source,
        category,
        message,
        details,
        ip_address: ipAddress,
        user_agent: userAgent
      });

    if (error) {
      console.error("[Logger] Failed to save log to database:", error);
    }
  } catch (err) {
    // Never crash the app due to logging failure
    console.error("[Logger] Critical failure in logging system:", err);
  }
}

/**
 * Convenience method for error logging
 */
export async function logError(message: string, error: any, options: Omit<LogOptions, 'level'> = {}) {
  return logEvent(message, {
    ...options,
    level: LogLevel.ERROR,
    details: {
      ...(options.details || {}),
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
      errorName: error?.name || "Error"
    }
  });
}

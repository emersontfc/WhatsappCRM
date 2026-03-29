import { apiFetch } from "./api";

export enum LogLevel {
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  DEBUG = "debug"
}

export enum LogCategory {
  AUTH = "auth",
  SUBSCRIPTION = "subscription",
  WHATSAPP = "whatsapp",
  AI = "ai",
  SYSTEM = "system",
  UI = "ui"
}

interface LogOptions {
  level?: LogLevel;
  category?: LogCategory;
  details?: any;
}

/**
 * Sends a log to the backend.
 * Designed to be safe and non-blocking.
 */
export async function logEvent(message: string, options: LogOptions = {}) {
  const {
    level = LogLevel.INFO,
    category = LogCategory.SYSTEM,
    details = {}
  } = options;

  // Console log for local visibility
  const logMsg = `[${level.toUpperCase()}] [${category.toUpperCase()}] ${message}`;
  if (level === LogLevel.ERROR) {
    console.error(logMsg, details);
  } else if (level === LogLevel.WARN) {
    console.warn(logMsg, details);
  } else {
    console.log(logMsg);
  }

  try {
    await apiFetch("/api/logs/frontend", {
      method: "POST",
      body: JSON.stringify({
        message,
        level,
        category,
        details: {
          ...details,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      })
    });
  } catch (err) {
    // Silently fail to avoid infinite loops or UI disruption
    console.warn("[Logger] Failed to send log to backend:", err);
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

/**
 * Initializes global error handlers for the frontend
 */
export function initFrontendLogging() {
  window.onerror = (message, source, lineno, colno, error) => {
    logError(`Uncaught Window Error: ${message}`, error, {
      category: LogCategory.SYSTEM,
      details: { source, lineno, colno }
    });
    return false; // Let default handler run
  };

  window.onunhandledrejection = (event) => {
    logError(`Unhandled Promise Rejection: ${event.reason}`, event.reason, {
      category: LogCategory.SYSTEM
    });
  };
}

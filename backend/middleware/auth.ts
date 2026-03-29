import { Request, Response, NextFunction } from "express";
import { supabaseAuth } from "../supabaseAuth";
import { supabaseAdmin } from "../supabaseAdmin";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // 1. Verify token and get user using Auth client
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);

    if (error || !user) {
      console.error(`[Auth Middleware] Token verification failed:`, {
        error: error?.message || "No user found"
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    console.log("User authenticated:", user.id);

    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (err: any) {
    console.error("[Auth] Middleware error:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

export const authorizeAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", req.user.id)
      .maybeSingle();

    if (profile?.role !== "admin") {
      console.warn(`Admin access denied for user: ${req.user?.email}, role: ${profile?.role}`);
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("[Auth] Admin check error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};


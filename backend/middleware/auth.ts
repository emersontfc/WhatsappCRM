import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabaseAdmin";
import jwt from "jsonwebtoken";

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
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (err: any) {
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


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
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    
    if (jwtSecret) {
      // Fast local verification
      const decoded = jwt.verify(token, jwtSecret) as any;
      req.user = {
        id: decoded.sub,
        email: decoded.email,
      };
      return next();
    }

    // Fallback to network verification using the admin client
    // Some older versions of supabase-js ignore the token parameter in getUser()
    // So we make a direct fetch request to the Supabase Auth API
    let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
    if (supabaseUrl && !supabaseUrl.startsWith("http")) {
      supabaseUrl = `https://${supabaseUrl}.supabase.co`;
    }
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    
    console.log(`[Auth Middleware] Verifying token. URL: ${supabaseUrl}, Key starts with: ${supabaseKey.substring(0, 5)}...`);
    
    let user = null;
    let errorMsg = null;

    try {
      // Direct fetch to Supabase Auth API
      const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey
        }
      });
      
      if (!res.ok) {
        errorMsg = `Fetch failed: ${res.status} ${res.statusText}`;
      } else {
        user = await res.json();
      }
    } catch (e: any) {
      errorMsg = e.message;
    }

    if (errorMsg || !user) {
      console.error(`[Auth Middleware] Token verification failed:`, {
        error: errorMsg || "No user found",
        token: token.substring(0, 10) + "..."
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

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


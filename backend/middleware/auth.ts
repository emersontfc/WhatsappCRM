import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
    companyId?: string;
  };
}

// Token cache to prevent hitting Supabase Auth API on every request (60s TTL)
const tokenCache = new Map<string, { user: { id: string; email?: string; role?: string; companyId?: string }; expiresAt: number }>();

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  // Check cache first (valid for 60 seconds)
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.user = cached.user;
    return next();
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Retrieve role and company profile
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("role, id")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    req.user = {
      id: user.id,
      email: user.email,
      role: profile?.role || "user",
      companyId: user.id
    };

    // Cache the result for 60 seconds
    tokenCache.set(token, {
      user: req.user,
      expiresAt: Date.now() + 60000
    });

    // Clean up old cache entries periodically
    if (tokenCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of tokenCache.entries()) {
        if (value.expiresAt < now) {
          tokenCache.delete(key);
        }
      }
    }

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
    const role = req.user.role;
    if (role !== "admin" && role !== "superadmin") {
      console.warn(`Admin access denied for user: ${req.user?.email}, role: ${role}`);
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("[Auth] Admin check error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const authorizeRoles = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const userRole = req.user.role || "user";
    if (userRole === "superadmin" || allowedRoles.includes(userRole)) {
      return next();
    }

    console.warn(`Role access denied for user: ${req.user?.email}, role: ${userRole}, required: [${allowedRoles.join(", ")}]`);
    return res.status(403).json({ success: false, error: "Permissões insuficientes para esta operação." });
  };
};


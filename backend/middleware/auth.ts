import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabaseAdmin";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ success: false, error: "Invalid or expired token" });
    }

    // Fetch user role from public.users table
    let { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdminEmail = user.email === "alcindacharles@gmail.com" || user.email === "emersontorres42@gmail.com";

    if (!profile) {
      console.log(`Initializing profile for user ${user.id}`);
      const { data: newProfile, error: createError } = await supabaseAdmin
        .from("users")
        .insert({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
          role: isAdminEmail ? "admin" : "user",
          isActivated: true,
          plan: isAdminEmail ? "Premium" : "Free"
        })
        .select()
        .single();
      
      if (!createError) profile = newProfile;
    } else if (isAdminEmail && profile.role !== "admin") {
      // Force admin role for these specific emails if not already set
      console.log(`Updating role to admin for user ${user.email}`);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ role: "admin", plan: "Premium", isActivated: true })
        .eq("id", user.id)
        .select()
        .single();
      
      if (!updateError) profile = updatedProfile;
    }

    // Ensure user has a subscription
    const { data: subData } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subData) {
      console.log(`Initializing subscription for user ${user.id}`);
      const planName = isAdminEmail ? "Premium" : "Starter";
      const { data: planData } = await supabaseAdmin.from("plans").select("id").eq("name", planName).single();
      
      await supabaseAdmin.from("subscriptions").insert({
        user_id: user.id,
        plan: planName,
        plan_id: planData?.id,
        start_date: new Date().toISOString(),
        end_date: isAdminEmail ? "2099-12-31T23:59:59Z" : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
        expires_at: isAdminEmail ? "2099-12-31T23:59:59Z" : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
        status: "active",
        is_active: true
      });
    } else if (isAdminEmail && subData.plan !== "Premium") {
      // Update subscription for admin emails
      const { data: planData } = await supabaseAdmin.from("plans").select("id").eq("name", "Premium").single();
      await supabaseAdmin.from("subscriptions").update({
        plan: "Premium",
        plan_id: planData?.id,
        end_date: "2099-12-31T23:59:59Z",
        expires_at: "2099-12-31T23:59:59Z",
        status: "active",
        is_active: true
      }).eq("user_id", user.id);
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: profile?.role || (isAdminEmail ? "admin" : "user")
    };

    console.log(`User ${user.email} authenticated with role: ${req.user.role}`);

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ success: false, error: "Authentication failed" });
  }
};

export const authorizeAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  console.log(`Authorizing admin access for user: ${req.user?.email}, role: ${req.user?.role}`);
  if (req.user?.role !== "admin") {
    console.warn(`Admin access denied for user: ${req.user?.email}, role: ${req.user?.role}`);
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
};

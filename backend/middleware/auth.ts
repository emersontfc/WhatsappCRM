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
    // 1. Verify token and get user from Supabase Auth
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ success: false, error: "Invalid or expired token" });
    }

    const isAdminEmail = user.email === "alcindacharles@gmail.com" || user.email === "emersontorres42@gmail.com";

    // 2. Fetch profile and subscription in parallel to reduce latency
    const [profileResult, subResult, plansResult] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("role, plan")
        .eq("id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("plans")
        .select("*")
    ]);

    let profile = profileResult.data;
    let subData = subResult.data;
    const allPlans = plansResult.data || [];

    // Ensure "Free" plan exists in the database
    let freePlan = allPlans.find(p => p.name === "Free");
    if (!freePlan) {
      console.log("[Auth] Creating Free plan in database");
      const { data: newFreePlan } = await supabaseAdmin
        .from("plans")
        .insert({
          name: "Free",
          price: 0,
          max_connections: 1,
          max_contacts: 50,
          max_messages_per_day: 20,
          ai_enabled: false,
          automation_level: "basic"
        })
        .select()
        .single();
      freePlan = newFreePlan;
      if (freePlan) allPlans.push(freePlan);
    }

    // 3. Handle missing profile (Initialization)
    if (!profile) {
      console.log(`[Auth] Initializing profile for user ${user.id}`);
      const { data: newProfile, error: createError } = await supabaseAdmin
        .from("users")
        .insert({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
          role: isAdminEmail ? "admin" : "user",
          plan: isAdminEmail ? "Premium" : "Free"
        })
        .select()
        .maybeSingle();
      
      if (!createError) profile = newProfile;
    } else if (isAdminEmail && profile.role !== "admin") {
      // Force admin role for these specific emails if not already set
      console.log(`[Auth] Updating role to admin for user ${user.email}`);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ role: "admin", plan: "Premium" })
        .eq("id", user.id)
        .select()
        .maybeSingle();
      
      if (!updateError) profile = updatedProfile;
    }

    // 4. Check for expiration and handle downgrade
    const now = new Date();
    const isExpired = subData?.expires_at && new Date(subData.expires_at) < now;
    const shouldDowngrade = isExpired && subData.plan !== "Free" && !isAdminEmail;

    if (shouldDowngrade) {
      console.log(`[Auth] Subscription expired for user ${user.id}. Downgrading to Free.`);
      const { data: updatedSub } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan: "Free",
          plan_id: freePlan?.id,
          expires_at: null,
          status: "active",
          is_active: true
        })
        .eq("user_id", user.id)
        .select()
        .maybeSingle();
      
      if (updatedSub) subData = updatedSub;

      // Also update user profile
      await supabaseAdmin
        .from("users")
        .update({ plan: "Free" })
        .eq("id", user.id);
      
      if (profile) profile.plan = "Free";
    }

    // 5. Handle missing subscription (Initialization)
    if (!subData) {
      console.log(`[Auth] Initializing subscription for user ${user.id}`);
      const planName = isAdminEmail ? "Premium" : "Free";
      const targetPlan = allPlans.find(p => p.name === planName) || freePlan;
      
      const { data: newSub, error: subError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: user.id,
          plan: planName,
          plan_id: targetPlan?.id,
          start_date: new Date().toISOString(),
          end_date: isAdminEmail ? "2099-12-31T23:59:59Z" : null,
          expires_at: isAdminEmail ? "2099-12-31T23:59:59Z" : null,
          status: "active",
          is_active: true
        })
        .select()
        .maybeSingle();
      
      if (!subError) subData = newSub;
    } else if (isAdminEmail && subData.plan !== "Premium") {
      // Update subscription for admin emails
      console.log(`[Auth] Updating subscription to Premium for admin user ${user.email}`);
      const premiumPlan = allPlans.find(p => p.name === "Premium");
        
      await supabaseAdmin.from("subscriptions").update({
        plan: "Premium",
        plan_id: premiumPlan?.id,
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

    next();
  } catch (err) {
    console.error("[Auth] Middleware error:", err);
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

import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { supabaseAdmin } from "../supabaseAdmin";

export interface PlanConfig {
  id: string;
  name: string;
  max_connections: number;
  max_contacts: number;
  max_messages_per_day: number;
  ai_enabled: boolean;
  automation_level: string;
  price: number;
}

export interface PlanRequest extends AuthRequest {
  plan?: PlanConfig;
}

export const requirePlan = async (req: PlanRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "User not authenticated" });
  }

  try {
    // Check if user is admin, if so, give them unlimited plan
    if (req.user.role === "admin") {
      req.plan = {
        id: "admin-plan",
        name: "Admin",
        max_connections: 999,
        max_contacts: 999999,
        max_messages_per_day: 999999,
        ai_enabled: true,
        automation_level: "advanced",
        price: 0
      };
      return next();
    }

    // 1. Get active subscription
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_id, is_active, expires_at")
      .eq("user_id", req.user.id)
      .eq("is_active", true)
      .single();

    if (subError || !sub) {
      // Fallback to Free/Starter plan if no active subscription
      const { data: defaultPlan } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("name", "Starter")
        .single();
        
      if (defaultPlan) {
        req.plan = defaultPlan;
        return next();
      }
      return res.status(403).json({ success: false, error: "No active subscription found" });
    }

    // Check expiration
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
       // Expired, fallback to Starter
       const { data: defaultPlan } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("name", "Starter")
        .single();
        
      if (defaultPlan) {
        req.plan = defaultPlan;
        return next();
      }
      return res.status(403).json({ success: false, error: "Subscription expired" });
    }

    // 2. Load plan limits
    const { data: plan, error: planError } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("id", sub.plan_id)
      .single();

    if (planError || !plan) {
      return res.status(403).json({ success: false, error: "Plan not found" });
    }

    // 3. Inject into req.plan
    req.plan = plan;
    next();
  } catch (err) {
    console.error("requirePlan middleware error:", err);
    return res.status(500).json({ success: false, error: "Failed to load plan limits" });
  }
};

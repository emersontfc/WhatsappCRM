import { supabaseAdmin } from "../supabaseAdmin.ts";

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

export const getPlan = async (userId: string): Promise<PlanConfig | null> => {
  try {
    // Check if user is admin
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.role === "admin") {
      return {
        id: "admin-plan",
        name: "Admin",
        max_connections: 999,
        max_contacts: 999999,
        max_messages_per_day: 999999,
        ai_enabled: true,
        automation_level: "advanced",
        price: 0
      };
    }

    // 1. Get active subscription
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_id, status, end_date")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    // 2. Load plan limits
    if (sub && sub.plan_id && (!sub.end_date || new Date(sub.end_date) > new Date())) {
      const { data: plan } = await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", sub.plan_id)
        .maybeSingle();
      if (plan) return plan;
    }

    // Fallback to Free plan
    const { data: freePlan } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("name", "Free")
      .maybeSingle();
      
    return freePlan;
  } catch (err) {
    console.error("Error fetching plan:", err);
    return null;
  }
};

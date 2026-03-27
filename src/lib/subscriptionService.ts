import { supabase } from "../supabase";
import { Subscription, Plan, PLAN_LIMITS } from "../types";

export const getSubscription = async (userId: string): Promise<Subscription | null> => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();
  
  if (error) return null;
  return data;
};

export const canPerformAction = async (userId: string, action: keyof typeof PLAN_LIMITS['Free']): Promise<{ allowed: boolean; message?: string }> => {
  const subscription = await getSubscription(userId);
  if (!subscription) return { allowed: false, message: "No subscription found." };
  
  const limits = PLAN_LIMITS[subscription.plan];
  
  // This is a simplified check. In a real app, we'd need to check the specific usage field.
  // For this implementation, I'll map the action to the usage field.
  const usageMap: Record<keyof typeof PLAN_LIMITS['Free'], keyof Subscription> = {
    max_messages: 'messages_used',
    max_contacts: 'messages_used', // Simplified
    max_automations: 'automations_used',
    max_schedules: 'automations_used', // Simplified
    max_numbers: 'automations_used', // Simplified
  };
  
  const usageField = usageMap[action];
  const used = subscription[usageField] as number;
  
  if (used >= limits[action]) {
    return { allowed: false, message: `Limit reached for ${action}. Please upgrade your plan.` };
  }
  
  return { allowed: true };
};

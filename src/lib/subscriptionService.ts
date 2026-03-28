import { supabase } from "../supabase";
import { Subscription, Plan } from "../types";

export const getSubscription = async (userId: string): Promise<Subscription | null> => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();
  
  if (error) return null;
  return data;
};

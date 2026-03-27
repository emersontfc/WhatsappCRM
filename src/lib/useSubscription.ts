import { useState, useEffect } from "react";
import { supabase, getUserId } from "../supabase";
import { Subscription } from "../types";
import { getSubscription } from "./subscriptionService";

export const useSubscription = () => {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      const userId = await getUserId();
      if (userId) {
        const sub = await getSubscription(userId);
        setSubscription(sub);
      }
      setLoading(false);
    };
    fetchSubscription();
  }, []);

  return { subscription, loading };
};

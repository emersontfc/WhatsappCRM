import { useState, useEffect } from "react";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { getSubscription } from "./subscriptionService";

export const useActivation = () => {
  const [isActivated, setIsActivated] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkActivation = async () => {
      try {
        const userId = await getUserId();
        if (!userId || userId === "guest-user") {
          setIsActivated(false);
          setPlan(null);
          setLoading(false);
          return;
        }

        const adminStatus = await checkIsAdmin();
        if (adminStatus) {
          setIsActivated(true);
          setPlan("Admin");
          setLoading(false);
          return;
        }

        const subscription = await getSubscription(userId);
        
        if (subscription) {
          setPlan(subscription.plan);
          if (subscription.plan === 'Free') {
            setIsActivated(true);
          } else if (new Date(subscription.end_date) > new Date()) {
            setIsActivated(true);
          } else {
            setIsActivated(false);
          }
        } else {
          // Fallback to users table check if no subscription record
          const { data: userData } = await supabase
            .from("users")
            .select("isActivated, expires_at, plan")
            .eq("id", userId)
            .single();
            
          if (userData) {
            setPlan(userData.plan || "Free");
            if (userData.isActivated === true) {
              setIsActivated(true);
            } else if (userData.expires_at) {
              setIsActivated(new Date(userData.expires_at) > new Date());
            } else {
              setIsActivated(false);
            }
          } else {
            setIsActivated(false);
            setPlan(null);
          }
        }
      } catch (err) {
        console.error("Error checking activation:", err);
        setIsActivated(false);
        setPlan(null);
      } finally {
        setLoading(false);
      }
    };
    checkActivation();
  }, []);

  return { isActivated, plan, loading };
};

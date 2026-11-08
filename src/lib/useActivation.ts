import { useState, useEffect } from "react";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { getSubscription } from "./subscriptionService";

export const useActivation = () => {
  const [isActivated, setIsActivated] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [planDetails, setPlanDetails] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkActivation = async () => {
      try {
        const userId = await getUserId();
        if (!userId || userId === "guest-user") {
          setIsActivated(false);
          setPlan(null);
          setPlanDetails(null);
          setLoading(false);
          return;
        }

        const adminStatus = await checkIsAdmin();
        if (adminStatus) {
          setIsActivated(true);
          setPlan("Admin");
          setPlanDetails({
            max_connections: 999,
            max_contacts: 999999,
            max_messages_per_day: 999999,
            ai_enabled: true
          });
          setLoading(false);
          return;
        }

        // Fetch from the backend API which now includes planDetails
        const { apiFetch } = await import("./api");
        const response = await apiFetch("/api/ai/subscription");
        
        if (response.success && response.data) {
          const subData = response.data;
          setPlan(subData.plan);
          setPlanDetails(subData.planDetails);
          setIsActivated(true);
        } else {
          // Graceful fallback for logged-in users
          setPlan("Free");
          setPlanDetails({
            max_connections: 1,
            max_contacts: 50,
            max_messages_per_day: 20,
            ai_enabled: true,
            automation_level: "basic"
          });
          setIsActivated(true);
        }

      } catch (err) {
        console.error("Error checking activation:", err);
        // Even on error, do not lock out logged-in user
        setIsActivated(true);
        setPlan("Free");
        setPlanDetails({
          max_connections: 1,
          max_contacts: 50,
          max_messages_per_day: 20,
          ai_enabled: true,
          automation_level: "basic"
        });
      } finally {
        setLoading(false);
      }
    };
    checkActivation();
  }, []);

  return { isActivated, plan, planDetails, loading };
};

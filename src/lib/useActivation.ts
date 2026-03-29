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
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/ai/subscription`, {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            const userData = data.data;
            const subscription = userData.subscription;
            
            // Activation rule: isActivated = !!plan OR isAdmin
            if (subscription && subscription.plan) {
              setPlan(subscription.plan);
              setPlanDetails(userData.planDetails);
              setIsActivated(true);
            } else if (userData.plan) {
              setPlan(userData.plan);
              setIsActivated(true);
            } else if (userData.isActivated === true) {
              setPlan("Starter");
              setIsActivated(true);
            } else {
              setIsActivated(false);
            }
          }
        }
      } catch (err) {
        console.error("Error checking activation:", err);
        setIsActivated(false);
        setPlan(null);
        setPlanDetails(null);
      } finally {
        setLoading(false);
      }
    };
    checkActivation();
  }, []);

  return { isActivated, plan, planDetails, loading };
};

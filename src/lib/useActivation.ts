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
            const subData = data.data;
            
            // Standardized: plan is always present, active is always true
            setPlan(subData.plan);
            setPlanDetails(subData.planDetails);
            setIsActivated(true); // All users are "activated" now
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

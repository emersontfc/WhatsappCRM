import { useEffect, useState } from "react";
import { getUser } from "../supabase";
import { ApiError, apiFetch } from "./api";

const freePlanDetails = {
  max_connections: 1,
  max_contacts: 50,
  max_messages_per_day: 20,
  ai_enabled: true,
  automation_level: "basic"
};

type Activation = {
  isActivated: boolean;
  plan: string | null;
  planDetails: typeof freePlanDetails | null;
  error: string | null;
};

const inactive: Activation = { isActivated: false, plan: null, planDetails: null, error: null };
const subscriptionUnavailable = "Não foi possível consultar a subscrição.";

export async function loadActivation(accountId: string | undefined, signal: AbortSignal): Promise<Activation> {
  try {
    const result = await apiFetch("/api/ai/subscription", { accountId, signal, timeout: 8_000 });
    const subscription = result?.data;
    if (result?.success !== true || typeof subscription?.id !== "string" || !subscription.id ||
        typeof subscription.plan !== "string" || !subscription.plan) {
      throw new Error(subscriptionUnavailable);
    }
    if (accountId && subscription.id !== accountId) return { ...inactive, error: "Não foi possível confirmar a conta atual." };
    return { isActivated: true, plan: subscription.plan, planDetails: subscription.planDetails ?? null, error: null };
  } catch (error) {
    if (signal.aborted) return inactive;
    if (error instanceof ApiError && error.status === 401) {
      return { ...inactive, error: "A sessão terminou. Inicia sessão novamente." };
    }
    const currentAccount = accountId ?? (await getUser().catch(() => null))?.id;
    if (signal.aborted) return inactive;
    return currentAccount
      ? { isActivated: true, plan: "Free", planDetails: freePlanDetails, error: subscriptionUnavailable }
      : { ...inactive, error: subscriptionUnavailable };
  }
}

export function useActivation(accountId?: string) {
  const [activation, setActivation] = useState<Activation>(inactive);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadActivation(accountId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setActivation(result);
      setLoading(false);
    });
    return () => controller.abort();
  }, [accountId, revision]);

  return { ...activation, loading, retry: () => setRevision((current) => current + 1) };
}

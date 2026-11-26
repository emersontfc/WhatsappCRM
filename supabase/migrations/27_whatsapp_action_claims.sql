BEGIN;

-- Existing inbox rows stay null. Their actions may already have run on an older release.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS agentx_live_ingress boolean;

CREATE TABLE IF NOT EXISTS public.agentx_whatsapp_action_claims (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id text NOT NULL CHECK (char_length(message_id) BETWEEN 1 AND 200),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
ALTER TABLE public.agentx_whatsapp_action_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_whatsapp_action_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agentx_whatsapp_action_claims TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_claim_whatsapp_action(p_user_id uuid, p_message_id text)
RETURNS boolean LANGUAGE sql SET search_path = '' AS $$
  WITH claimed AS (
    INSERT INTO public.agentx_whatsapp_action_claims (user_id, message_id)
    SELECT m.user_id, m.msg_id FROM public.messages m
    WHERE m.user_id = p_user_id AND m.msg_id = p_message_id AND m.msg_id <> ''
      AND char_length(p_message_id) BETWEEN 1 AND 200 AND m.agentx_live_ingress IS TRUE
    ON CONFLICT (user_id, message_id) DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

CREATE OR REPLACE FUNCTION public.agentx_whatsapp_action_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.agentx_whatsapp_action_claims') IS NOT NULL
    AND has_function_privilege('service_role', 'public.agentx_claim_whatsapp_action(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.agentx_claim_whatsapp_action(uuid,text)', 'EXECUTE');
$$;

REVOKE EXECUTE ON FUNCTION public.agentx_claim_whatsapp_action(uuid,text),
  public.agentx_whatsapp_action_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_claim_whatsapp_action(uuid,text),
  public.agentx_whatsapp_action_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

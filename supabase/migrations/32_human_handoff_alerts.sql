BEGIN;

CREATE TABLE IF NOT EXISTS public.agentx_human_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  paused_at timestamptz NOT NULL,
  source_message_id text CHECK (length(source_message_id) BETWEEN 1 AND 200),
  cause text NOT NULL CHECK (cause IN ('requested', 'agent_unavailable')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'uncertain', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  available_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  whatsapp_message_id text CHECK (length(whatsapp_message_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id, paused_at),
  CHECK ((status = 'sent') = (whatsapp_message_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS agentx_human_handoff_source_idx
  ON public.agentx_human_handoffs (user_id, contact_id, source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_human_handoff_due_idx
  ON public.agentx_human_handoffs (available_at, id) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS agentx_human_handoff_sending_idx
  ON public.agentx_human_handoffs (claimed_at) WHERE status = 'sending';
ALTER TABLE public.agentx_human_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_human_handoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agentx_human_handoffs TO service_role;
GRANT SELECT, UPDATE ON public.contacts TO service_role;
GRANT SELECT (id, phone, admin_phones) ON public.users TO service_role;
GRANT INSERT ON public.agent_logs TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_request_human_handoff(
  p_user uuid, p_contact uuid, p_source_message_id text, p_cause text
) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  contact public.contacts%ROWTYPE;
  paused timestamptz := clock_timestamp();
  new_id uuid;
BEGIN
  IF p_user IS NULL OR p_contact IS NULL OR p_cause IS NULL OR p_cause NOT IN ('requested', 'agent_unavailable')
     OR (p_source_message_id IS NOT NULL AND length(btrim(p_source_message_id)) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'Pedido de atendimento inválido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO contact FROM public.contacts WHERE id = p_contact AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF contact.ai_paused THEN RETURN 'already'; END IF;
  IF p_source_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agentx_human_handoffs
    WHERE user_id = p_user AND contact_id = p_contact AND source_message_id = btrim(p_source_message_id)
  ) THEN RETURN 'already'; END IF;

  UPDATE public.contacts SET ai_paused = true, ai_paused_at = paused WHERE id = p_contact AND user_id = p_user;
  INSERT INTO public.agentx_human_handoffs (user_id, contact_id, paused_at, source_message_id, cause)
  VALUES (p_user, p_contact, paused, btrim(p_source_message_id), p_cause) RETURNING id INTO new_id;
  INSERT INTO public.agent_logs (user_id, phone, action, data)
  VALUES (p_user, COALESCE(public.agentx_contact_phone(contact.phone), ''), 'human_handoff_requested',
    jsonb_build_object('contactId', p_contact, 'handoffId', new_id, 'cause', p_cause));
  RETURN 'queued';
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_claim_human_handoffs(
  p_now timestamptz, p_user uuid DEFAULT NULL, p_contact uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid, user_id uuid, contact_id uuid, claim_token uuid,
  contact_phone text, contact_lid text, admin_phone text, admin_phones text
) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_now IS NULL OR (p_contact IS NOT NULL AND p_user IS NULL) THEN
    RAISE EXCEPTION 'Consulta de atendimento inválida' USING ERRCODE = '22023';
  END IF;

  IF p_user IS NULL THEN
    -- A worker that stopped while sending may already have reached WhatsApp.
    WITH stale AS (
      SELECT q.id FROM public.agentx_human_handoffs q
      WHERE q.status = 'sending' AND q.claimed_at <= p_now - interval '2 minutes'
      ORDER BY q.claimed_at LIMIT 30 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.agentx_human_handoffs q SET status = 'uncertain', claim_token = NULL, updated_at = p_now
    FROM stale WHERE q.id = stale.id;

    -- When an operator resumes AI, don't send any alert still waiting for that old pause.
    WITH obsolete AS (
      SELECT q.id FROM public.agentx_human_handoffs q
      WHERE q.status IN ('pending', 'retry') AND q.available_at <= p_now
        AND NOT EXISTS (SELECT 1 FROM public.contacts c
          WHERE c.id = q.contact_id AND c.user_id = q.user_id AND c.ai_paused AND c.ai_paused_at = q.paused_at)
      ORDER BY q.available_at LIMIT 30 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.agentx_human_handoffs q SET status = 'cancelled', updated_at = p_now
    FROM obsolete WHERE q.id = obsolete.id;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT q.id, c.phone, c.lid, profile.phone AS notify_phone, profile.admin_phones AS notify_phones
    FROM public.agentx_human_handoffs q
    JOIN public.contacts c ON c.user_id = q.user_id AND c.id = q.contact_id AND c.ai_paused AND c.ai_paused_at = q.paused_at
    LEFT JOIN public.users profile ON profile.id = q.user_id
    WHERE q.status IN ('pending', 'retry') AND q.attempts < 6 AND q.available_at <= p_now
      AND (p_user IS NULL OR q.user_id = p_user) AND (p_contact IS NULL OR q.contact_id = p_contact)
    ORDER BY q.available_at, q.id LIMIT 10 FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.agentx_human_handoffs q SET status = 'sending', attempts = q.attempts + 1,
    claim_token = gen_random_uuid(), claimed_at = p_now, updated_at = p_now
  FROM due WHERE q.id = due.id
  RETURNING q.id, q.user_id, q.contact_id, q.claim_token, due.phone, due.lid, due.notify_phone, due.notify_phones;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_finish_human_handoff(
  p_user uuid, p_handoff uuid, p_claim uuid, p_outcome text, p_receipt text, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'retry', 'uncertain') OR p_now IS NULL
     OR (p_outcome = 'sent' AND (p_receipt IS NULL OR length(btrim(p_receipt)) NOT BETWEEN 1 AND 200)) THEN
    RAISE EXCEPTION 'Resultado do atendimento inválido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agentx_human_handoffs q SET
    status = CASE WHEN p_outcome = 'retry' AND q.attempts >= 6 THEN 'failed' ELSE p_outcome END,
    available_at = CASE WHEN p_outcome = 'retry' AND q.attempts < 6
      THEN p_now + make_interval(mins => (ARRAY[1, 2, 5, 10, 20])[q.attempts]) ELSE q.available_at END,
    claim_token = NULL, updated_at = p_now,
    whatsapp_message_id = CASE WHEN p_outcome = 'sent' THEN btrim(p_receipt) END
  WHERE q.id = p_handoff AND q.user_id = p_user AND q.status = 'sending' AND q.claim_token = p_claim;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_human_handoff_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass('public.agentx_human_handoffs') AND relrowsecurity)
    AND to_regclass('public.agentx_human_handoff_source_idx') IS NOT NULL
    AND to_regclass('public.agentx_human_handoff_due_idx') IS NOT NULL
    AND to_regprocedure('public.agentx_request_human_handoff(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_claim_human_handoffs(timestamptz,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.agentx_finish_human_handoff(uuid,uuid,uuid,text,text,timestamptz)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_request_human_handoff(uuid,uuid,text,text),
  public.agentx_claim_human_handoffs(timestamptz,uuid,uuid), public.agentx_finish_human_handoff(uuid,uuid,uuid,text,text,timestamptz),
  public.agentx_human_handoff_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_request_human_handoff(uuid,uuid,text,text),
  public.agentx_claim_human_handoffs(timestamptz,uuid,uuid), public.agentx_finish_human_handoff(uuid,uuid,uuid,text,text,timestamptz),
  public.agentx_human_handoff_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

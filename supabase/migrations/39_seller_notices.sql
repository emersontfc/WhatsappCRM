BEGIN;

CREATE TABLE IF NOT EXISTS public.agentx_seller_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  proof_id uuid REFERENCES public.payment_verifications(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  order_revision timestamptz,
  kind text NOT NULL CHECK (kind IN ('proof_review', 'rejection')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'uncertain', 'failed', 'cancelled')),
  reason text CHECK (reason IN ('whatsapp_offline', 'missing_recipient', 'ack_timeout', 'no_receipt',
    'transport_unknown', 'worker_interrupted', 'superseded', 'opted_out')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  available_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  whatsapp_message_id text CHECK (length(whatsapp_message_id) BETWEEN 1 AND 200),
  last_requeued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, event_id),
  CHECK ((status = 'sent') = (whatsapp_message_id IS NOT NULL)),
  CHECK ((status = 'sending') = (claim_token IS NOT NULL)),
  CHECK ((kind = 'rejection') = (order_revision IS NOT NULL)),
  CHECK (kind <> 'proof_review' OR (proof_id IS NOT NULL AND proof_id = event_id))
);
CREATE INDEX IF NOT EXISTS agentx_seller_notices_due_idx ON public.agentx_seller_notices (available_at, id)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS agentx_seller_notices_sending_idx ON public.agentx_seller_notices (claimed_at)
  WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS agentx_seller_notices_account_idx ON public.agentx_seller_notices (user_id, status, updated_at DESC);
ALTER TABLE public.agentx_seller_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_seller_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agentx_seller_notices TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_enqueue_seller_proof_notice(p_user uuid, p_order uuid, p_proof uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  notice_id uuid;
BEGIN
  INSERT INTO public.agentx_seller_notices (user_id, order_id, proof_id, event_id, kind)
  SELECT o.user_id, o.id, v.id, v.id, 'proof_review'
  FROM public.orders o
  JOIN public.payment_verifications v ON v.order_id = o.id AND v.user_id = o.user_id
  JOIN public.agentx_seller_settings s ON s.user_id = o.user_id
  WHERE o.user_id = p_user AND o.id = p_order AND v.id = p_proof AND v.status = 'pending'
    AND s.notification_phone IS NOT NULL AND s.notification_phone <> COALESCE(public.agentx_contact_phone(o.customer_phone), '')
  ON CONFLICT (user_id, kind, event_id) DO NOTHING
  RETURNING id INTO notice_id;
  RETURN notice_id;
END;
$$;

-- Use explicit wrappers for existing sources. A previous app release can remain running
-- during migration and still sends its own best-effort alert.
CREATE OR REPLACE FUNCTION public.agentx_seller_submit_proof_with_notice(
  p_user uuid, p_order uuid, p_phone text, p_source_message text, p_proof jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  saved jsonb := public.agentx_seller_submit_proof(p_user, p_order, p_phone, p_source_message, p_proof);
  notice_id uuid;
BEGIN
  IF (saved->>'created')::boolean THEN
    notice_id := public.agentx_enqueue_seller_proof_notice(p_user, p_order, (saved->>'id')::uuid);
  END IF;
  RETURN saved || jsonb_build_object('noticeId', notice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_submit_group_payment_proof_with_notice(
  p_user uuid, p_group text, p_order uuid, p_phone text, p_source_message text, p_proof jsonb, p_attachment jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  saved jsonb := public.agentx_submit_group_payment_proof(p_user, p_group, p_order, p_phone, p_source_message, p_proof, p_attachment);
  notice_id uuid;
BEGIN
  IF (saved->>'created')::boolean THEN
    notice_id := public.agentx_enqueue_seller_proof_notice(p_user, p_order, (saved->>'id')::uuid);
  END IF;
  RETURN saved || jsonb_build_object('noticeId', notice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_direct_proof_seller_notice()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.agentx_enqueue_seller_proof_notice(NEW.user_id, NEW.order_id, NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agentx_direct_proof_seller_notice ON public.payment_verifications;
CREATE TRIGGER agentx_direct_proof_seller_notice AFTER INSERT ON public.payment_verifications
FOR EACH ROW WHEN (NEW.status = 'pending' AND NEW.extracted_data->>'source' = 'whatsapp_private')
EXECUTE FUNCTION public.agentx_direct_proof_seller_notice();

CREATE OR REPLACE FUNCTION public.agentx_seller_team_reject_with_notice(
  p_actor uuid, p_org uuid, p_order uuid, p_reason text, p_proof uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  decision jsonb := public.agentx_seller_team_reject_payment(p_actor, p_org, p_order, p_reason, p_proof);
  notice_id uuid;
BEGIN
  IF (decision->>'notify')::boolean THEN
    INSERT INTO public.agentx_seller_notices (user_id, order_id, proof_id, event_id, order_revision, kind)
    SELECT o.user_id, o.id, p_proof, COALESCE(p_proof, gen_random_uuid()), o.updated_at, 'rejection'
    FROM public.orders o
    WHERE o.id = p_order AND o.user_id = (decision->'order'->>'user_id')::uuid AND o.status = 'rejected'
    ON CONFLICT (user_id, kind, event_id) DO NOTHING
    RETURNING id INTO notice_id;
  END IF;
  RETURN decision || jsonb_build_object('noticeId', notice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_claim_seller_notices(
  p_now timestamptz, p_user uuid DEFAULT NULL, p_notice uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid, user_id uuid, order_id uuid, kind text, recipient text, order_number text, rejected_reason text, claim_token uuid
) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_now IS NULL OR (p_notice IS NOT NULL AND p_user IS NULL) THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Consulta de avisos inválida.';
  END IF;

  WITH stale AS (
    SELECT q.id FROM public.agentx_seller_notices q
    WHERE q.status = 'sending' AND q.claimed_at <= p_now - interval '2 minutes'
      AND (p_user IS NULL OR q.user_id = p_user) AND (p_notice IS NULL OR q.id = p_notice)
    ORDER BY q.claimed_at LIMIT 30 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agentx_seller_notices q
    SET status = 'uncertain', reason = 'worker_interrupted', claim_token = NULL, updated_at = p_now
    FROM stale WHERE q.id = stale.id;

  RETURN QUERY
  WITH due AS (
    SELECT q.id, o.order_number, o.rejected_reason, CASE WHEN q.kind = 'proof_review'
      THEN settings.notification_phone ELSE public.agentx_contact_phone(o.customer_phone) END AS recipient,
      CASE
        WHEN q.kind = 'proof_review' AND (o.status <> 'verification_pending' OR v.status IS DISTINCT FROM 'pending') THEN 'superseded'
        WHEN q.kind = 'rejection' AND (o.status <> 'rejected' OR o.updated_at IS DISTINCT FROM q.order_revision) THEN 'superseded'
        WHEN q.kind = 'proof_review' AND (settings.notification_phone IS NULL
          OR settings.notification_phone = public.agentx_contact_phone(o.customer_phone)) THEN 'opted_out'
      END AS skip_reason
    FROM public.agentx_seller_notices q
    JOIN public.orders o ON o.id = q.order_id AND o.user_id = q.user_id
    LEFT JOIN public.payment_verifications v ON v.id = q.proof_id AND v.order_id = q.order_id AND v.user_id = q.user_id
    LEFT JOIN public.agentx_seller_settings settings ON settings.user_id = q.user_id
    WHERE q.status IN ('pending', 'retry') AND q.attempts < 6 AND q.available_at <= p_now
      AND (p_user IS NULL OR q.user_id = p_user) AND (p_notice IS NULL OR q.id = p_notice)
    ORDER BY q.available_at, q.id LIMIT 10 FOR UPDATE OF q SKIP LOCKED
  ), claimed AS (
    UPDATE public.agentx_seller_notices q SET
      status = CASE WHEN due.skip_reason IS NULL THEN 'sending' ELSE 'cancelled' END,
      reason = due.skip_reason,
      claim_token = CASE WHEN due.skip_reason IS NULL THEN gen_random_uuid() END,
      claimed_at = CASE WHEN due.skip_reason IS NULL THEN p_now END,
      attempts = q.attempts + CASE WHEN due.skip_reason IS NULL THEN 1 ELSE 0 END,
      updated_at = p_now
    FROM due WHERE q.id = due.id
    RETURNING q.id, q.user_id, q.order_id, q.kind, due.recipient, due.order_number, due.rejected_reason, q.claim_token
  )
  SELECT c.id, c.user_id, c.order_id, c.kind, c.recipient, c.order_number, c.rejected_reason, c.claim_token
  FROM claimed c WHERE c.claim_token IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_finish_seller_notice(
  p_user uuid, p_notice uuid, p_claim uuid, p_outcome text, p_reason text, p_receipt text, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_now IS NULL OR NOT COALESCE(CASE p_outcome
    WHEN 'sent' THEN p_reason IS NULL AND length(btrim(p_receipt)) BETWEEN 1 AND 200
    WHEN 'retry' THEN p_reason = 'whatsapp_offline' AND p_receipt IS NULL
    WHEN 'uncertain' THEN p_reason IN ('ack_timeout', 'no_receipt', 'transport_unknown') AND p_receipt IS NULL
    WHEN 'failed' THEN p_reason = 'missing_recipient' AND p_receipt IS NULL
    WHEN 'cancelled' THEN p_reason IN ('superseded', 'opted_out') AND p_receipt IS NULL
    ELSE false END, false) THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Resultado do aviso inválido.';
  END IF;

  UPDATE public.agentx_seller_notices q SET
    status = CASE WHEN p_outcome = 'retry' AND q.attempts >= 6 THEN 'failed' ELSE p_outcome END,
    reason = p_reason,
    available_at = CASE WHEN p_outcome = 'retry' AND q.attempts < 6
      THEN p_now + make_interval(mins => (ARRAY[1, 2, 5, 10, 20])[q.attempts]) ELSE q.available_at END,
    claim_token = NULL, updated_at = p_now, whatsapp_message_id = btrim(p_receipt)
  WHERE q.user_id = p_user AND q.id = p_notice AND q.status = 'sending' AND q.claim_token = p_claim;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_retry_seller_notice(p_actor uuid, p_org uuid, p_notice uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  access jsonb := public.agentx_seller_team_access(p_actor, p_org);
BEGIN
  IF COALESCE(access->>'role', '') NOT IN ('owner', 'finance_admin') THEN
    RAISE insufficient_privilege USING MESSAGE = 'Sem permissão para retomar avisos de vendas.';
  END IF;
  UPDATE public.agentx_seller_notices q SET status = 'retry', attempts = 0, available_at = now(),
    updated_at = now(), last_requeued_by = p_actor
  FROM public.orders o
  WHERE q.id = p_notice AND q.user_id = (access->>'account_id')::uuid
    AND o.id = q.order_id AND o.user_id = q.user_id
    AND q.status = 'failed' AND q.reason IN ('whatsapp_offline', 'missing_recipient')
    AND (
      (q.kind = 'rejection' AND o.status = 'rejected' AND o.updated_at = q.order_revision)
      OR (q.kind = 'proof_review' AND o.status = 'verification_pending'
        AND EXISTS (SELECT 1 FROM public.payment_verifications v
          WHERE v.id = q.proof_id AND v.user_id = q.user_id AND v.order_id = q.order_id AND v.status = 'pending')
        AND EXISTS (SELECT 1 FROM public.agentx_seller_settings s WHERE s.user_id = q.user_id
          AND s.notification_phone IS NOT NULL
          AND s.notification_phone <> COALESCE(public.agentx_contact_phone(o.customer_phone), '')))
    );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_notices_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass('public.agentx_seller_notices') AND relrowsecurity)
    AND to_regclass('public.agentx_seller_notices_due_idx') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = to_regclass('public.payment_verifications')
      AND tgname = 'agentx_direct_proof_seller_notice' AND tgenabled IN ('O', 'A'))
    AND to_regprocedure('public.agentx_seller_submit_proof_with_notice(uuid,uuid,text,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.agentx_submit_group_payment_proof_with_notice(uuid,text,uuid,text,text,jsonb,jsonb)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_team_reject_with_notice(uuid,uuid,uuid,text,uuid)') IS NOT NULL
    AND to_regprocedure('public.agentx_claim_seller_notices(timestamptz,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.agentx_finish_seller_notice(uuid,uuid,uuid,text,text,text,timestamptz)') IS NOT NULL
    AND to_regprocedure('public.agentx_retry_seller_notice(uuid,uuid,uuid)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_enqueue_seller_proof_notice(uuid,uuid,uuid), public.agentx_direct_proof_seller_notice(),
  public.agentx_seller_submit_proof_with_notice(uuid,uuid,text,text,jsonb),
  public.agentx_submit_group_payment_proof_with_notice(uuid,text,uuid,text,text,jsonb,jsonb),
  public.agentx_seller_team_reject_with_notice(uuid,uuid,uuid,text,uuid),
  public.agentx_claim_seller_notices(timestamptz,uuid,uuid), public.agentx_finish_seller_notice(uuid,uuid,uuid,text,text,text,timestamptz),
  public.agentx_retry_seller_notice(uuid,uuid,uuid), public.agentx_seller_notices_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_enqueue_seller_proof_notice(uuid,uuid,uuid), public.agentx_direct_proof_seller_notice(),
  public.agentx_seller_submit_proof_with_notice(uuid,uuid,text,text,jsonb),
  public.agentx_submit_group_payment_proof_with_notice(uuid,text,uuid,text,text,jsonb,jsonb),
  public.agentx_seller_team_reject_with_notice(uuid,uuid,uuid,text,uuid),
  public.agentx_claim_seller_notices(timestamptz,uuid,uuid), public.agentx_finish_seller_notice(uuid,uuid,uuid,text,text,text,timestamptz),
  public.agentx_retry_seller_notice(uuid,uuid,uuid), public.agentx_seller_notices_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

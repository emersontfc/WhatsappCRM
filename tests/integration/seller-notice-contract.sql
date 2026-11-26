-- Run after migration 39 in an isolated AgentX test database.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000391', 'notice-owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000392', 'notice-other@example.invalid');

CREATE FUNCTION public.agentx_test_fail_seller_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id = '00000000-0000-4000-8000-000000000394' THEN
    RAISE EXCEPTION 'Simulated notice write failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agentx_test_fail_seller_notice BEFORE INSERT ON public.agentx_seller_notices
FOR EACH ROW EXECUTE FUNCTION public.agentx_test_fail_seller_notice();

SET LOCAL ROLE service_role;
DO $$
DECLARE
  owner_id constant uuid := '00000000-0000-4000-8000-000000000391';
  other_id constant uuid := '00000000-0000-4000-8000-000000000392';
  owner_order constant uuid := '00000000-0000-4000-8000-000000000393';
  blocked_order constant uuid := '00000000-0000-4000-8000-000000000394';
  other_order constant uuid := '00000000-0000-4000-8000-000000000395';
  buyer constant text := '258849000390';
  reviewer constant text := '258849000391';
  other_reviewer constant text := '258849000392';
  proof constant jsonb := '{"provider":"mpesa","transaction_reference":"NOTICE39A","amount":100,"sender_phone":"","sender_name":"","proof_type":"sms","proof_raw_text":"Transferência de 100 MT (NOTICE39A).","confidence_score":0.95,"extracted_data":{}}';
  signatures constant text[] := ARRAY[
    'public.agentx_seller_submit_proof_with_notice(uuid,uuid,text,text,jsonb)',
    'public.agentx_submit_group_payment_proof_with_notice(uuid,text,uuid,text,text,jsonb,jsonb)',
    'public.agentx_seller_team_reject_with_notice(uuid,uuid,uuid,text,uuid)',
    'public.agentx_claim_seller_notices(timestamptz,uuid,uuid)',
    'public.agentx_finish_seller_notice(uuid,uuid,uuid,text,text,text,timestamptz)',
    'public.agentx_retry_seller_notice(uuid,uuid,uuid)',
    'public.agentx_seller_notices_ready()'
  ];
  signature text;
  submitted jsonb;
  replayed jsonb;
  notice_id uuid;
  due_at timestamptz;
  retry_at timestamptz;
  claim record;
  retry_claim record;
  rejection jsonb;
  rejection_id uuid;
  direct_proof_id uuid;
BEGIN
  ASSERT public.agentx_seller_notices_ready();
  ASSERT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.agentx_seller_notices'::regclass);
  ASSERT NOT has_table_privilege('anon', 'public.agentx_seller_notices', 'SELECT,INSERT,UPDATE,DELETE');
  ASSERT NOT has_table_privilege('authenticated', 'public.agentx_seller_notices', 'SELECT,INSERT,UPDATE,DELETE');
  FOREACH signature IN ARRAY signatures LOOP
    ASSERT has_function_privilege('service_role', signature, 'EXECUTE'), signature;
    ASSERT NOT has_function_privilege('anon', signature, 'EXECUTE'), signature;
    ASSERT NOT has_function_privilege('authenticated', signature, 'EXECUTE'), signature;
  END LOOP;

  INSERT INTO public.agentx_seller_settings (user_id, payment_method, payment_recipient, recipient_name, notification_phone)
  VALUES (owner_id, 'mpesa', reviewer, 'Loja A', reviewer),
    (other_id, 'mpesa', other_reviewer, 'Loja B', other_reviewer);
  INSERT INTO public.orders (id, order_number, user_id, customer_phone, status, total_amount)
  VALUES (owner_order, 'AGX-NOTICE-OWNER', owner_id, buyer, 'awaiting_payment', 100),
    (blocked_order, 'AGX-NOTICE-ROLLBACK', owner_id, buyer, 'awaiting_payment', 100),
    (other_order, 'AGX-NOTICE-OTHER', other_id, buyer, 'awaiting_payment', 100);

  BEGIN
    PERFORM public.agentx_seller_submit_proof_with_notice(owner_id, blocked_order, buyer, 'notice-rollback', proof);
    RAISE EXCEPTION 'A failed notice insert did not abort proof submission';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Simulated notice write failure' THEN RAISE; END IF;
  END;
  ASSERT (SELECT status = 'awaiting_payment' FROM public.orders WHERE id = blocked_order);
  ASSERT NOT EXISTS (SELECT 1 FROM public.payment_verifications WHERE order_id = blocked_order);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agent_operations WHERE order_id = blocked_order);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_seller_notices WHERE order_id = blocked_order);

  -- A rolling deployment can leave the previous API running. Its original RPC
  -- retains the old direct sender and must not produce a second notice.
  PERFORM public.agentx_seller_submit_proof(owner_id, blocked_order, buyer, 'notice-legacy-release', proof);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_seller_notices WHERE order_id = blocked_order);

  submitted := public.agentx_seller_submit_proof_with_notice(owner_id, owner_order, buyer, 'notice-original', proof);
  notice_id := (submitted->>'noticeId')::uuid;
  ASSERT submitted->>'created' = 'true' AND notice_id IS NOT NULL;
  ASSERT (SELECT status = 'verification_pending' FROM public.orders WHERE id = owner_order);
  replayed := public.agentx_seller_submit_proof_with_notice(owner_id, owner_order, buyer, 'notice-original', proof);
  ASSERT replayed->>'id' = submitted->>'id' AND replayed->>'created' = 'false';
  ASSERT (SELECT count(*) = 1 FROM public.agentx_seller_notices WHERE order_id = owner_order);
  SELECT available_at INTO STRICT due_at FROM public.agentx_seller_notices
    WHERE id = notice_id AND user_id = owner_id AND proof_id = (submitted->>'id')::uuid AND kind = 'proof_review';

  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(due_at, other_id, notice_id));
  SELECT * INTO STRICT claim FROM public.agentx_claim_seller_notices(due_at, owner_id, notice_id);
  ASSERT claim.id = notice_id AND claim.user_id = owner_id AND claim.order_id = owner_order AND claim.recipient = reviewer;
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(due_at, owner_id, notice_id));
  ASSERT NOT public.agentx_finish_seller_notice(other_id, notice_id, claim.claim_token, 'sent', NULL, 'foreign-ack', due_at);
  ASSERT public.agentx_finish_seller_notice(owner_id, notice_id, claim.claim_token, 'retry', 'whatsapp_offline', NULL, due_at);
  SELECT available_at INTO STRICT retry_at FROM public.agentx_seller_notices
    WHERE id = notice_id AND status = 'retry' AND attempts = 1;
  ASSERT retry_at > due_at;
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(retry_at - interval '1 second', owner_id, notice_id));
  SELECT * INTO STRICT retry_claim FROM public.agentx_claim_seller_notices(retry_at, owner_id, notice_id);
  ASSERT retry_claim.claim_token <> claim.claim_token;
  ASSERT NOT public.agentx_finish_seller_notice(owner_id, notice_id, claim.claim_token, 'sent', NULL, 'stale-ack', retry_at);
  BEGIN
    IF public.agentx_finish_seller_notice(owner_id, notice_id, retry_claim.claim_token, 'sent', NULL, ' ', retry_at) THEN
      RAISE EXCEPTION 'A blank WhatsApp acknowledgement was accepted';
    END IF;
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  ASSERT public.agentx_finish_seller_notice(owner_id, notice_id, retry_claim.claim_token, 'sent', NULL, 'notice-fixture-ack', retry_at);
  ASSERT (SELECT status = 'sent' AND attempts = 2 AND whatsapp_message_id = 'notice-fixture-ack'
    FROM public.agentx_seller_notices WHERE id = notice_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(retry_at + interval '1 day', owner_id, notice_id));

  rejection := public.agentx_seller_team_reject_with_notice(owner_id, NULL, owner_order,
    'Valor por confirmar.', (submitted->>'id')::uuid);
  rejection_id := (rejection->>'noticeId')::uuid;
  ASSERT rejection->'order'->>'status' = 'rejected' AND rejection_id IS NOT NULL;
  ASSERT NOT (public.agentx_seller_team_reject_with_notice(owner_id, NULL, owner_order,
    'Valor por confirmar.', (submitted->>'id')::uuid)->>'notify')::boolean;
  ASSERT (SELECT count(*) = 1 FROM public.agentx_seller_notices WHERE order_id = owner_order AND kind = 'rejection');
  UPDATE public.agentx_seller_notices SET attempts = 5 WHERE id = rejection_id;
  SELECT available_at INTO STRICT due_at FROM public.agentx_seller_notices WHERE id = rejection_id;
  SELECT * INTO STRICT claim FROM public.agentx_claim_seller_notices(due_at, owner_id, rejection_id);
  ASSERT claim.kind = 'rejection' AND claim.recipient = buyer AND claim.rejected_reason = 'Valor por confirmar.';
  ASSERT public.agentx_finish_seller_notice(owner_id, rejection_id, claim.claim_token, 'retry', 'whatsapp_offline', NULL, due_at);
  ASSERT (SELECT status = 'failed' AND reason = 'whatsapp_offline' FROM public.agentx_seller_notices WHERE id = rejection_id);
  ASSERT NOT public.agentx_retry_seller_notice(other_id, NULL, rejection_id);
  ASSERT public.agentx_retry_seller_notice(owner_id, NULL, rejection_id);
  ASSERT (SELECT status = 'retry' AND last_requeued_by = owner_id FROM public.agentx_seller_notices WHERE id = rejection_id);
  SELECT * INTO STRICT claim FROM public.agentx_claim_seller_notices(due_at + interval '1 hour', owner_id, rejection_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(due_at + interval '2 hours', owner_id, rejection_id));
  ASSERT (SELECT status = 'uncertain' AND reason = 'worker_interrupted' FROM public.agentx_seller_notices WHERE id = rejection_id);
  ASSERT NOT public.agentx_retry_seller_notice(owner_id, NULL, rejection_id);

  submitted := public.agentx_seller_submit_proof_with_notice(other_id, other_order, buyer, 'notice-original', proof);
  notice_id := (submitted->>'noticeId')::uuid;
  SELECT available_at INTO STRICT due_at FROM public.agentx_seller_notices WHERE id = notice_id;
  SELECT * INTO STRICT claim FROM public.agentx_claim_seller_notices(due_at, other_id, notice_id);
  ASSERT claim.recipient = other_reviewer;
  ASSERT public.agentx_finish_seller_notice(other_id, notice_id, claim.claim_token, 'uncertain', 'no_receipt', NULL, due_at);
  ASSERT (SELECT status = 'uncertain' AND attempts = 1 AND whatsapp_message_id IS NULL
    FROM public.agentx_seller_notices WHERE id = notice_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_seller_notices(due_at + interval '1 day', other_id, notice_id));

  INSERT INTO public.payment_verifications (order_id, user_id, customer_phone, proof_type, extracted_data, status)
  VALUES (other_order, other_id, buyer, 'pdf', '{"source":"whatsapp_private"}', 'pending')
  RETURNING id INTO direct_proof_id;
  ASSERT EXISTS (SELECT 1 FROM public.agentx_seller_notices
    WHERE user_id = other_id AND order_id = other_order AND proof_id = direct_proof_id AND status = 'pending');
END;
$$;

ROLLBACK;

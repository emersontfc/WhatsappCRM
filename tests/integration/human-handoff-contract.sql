-- Run after the AgentX migrations in an isolated test database.
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('96000000-0000-4000-8000-000000000001'), ('96000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id, email, phone, admin_phones) VALUES
  ('96000000-0000-4000-8000-000000000001', 'handoff-owner@example.invalid', '258851230001', '258851230002,258851230003'),
  ('96000000-0000-4000-8000-000000000002', 'handoff-other@example.invalid', '258851230004', '258851230005');
INSERT INTO public.contacts(id, user_id, phone, lid, name, ai_paused, ai_paused_at) VALUES
  ('96000000-0000-4000-8000-000000000011', '96000000-0000-4000-8000-000000000001', '258851234500', NULL, 'Cliente A', false, NULL),
  ('96000000-0000-4000-8000-000000000012', '96000000-0000-4000-8000-000000000002', '258851234500', NULL, 'Cliente B', false, NULL),
  ('96000000-0000-4000-8000-000000000013', '96000000-0000-4000-8000-000000000001', NULL, '910000000000013', 'Cliente LID', false, NULL),
  ('96000000-0000-4000-8000-000000000014', '96000000-0000-4000-8000-000000000001', '258851234501', NULL, 'Cliente pausado', true, now() - interval '1 hour'),
  ('96000000-0000-4000-8000-000000000015', '96000000-0000-4000-8000-000000000001', '258851234502', NULL, 'Cliente teste de auditoria', false, NULL),
  ('96000000-0000-4000-8000-000000000016', '96000000-0000-4000-8000-000000000001', '258851234503', NULL, 'Cliente teste de retentativas', false, NULL);

CREATE FUNCTION public.agentx_test_fail_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'human_handoff_requested' AND NEW.data->>'contactId' = '96000000-0000-4000-8000-000000000015' THEN
    RAISE EXCEPTION 'Simulated audit failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agentx_test_fail_handoff_audit BEFORE INSERT ON public.agent_logs
FOR EACH ROW EXECUTE FUNCTION public.agentx_test_fail_handoff_audit();

SET LOCAL ROLE service_role;
DO $$
DECLARE
  owner_id constant uuid := '96000000-0000-4000-8000-000000000001';
  other_id constant uuid := '96000000-0000-4000-8000-000000000002';
  owned_contact_id constant uuid := '96000000-0000-4000-8000-000000000011';
  foreign_contact_id constant uuid := '96000000-0000-4000-8000-000000000012';
  lid_contact_id constant uuid := '96000000-0000-4000-8000-000000000013';
  paused_contact_id constant uuid := '96000000-0000-4000-8000-000000000014';
  audit_failure_contact_id constant uuid := '96000000-0000-4000-8000-000000000015';
  retry_limit_contact_id constant uuid := '96000000-0000-4000-8000-000000000016';
  handoff_rpcs constant text[] := ARRAY[
    'public.agentx_request_human_handoff(uuid,uuid,text,text)',
    'public.agentx_claim_human_handoffs(timestamptz,uuid,uuid)',
    'public.agentx_finish_human_handoff(uuid,uuid,uuid,text,text,timestamptz)',
    'public.agentx_human_handoff_ready()'
  ];
  rpc_signature text;
  pause_version timestamptz;
  due_at timestamptz;
  retry_at timestamptz;
  claim record;
  retry_claim record;
  stale_claim record;
BEGIN
  ASSERT public.agentx_human_handoff_ready();
  ASSERT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.agentx_human_handoffs'::regclass);
  ASSERT NOT has_table_privilege('anon', 'public.agentx_human_handoffs', 'SELECT,INSERT,UPDATE,DELETE');
  ASSERT NOT has_table_privilege('authenticated', 'public.agentx_human_handoffs', 'SELECT,INSERT,UPDATE,DELETE');
  FOREACH rpc_signature IN ARRAY handoff_rpcs LOOP
    ASSERT has_function_privilege('service_role', rpc_signature, 'EXECUTE');
    ASSERT NOT has_function_privilege('anon', rpc_signature, 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', rpc_signature, 'EXECUTE');
  END LOOP;

  BEGIN
    PERFORM public.agentx_request_human_handoff(owner_id, audit_failure_contact_id, 'handoff-audit-fails', 'requested');
    RAISE EXCEPTION 'A failed audit did not abort the handoff';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT NOT ai_paused AND ai_paused_at IS NULL FROM public.contacts WHERE id = audit_failure_contact_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_human_handoffs WHERE contact_id = audit_failure_contact_id);

  ASSERT public.agentx_request_human_handoff(owner_id, foreign_contact_id, 'handoff-source-a', 'requested') = 'missing';
  ASSERT (SELECT NOT ai_paused FROM public.contacts WHERE id = foreign_contact_id);
  ASSERT public.agentx_request_human_handoff(owner_id, paused_contact_id, 'handoff-manual-pause', 'requested') = 'already';
  ASSERT (SELECT ai_paused_at = now() - interval '1 hour' FROM public.contacts WHERE id = paused_contact_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_human_handoffs WHERE contact_id IN (foreign_contact_id, paused_contact_id));

  ASSERT public.agentx_request_human_handoff(owner_id, owned_contact_id, 'handoff-source-a', 'requested') = 'queued';
  SELECT ai_paused_at INTO STRICT pause_version FROM public.contacts WHERE id = owned_contact_id AND ai_paused;
  SELECT available_at INTO STRICT due_at FROM public.agentx_human_handoffs
    WHERE user_id = owner_id AND contact_id = owned_contact_id AND paused_at = pause_version
      AND source_message_id = 'handoff-source-a' AND cause = 'requested';

  ASSERT public.agentx_request_human_handoff(owner_id, owned_contact_id, 'handoff-source-a', 'requested') = 'already';
  ASSERT public.agentx_request_human_handoff(owner_id, owned_contact_id, 'handoff-source-b', 'agent_unavailable') = 'already';
  ASSERT (SELECT ai_paused_at = pause_version FROM public.contacts WHERE id = owned_contact_id);
  ASSERT (SELECT count(*) = 1 FROM public.agentx_human_handoffs WHERE contact_id = owned_contact_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(due_at, other_id, owned_contact_id));

  SELECT * INTO STRICT claim FROM public.agentx_claim_human_handoffs(due_at, owner_id, owned_contact_id);
  ASSERT claim.user_id = owner_id AND claim.contact_id = owned_contact_id AND claim.claim_token IS NOT NULL;
  ASSERT claim.contact_phone = '258851234500' AND claim.contact_lid IS NULL;
  ASSERT claim.admin_phone = '258851230001' AND claim.admin_phones = '258851230002,258851230003';
  ASSERT (SELECT count(*) = 1 FROM public.agent_logs WHERE user_id = owner_id AND phone = claim.contact_phone
    AND action = 'human_handoff_requested'
    AND data = jsonb_build_object('contactId', owned_contact_id, 'handoffId', claim.id, 'cause', 'requested'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(due_at, owner_id, owned_contact_id));
  ASSERT NOT public.agentx_finish_human_handoff(other_id, claim.id, claim.claim_token, 'sent', 'other-account', due_at);
  ASSERT NOT public.agentx_finish_human_handoff(owner_id, claim.id, gen_random_uuid(), 'sent', 'wrong-claim', due_at);

  -- An explicit failure before sending can be retried, with a fresh dispatch token.
  ASSERT public.agentx_finish_human_handoff(owner_id, claim.id, claim.claim_token, 'retry', NULL, due_at);
  SELECT available_at INTO STRICT retry_at FROM public.agentx_human_handoffs
    WHERE id = claim.id AND status = 'retry' AND attempts = 1;
  ASSERT retry_at > due_at;
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(retry_at - interval '1 second', owner_id, owned_contact_id));
  SELECT * INTO STRICT retry_claim FROM public.agentx_claim_human_handoffs(retry_at, owner_id, owned_contact_id);
  ASSERT retry_claim.id = claim.id AND retry_claim.claim_token <> claim.claim_token;
  ASSERT NOT public.agentx_finish_human_handoff(owner_id, claim.id, claim.claim_token, 'sent', 'expired-claim', retry_at);
  BEGIN
    PERFORM public.agentx_finish_human_handoff(owner_id, retry_claim.id, retry_claim.claim_token, 'sent', ' ', retry_at);
    RAISE EXCEPTION 'A blank provider acknowledgement was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  ASSERT public.agentx_finish_human_handoff(owner_id, retry_claim.id, retry_claim.claim_token, 'sent', 'fixture-handoff-receipt', retry_at);
  ASSERT (SELECT status = 'sent' AND attempts = 2 AND whatsapp_message_id = 'fixture-handoff-receipt'
    FROM public.agentx_human_handoffs WHERE id = claim.id);
  ASSERT NOT public.agentx_finish_human_handoff(owner_id, retry_claim.id, retry_claim.claim_token, 'retry', NULL, retry_at);
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(retry_at + interval '1 hour', owner_id, owned_contact_id));

  UPDATE public.contacts SET ai_paused = false, ai_paused_at = NULL WHERE id = owned_contact_id;
  ASSERT public.agentx_request_human_handoff(owner_id, owned_contact_id, 'handoff-source-a', 'requested') = 'already';
  ASSERT (SELECT NOT ai_paused AND ai_paused_at IS NULL FROM public.contacts WHERE id = owned_contact_id);
  ASSERT public.agentx_request_human_handoff(owner_id, owned_contact_id, 'handoff-fresh-source', 'requested') = 'queued';
  ASSERT (SELECT count(*) = 2 FROM public.agentx_human_handoffs WHERE contact_id = owned_contact_id);
  UPDATE public.contacts SET ai_paused = false, ai_paused_at = NULL WHERE id = owned_contact_id;
  ASSERT public.agentx_request_human_handoff(other_id, foreign_contact_id, 'handoff-source-a', 'requested') = 'queued';
  SELECT available_at INTO STRICT due_at FROM public.agentx_human_handoffs WHERE contact_id = foreign_contact_id;
  SELECT * INTO STRICT claim FROM public.agentx_claim_human_handoffs(due_at, other_id, foreign_contact_id);
  ASSERT claim.user_id = other_id AND claim.admin_phone = '258851230004' AND claim.admin_phones = '258851230005';
  ASSERT public.agentx_finish_human_handoff(other_id, claim.id, claim.claim_token, 'uncertain', NULL, due_at);
  ASSERT (SELECT status = 'uncertain' AND whatsapp_message_id IS NULL FROM public.agentx_human_handoffs WHERE id = claim.id);

  -- A crashed worker may have sent the notification. Expiry must never send it again.
  ASSERT public.agentx_request_human_handoff(owner_id, lid_contact_id, NULL, 'agent_unavailable') = 'queued';
  SELECT available_at INTO STRICT due_at FROM public.agentx_human_handoffs WHERE contact_id = lid_contact_id;
  SELECT * INTO STRICT stale_claim FROM public.agentx_claim_human_handoffs(due_at, owner_id, lid_contact_id);
  ASSERT stale_claim.contact_phone IS NULL AND stale_claim.contact_lid = '910000000000013';
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(due_at + interval '3 minutes'));
  ASSERT (SELECT status = 'uncertain' AND attempts = 1 AND whatsapp_message_id IS NULL
    FROM public.agentx_human_handoffs WHERE id = stale_claim.id);
  ASSERT NOT public.agentx_finish_human_handoff(owner_id, stale_claim.id, stale_claim.claim_token, 'retry', NULL, due_at + interval '3 minutes');
  ASSERT (SELECT status = 'cancelled' AND attempts = 0 FROM public.agentx_human_handoffs
    WHERE contact_id = owned_contact_id AND source_message_id = 'handoff-fresh-source');

  ASSERT public.agentx_request_human_handoff(owner_id, retry_limit_contact_id, 'handoff-fails', 'requested') = 'queued';
  FOR attempt IN 1..6 LOOP
    SELECT available_at INTO STRICT due_at FROM public.agentx_human_handoffs WHERE contact_id = retry_limit_contact_id;
    SELECT * INTO STRICT claim FROM public.agentx_claim_human_handoffs(due_at, owner_id, retry_limit_contact_id);
    ASSERT public.agentx_finish_human_handoff(owner_id, claim.id, claim.claim_token, 'retry', NULL, due_at);
    ASSERT (SELECT attempts = attempt AND status = CASE WHEN attempt < 6 THEN 'retry' ELSE 'failed' END
      FROM public.agentx_human_handoffs WHERE id = claim.id);
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_human_handoffs(due_at + interval '1 day', owner_id, retry_limit_contact_id));
END;
$$;

ROLLBACK;

-- Run after the AgentX migrations in an isolated test database.
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('95000000-0000-4000-8000-000000000001'), ('95000000-0000-4000-8000-000000000002');
INSERT INTO public.contacts(id, user_id, phone, name, tags) VALUES
  ('95000000-0000-4000-8000-000000000011', '95000000-0000-4000-8000-000000000001', '258851234522', 'Cliente A', '{"Existente"}'),
  ('95000000-0000-4000-8000-000000000012', '95000000-0000-4000-8000-000000000002', '258851234522', 'Cliente B', '{"Outra conta"}');
INSERT INTO public.whatsapp_operator_commands(user_id, message_id)
SELECT '95000000-0000-4000-8000-000000000001', message_id
FROM unnest(ARRAY['op-audit-pause', 'op-audit-repeat', 'op-audit-resume', 'op-audit-reject']) AS messages(message_id);

CREATE FUNCTION public.agentx_test_reject_operator_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data->>'messageId' = 'op-audit-reject' THEN
    RAISE EXCEPTION 'Simulated audit failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agentx_test_reject_operator_audit BEFORE INSERT ON public.agent_logs
FOR EACH ROW EXECUTE FUNCTION public.agentx_test_reject_operator_audit();

SET LOCAL ROLE service_role;

DO $$
DECLARE
  owner_id constant uuid := '95000000-0000-4000-8000-000000000001';
  other_id constant uuid := '95000000-0000-4000-8000-000000000002';
  contact_id constant uuid := '95000000-0000-4000-8000-000000000011';
  foreign_id constant uuid := '95000000-0000-4000-8000-000000000012';
  phone_number constant text := '258851234522';
  handoff constant text := 'public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)';
  readiness constant text := 'public.agentx_whatsapp_operator_audit_ready()';
  paused_at timestamptz;
BEGIN
  IF public.agentx_whatsapp_operator_audit_ready() IS DISTINCT FROM true
     OR NOT has_function_privilege('service_role', handoff, 'EXECUTE')
     OR has_function_privilege('anon', handoff, 'EXECUTE')
     OR has_function_privilege('authenticated', handoff, 'EXECUTE')
     OR has_function_privilege('anon', readiness, 'EXECUTE')
     OR has_function_privilege('authenticated', readiness, 'EXECUTE') THEN
    RAISE EXCEPTION 'The private operator RPC contract is unavailable or publicly callable';
  END IF;

  IF public.agentx_set_whatsapp_operator_handoff(owner_id, foreign_id, phone_number, true, 'op-audit-pause') <> 'missing'
     OR public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, '258851234523', true, 'op-audit-pause') <> 'missing' THEN
    RAISE EXCEPTION 'The handoff did not scope both contact ownership and canonical phone';
  END IF;
  BEGIN
    PERFORM public.agentx_set_whatsapp_operator_handoff(other_id, foreign_id, phone_number, true, 'op-audit-pause');
    RAISE EXCEPTION 'Accepted another account command claim';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  BEGIN
    PERFORM public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, true, repeat('x', 161));
    RAISE EXCEPTION 'Accepted an oversized command identifier';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  BEGIN
    PERFORM public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, true, 'op-audit-pause', repeat('x', 201));
    RAISE EXCEPTION 'Accepted an oversized pause reason';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  IF public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, true, 'op-audit-pause', E'Consulta\n manual') <> 'changed' THEN
    RAISE EXCEPTION 'The owner could not pause the conversation';
  END IF;
  SELECT ai_paused_at INTO paused_at FROM public.contacts WHERE id = contact_id AND ai_paused;
  IF paused_at IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.agent_logs
    WHERE user_id = owner_id AND phone = phone_number AND action = 'pause_ai_conversation'
      AND data->>'contactId' = contact_id::text AND data->>'messageId' = 'op-audit-pause'
      AND data->>'reason' = 'Consulta manual' AND created_at = paused_at
  ) THEN
    RAISE EXCEPTION 'The pause state and its trace were not persisted together';
  END IF;
  IF public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, true, 'op-audit-repeat') <> 'already' THEN
    RAISE EXCEPTION 'A repeated pause changed the conversation';
  END IF;
  IF (SELECT ai_paused_at FROM public.contacts WHERE id = contact_id) IS DISTINCT FROM paused_at
     OR (SELECT count(*) FROM public.agent_logs WHERE user_id = owner_id) <> 1 THEN
    RAISE EXCEPTION 'A repeated pause changed its timestamp or audit count';
  END IF;

  IF public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, false, 'op-audit-resume') <> 'changed' THEN
    RAISE EXCEPTION 'The owner could not resume the conversation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agent_logs WHERE user_id = owner_id AND action = 'resume_ai_conversation') THEN
    RAISE EXCEPTION 'The resume action has no trace';
  END IF;
  BEGIN
    PERFORM public.agentx_set_whatsapp_operator_handoff(owner_id, contact_id, phone_number, true, 'op-audit-reject');
    RAISE EXCEPTION 'A failed audit unexpectedly let the state change return';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts WHERE id = contact_id AND ai_paused = false AND ai_paused_at IS NULL AND tags = '{"Existente"}'
  ) OR (SELECT count(*) FROM public.agent_logs WHERE user_id = owner_id) <> 2
     OR EXISTS (SELECT 1 FROM public.contacts WHERE id = foreign_id AND ai_paused) THEN
    RAISE EXCEPTION 'Failed audit was not rolled back or unrelated state changed';
  END IF;
END;
$$;

ROLLBACK;

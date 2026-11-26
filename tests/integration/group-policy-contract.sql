BEGIN;

INSERT INTO auth.users (id) VALUES
  ('92000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002');

SET LOCAL ROLE service_role;
DO $$
DECLARE
  tenant uuid := '92000000-0000-4000-8000-000000000001';
  other uuid := '92000000-0000-4000-8000-000000000002';
  gid text := '120363000000099@g.us';
  second_gid text := '120363000000098@g.us';
  member text := '258841234567@s.whatsapp.net';
  policy jsonb := '{"allowed_link_hosts":["example.com"],"blocked_words":["palavra abusiva"],"warning_limit":2}';
  hours jsonb := '{"enabled":true,"timezone":"Africa/Maputo","days":[1],"opens_at":"09:00","closes_at":"18:00"}';
  overnight jsonb := '{"enabled":true,"timezone":"Africa/Maputo","days":[1],"opens_at":"22:00","closes_at":"06:00"}';
  monday date := (date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')::date + 7);
  open_at timestamptz := (monday + '09:00'::time) AT TIME ZONE 'Africa/Maputo';
  close_at timestamptz := (monday + '18:00'::time) AT TIME ZONE 'Africa/Maputo';
  after_midnight timestamptz := (monday + 1 + '04:00'::time) AT TIME ZONE 'Africa/Maputo';
  next_before timestamptz;
  warning jsonb;
  event_id bigint;
  claim record;
  later_claim record;
BEGIN
  ASSERT public.agentx_group_policy_ready();
  ASSERT NOT has_table_privilege('authenticated', 'public.agentx_group_warnings', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.agentx_group_hours', 'SELECT');
  ASSERT NOT has_function_privilege('authenticated', 'public.agentx_claim_group_hours(timestamptz)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.agentx_claim_group_warning(uuid,text,text,text,text)', 'EXECUTE');
  ASSERT NOT has_column_privilege('service_role', 'public.agentx_group_warnings', 'warning_number', 'UPDATE');
  ASSERT NOT has_column_privilege('service_role', 'public.agentx_group_events', 'source_message_id', 'UPDATE');

  INSERT INTO public.group_rules(user_id,group_jid,anti_link,proof_intake_enabled) VALUES (tenant,gid,true,true);
  PERFORM public.agentx_set_group_policy(tenant,gid,policy,hours);
  ASSERT (SELECT anti_link AND proof_intake_enabled AND blocked_words = ARRAY['palavra abusiva']
    AND allowed_link_hosts = ARRAY['example.com'] AND warning_limit = 2
    FROM public.group_rules WHERE user_id = tenant AND group_jid = gid);
  SELECT next_run_at INTO next_before FROM public.agentx_group_hours WHERE user_id = tenant AND group_jid = gid;
  PERFORM public.agentx_set_group_policy(tenant,gid,policy,hours);
  ASSERT (SELECT next_run_at = next_before FROM public.agentx_group_hours WHERE user_id = tenant AND group_jid = gid);

  BEGIN
    PERFORM public.agentx_set_group_policy(tenant,gid,policy,jsonb_set(hours,'{timezone}','"Not/Available"'));
    RAISE EXCEPTION 'invalid timezone was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_set_group_policy(tenant,gid,policy,jsonb_set(hours,'{days}','[1,1]'));
    RAISE EXCEPTION 'duplicate weekdays were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  INSERT INTO public.agentx_group_warnings(user_id,group_jid,participant_jid,source_message_id,rule,warning_number,warning_limit,status,created_at)
    VALUES (tenant,gid,member,'message-expired','word',1,2,'sent',clock_timestamp()-interval '25 hours');
  warning := public.agentx_claim_group_warning(tenant,gid,member,'message-one','word');
  ASSERT warning->>'status' = 'pending' AND warning->>'warning_number' = '1';
  ASSERT public.agentx_claim_group_warning(tenant,gid,member,'message-one','word') IS NULL;
  UPDATE public.agentx_group_warnings SET status = 'sent' WHERE id = (warning->>'id')::uuid;
  warning := public.agentx_claim_group_warning(tenant,gid,member,'message-two','spam');
  ASSERT warning->>'status' = 'pending' AND warning->>'warning_number' = '2';
  warning := public.agentx_claim_group_warning(tenant,gid,member,'message-three','spam');
  ASSERT warning->>'status' = 'recorded' AND warning->>'warning_number' = '3';
  warning := public.agentx_claim_group_warning(tenant,gid,'258841234568@s.whatsapp.net','message-four','word');
  ASSERT warning->>'status' = 'pending' AND warning->>'warning_number' = '1';
  ASSERT public.agentx_claim_group_warning(other,gid,member,'message-one','word') IS NULL;
  PERFORM public.agentx_set_group_policy(other,gid,policy,NULL);
  warning := public.agentx_claim_group_warning(other,gid,member,'message-one','word');
  ASSERT warning->>'warning_number' = '1';
  INSERT INTO public.agentx_group_events(user_id,group_jid,rule,outcome) VALUES (tenant,gid,'word','accepted'), (tenant,gid,'word','accepted');
  INSERT INTO public.agentx_group_events(user_id,group_jid,source_message_id,rule,outcome)
    VALUES (tenant,gid,'deleted-one','word','pending') RETURNING id INTO event_id;
  UPDATE public.agentx_group_events SET outcome = 'accepted' WHERE id = event_id AND outcome = 'pending';
  INSERT INTO public.agentx_group_events(user_id,group_jid,source_message_id,rule,outcome)
    VALUES (tenant,gid,'deleted-one','word','pending') ON CONFLICT (user_id,group_jid,source_message_id) DO NOTHING;
  ASSERT NOT FOUND;
  INSERT INTO public.agentx_group_events(user_id,group_jid,source_message_id,rule,outcome)
    VALUES (other,gid,'deleted-one','word','pending') ON CONFLICT (user_id,group_jid,source_message_id) DO NOTHING;
  ASSERT FOUND;

  SELECT * INTO claim FROM public.agentx_claim_group_hours(open_at + interval '10 minutes')
    WHERE user_id = tenant AND group_jid = gid;
  ASSERT claim.claim_token IS NOT NULL AND NOT claim.announce;
  ASSERT NOT EXISTS (SELECT 1 FROM public.agentx_claim_group_hours(open_at + interval '10 minutes') WHERE user_id = tenant AND group_jid = gid);
  ASSERT NOT public.agentx_finish_group_hours(other,gid,claim.claim_token,'confirmed',open_at + interval '10 minutes');
  BEGIN
    PERFORM public.agentx_set_group_policy(tenant,gid,policy,NULL);
    RAISE EXCEPTION 'active lease was changed';
  EXCEPTION WHEN lock_not_available THEN NULL;
  END;
  ASSERT public.agentx_finish_group_hours(tenant,gid,claim.claim_token,'retry',open_at + interval '10 minutes');
  ASSERT NOT public.agentx_finish_group_hours(tenant,gid,claim.claim_token,'confirmed',open_at + interval '10 minutes');
  ASSERT (SELECT next_run_at = open_at + interval '13 minutes' AND last_outcome = 'retry'
    FROM public.agentx_group_hours WHERE user_id = tenant AND group_jid = gid);

  -- Catch up once after missing the retry window and closing boundary.
  SELECT * INTO later_claim FROM public.agentx_claim_group_hours(close_at + interval '1 hour') WHERE user_id = tenant AND group_jid = gid;
  ASSERT later_claim.claim_token IS NOT NULL AND later_claim.announce;
  ASSERT public.agentx_finish_group_hours(tenant,gid,later_claim.claim_token,'confirmed',close_at + interval '1 hour');
  ASSERT (SELECT next_run_at = open_at + interval '7 days' AND last_outcome = 'confirmed'
    FROM public.agentx_group_hours WHERE user_id = tenant AND group_jid = gid);

  PERFORM public.agentx_set_group_policy(tenant,second_gid,policy,overnight);
  SELECT * INTO claim FROM public.agentx_claim_group_hours(after_midnight) WHERE user_id = tenant AND group_jid = second_gid;
  ASSERT claim.claim_token IS NOT NULL AND NOT claim.announce;
  ASSERT public.agentx_finish_group_hours(tenant,second_gid,claim.claim_token,'confirmed',after_midnight + interval '2 hours');
  -- Completion crossing the closing boundary schedules immediate reconciliation.
  SELECT * INTO later_claim FROM public.agentx_claim_group_hours(after_midnight + interval '2 hours') WHERE user_id = tenant AND group_jid = second_gid;
  ASSERT later_claim.claim_token IS NOT NULL AND later_claim.announce;
  ASSERT public.agentx_finish_group_hours(tenant,second_gid,later_claim.claim_token,'confirmed',after_midnight + interval '2 hours');
  PERFORM public.agentx_set_group_policy(tenant,second_gid,policy,NULL);
  ASSERT (SELECT NOT enabled AND next_run_at IS NULL AND opens_at = '22:00'::time
    FROM public.agentx_group_hours WHERE user_id = tenant AND group_jid = second_gid);
END;
$$;

ROLLBACK;

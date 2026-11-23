BEGIN;

DO $$
DECLARE
  owner uuid := '90000000-0000-4000-8000-000000000001';
  outsider uuid := '90000000-0000-4000-8000-000000000002';
  booking_id uuid;
  revision uuid;
  scheduled timestamptz := now() + interval '3 hours';
  local_start timestamp := scheduled AT TIME ZONE 'Africa/Maputo';
  notification_id uuid;
  claim jsonb;
BEGIN
  ASSERT public.agentx_appointment_contract_ready();
  ASSERT NOT has_function_privilege('authenticated', 'public.agentx_save_appointment(uuid,uuid,jsonb,boolean)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.agentx_available_appointment_slots(uuid,uuid,uuid,date)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.agentx_finish_appointment_notification(uuid,uuid,text,text)', 'EXECUTE');
  ASSERT NOT has_table_privilege('authenticated', 'public.appointments', 'INSERT,UPDATE,DELETE');
  ASSERT NOT has_table_privilege('authenticated', 'public.agentx_appointment_notifications', 'SELECT');

  INSERT INTO public.appointments (user_id, customer_name, customer_phone, appointment_date,
    start_time, end_time, start_at, time_zone)
  VALUES (owner, 'Lembrete', '258840001122', local_start::date, to_char(local_start, 'HH24:MI'),
    to_char(local_start + interval '30 minutes', 'HH24:MI'), scheduled, 'Africa/Maputo')
  RETURNING id, schedule_revision INTO booking_id, revision;

  ASSERT public.agentx_claim_appointment_notification(outsider, booking_id, revision, 'reminder_24h')->>'status' = 'ineligible';
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, gen_random_uuid(), 'reminder_24h')->>'status' = 'ineligible';
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_2h')->>'status' = 'ineligible';
  claim := public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_24h');
  ASSERT claim->>'status' = 'claimed';
  notification_id := (claim->>'id')::uuid;
  ASSERT (claim->'appointment'->>'start_at')::timestamptz = scheduled;
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_24h')->>'status' = 'sending';
  ASSERT NOT public.agentx_finish_appointment_notification(outsider, notification_id, 'sent', 'other-account');

  BEGIN
    PERFORM public.agentx_finish_appointment_notification(owner, notification_id, 'sent', ' ');
    RAISE EXCEPTION 'A blank provider acknowledgement was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  ASSERT public.agentx_finish_appointment_notification(owner, notification_id, 'retry', NULL);
  ASSERT (SELECT NOT reminder_24h_sent FROM public.appointments WHERE id = booking_id);
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_24h')->>'status' = 'retry';
  UPDATE public.agentx_appointment_notifications SET available_at = now() - interval '1 second' WHERE id = notification_id;
  claim := public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_24h');
  ASSERT claim->>'status' = 'claimed' AND (claim->>'id')::uuid = notification_id;
  ASSERT (SELECT attempts = 2 FROM public.agentx_appointment_notifications WHERE id = notification_id);
  ASSERT public.agentx_finish_appointment_notification(owner, notification_id, 'sent', 'fixture-whatsapp-ack');
  ASSERT NOT public.agentx_finish_appointment_notification(owner, notification_id, 'retry', NULL);
  ASSERT (SELECT reminder_24h_sent AND NOT reminder_2h_sent FROM public.appointments WHERE id = booking_id);
  ASSERT (SELECT whatsapp_message_id = 'fixture-whatsapp-ack' FROM public.agentx_appointment_notifications WHERE id = notification_id);
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, revision, 'reminder_24h')->>'status' = 'sent';

  claim := public.agentx_claim_appointment_notification(owner, booking_id, revision, 'manual');
  ASSERT claim->>'status' = 'claimed';
  UPDATE public.agentx_appointment_notifications SET updated_at = now() - interval '3 minutes' WHERE id = (claim->>'id')::uuid;
  ASSERT public.agentx_claim_appointment_notification(owner, booking_id, revision, 'manual')->>'status' = 'uncertain';
  ASSERT (SELECT attempts = 1 FROM public.agentx_appointment_notifications WHERE id = (claim->>'id')::uuid);
END;
$$;

ROLLBACK;

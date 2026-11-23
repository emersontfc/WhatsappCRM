ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY test_schedule_legacy_read ON public.scheduled_messages FOR SELECT TO authenticated USING (true);

INSERT INTO public.scheduled_messages (id, user_id, phone, message, scheduled_at, status)
VALUES ('00000000-0000-4000-8000-000000000090', '00000000-0000-4000-8000-000000000001',
        '258841234567', 'Agendamento anterior', now() + interval '1 day', 'pending');

DO $$
DECLARE
  missing_column text;
BEGIN
  INSERT INTO public.scheduled_messages (user_id, target_type, group_jid, message, scheduled_at, status)
  VALUES ('00000000-0000-4000-8000-000000000001', 'group', '12345@g.us', 'Aviso', now(), 'pending');
  RAISE EXCEPTION 'Expected to reproduce the legacy NOT NULL failure';
EXCEPTION WHEN not_null_violation THEN
  GET STACKED DIAGNOSTICS missing_column = COLUMN_NAME;
  PERFORM public.test_assert(missing_column = 'phone', 'reproduced the production error on phone');
END;
$$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

SELECT public.test_assert(
  (SELECT phone FROM public.scheduled_messages WHERE id = '00000000-0000-4000-8000-000000000090') = '258841234567',
  'existing scheduled phone and row survive the migration');

INSERT INTO public.scheduled_messages (user_id, contact_id, target_type, message, scheduled_at, status)
VALUES (auth.uid(), '00000000-0000-4000-8000-000000000081', 'contact', 'Mensagem', now() + interval '1 day', 'pending');
INSERT INTO public.scheduled_messages (user_id, target_type, group_jid, message, scheduled_at, status)
VALUES (auth.uid(), 'group', '12345@g.us', 'Aviso', now() + interval '1 day', 'pending');
INSERT INTO public.scheduled_status (user_id, caption, scheduled_at, status)
VALUES (auth.uid(), 'Status de texto', now() + interval '1 day', 'pending');

SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.scheduled_messages), 'another account cannot see schedules');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.scheduled_status), 'another account cannot see status drafts');
DO $$
BEGIN
  INSERT INTO public.scheduled_messages (user_id, phone, message, scheduled_at, status)
  VALUES ('00000000-0000-4000-8000-000000000001', '258841234567', 'Mensagem', now(), 'pending');
  RAISE EXCEPTION 'another account could insert a schedule';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;
RESET ROLE;
RESET request.jwt.claim.sub;

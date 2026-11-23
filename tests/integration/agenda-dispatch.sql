SET ROLE service_role;
SELECT public.test_assert(public.agentx_schedule_dispatch_ready(), 'agenda dispatch migrations available');
SELECT public.test_assert(NOT has_function_privilege('authenticated', 'public.agentx_expire_agenda_claims()', 'EXECUTE'),
  'only the service role expires Agenda claims');
DO $$
DECLARE
  owner_id uuid := '00000000-0000-4000-8000-000000000001';
  other_id uuid := '00000000-0000-4000-8000-000000000002';
  request_id uuid := gen_random_uuid();
  blocked_id uuid;
  stale_id uuid;
  active_id uuid;
  status_id uuid;
  recurring_id uuid;
  due timestamptz := now() - interval '30 minutes';
BEGIN
  INSERT INTO public.scheduled_messages(user_id,message,scheduled_at,status,request_key,retry_at)
  VALUES (owner_id,'Reagendado',due,'pending',request_id,now() + interval '5 minutes') RETURNING id INTO blocked_id;

  BEGIN
    INSERT INTO public.scheduled_messages(user_id,message,scheduled_at,status,request_key)
    VALUES (owner_id,'Repetição do pedido',due,'pending',request_id);
    RAISE EXCEPTION 'agenda duplicate request was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.scheduled_messages(user_id,message,scheduled_at,status,request_key)
    VALUES (other_id,'Pedido da outra conta',due,'pending',request_id);

  INSERT INTO public.scheduled_messages(user_id,message,scheduled_at,status,dispatch_started_at,dispatch_token)
  VALUES (owner_id,'Envio interrompido',due,'processing',due,gen_random_uuid()) RETURNING id INTO stale_id;
  INSERT INTO public.scheduled_messages(user_id,message,scheduled_at,status,dispatch_started_at,dispatch_token)
  VALUES (owner_id,'Envio ativo',due,'processing',now(),gen_random_uuid()) RETURNING id INTO active_id;
  INSERT INTO public.scheduled_status(user_id,caption,scheduled_at,status)
  VALUES (owner_id,'Publicação antiga',due,'processing') RETURNING id INTO status_id;

  IF public.agentx_expire_agenda_claims() <> 2 THEN RAISE EXCEPTION 'wrong number of interrupted Agenda jobs'; END IF;
  IF public.agentx_expire_agenda_claims() <> 0 THEN RAISE EXCEPTION 'claim expiry not idempotent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_messages
    WHERE id=stale_id AND status='failed' AND dispatch_token IS NULL AND error ILIKE '%confirma%')
    THEN RAISE EXCEPTION 'stale send was not marked uncertain'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_status WHERE id=status_id AND status='failed')
    THEN RAISE EXCEPTION 'legacy status claim not expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_messages WHERE id=active_id AND status='processing')
    THEN RAISE EXCEPTION 'live claim was improperly expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_messages
    WHERE id=blocked_id AND scheduled_at=due AND retry_at > now() AND status='pending')
    THEN RAISE EXCEPTION 'expected future retry and original schedule date'; END IF;

  INSERT INTO public.scheduled_messages(user_id,target_type,group_jid,group_name,message,scheduled_at,status,
    media_url,media_type,media_mimetype,media_filename,repeat_days,repeat_zone,repeat_anchor_at)
  VALUES (owner_id,'group','12345@g.us','Promoções','Oferta da semana',now(),'processing',
    'https://storage.example/flyer.png','image','image/png','flyer.png',7,'Africa/Maputo',now())
  RETURNING id INTO recurring_id;
  UPDATE public.scheduled_messages SET status='sent' WHERE id=recurring_id;
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_messages WHERE repeat_from=recurring_id AND user_id=owner_id
    AND target_type='group' AND group_jid='12345@g.us' AND status='pending'
    AND media_url='https://storage.example/flyer.png' AND media_type='image'
    AND media_mimetype='image/png' AND media_filename='flyer.png')
    THEN RAISE EXCEPTION 'recurring group post lost its attachment'; END IF;
END;
$$;
RESET ROLE;

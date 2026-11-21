SET ROLE authenticated;
SELECT public.test_assert(
 NOT has_function_privilege(current_user,'public.agentx_whatsapp_create_order(uuid,uuid,integer,text,text,uuid,text,text,text)','EXECUTE'),
 'browser cannot create a commercial order directly');
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.agentx_group_events','SELECT'), 'group log uses account-scoped API');
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE
 account_a uuid := '00000000-0000-4000-8000-000000000001';
 account_b uuid := '00000000-0000-4000-8000-000000000002';
 contact_a uuid := '00000000-0000-4000-8000-000000000081';
 product_id_found uuid := (SELECT id FROM public.products WHERE user_id=account_a LIMIT 1);
 lead_found uuid;
 order_found uuid;
 offer jsonb;
 stock_before integer;
BEGIN
 lead_found := public.agentx_capture_sales_lead(account_a,'841234567',contact_a,'Cliente','catalog','Quero ver o livro');
 PERFORM public.test_assert(lead_found=public.agentx_capture_sales_lead(account_a,'258841234567',contact_a,'Cliente','interest','Interesse no livro'), 'phone variants reuse the lead');
 BEGIN
   PERFORM public.agentx_capture_sales_lead(account_b,'258841234567',contact_a,'Cliente','catalog',NULL);
   RAISE 'contact ownership not checked';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;

 SELECT stock INTO stock_before FROM public.products WHERE id=product_id_found;
 offer := public.agentx_whatsapp_create_order(account_a,product_id_found,2,'258841234567','Cliente',contact_a,'mpesa','AGX-WA-1','whatsapp-message-1');
 order_found := (offer->>'id')::uuid;
 PERFORM public.test_assert((offer->>'lead_id')::uuid=lead_found AND offer->>'status'='awaiting_payment','one pending order linked to lead');
 PERFORM public.test_assert((public.agentx_whatsapp_create_order(account_a,product_id_found,2,'258841234567','Cliente',contact_a,'mpesa','AGX-WA-2','whatsapp-message-1')->>'id')::uuid=order_found,'replayed WhatsApp message returns original order');
 PERFORM public.test_assert((SELECT count(*) FROM public.agent_operations a WHERE a.order_id=order_found)=1,'one creation audit');
 PERFORM public.test_assert((SELECT stage FROM public.leads WHERE id=lead_found)='proposta_enviada','pending sale advances the lead without closing it');
 UPDATE public.orders SET status='verification_pending' WHERE id=order_found;
 INSERT INTO public.payment_verifications(order_id,user_id,customer_phone) VALUES(order_found,account_a,'258841234567');
 PERFORM public.agentx_catalog_approve_order(account_a,order_found,'Verified');
 PERFORM public.agentx_catalog_approve_order(account_a,order_found,'Repeat');
 PERFORM public.test_assert((SELECT stage FROM public.leads WHERE id=lead_found)='venda_fechada','owner approval closes the sale');
 PERFORM public.test_assert((SELECT stock FROM public.products WHERE id=product_id_found)=stock_before-2,'stock decremented once');
 PERFORM public.agentx_capture_sales_lead(account_a,'258841234567',contact_a,'Cliente','catalog',NULL);
 PERFORM public.test_assert((SELECT stage FROM public.leads WHERE id=lead_found)='venda_fechada','later inquiry does not regress sold lead');
END;
$$;

DO $$
DECLARE
 account uuid := '00000000-0000-4000-8000-000000000001';
 first_status uuid := gen_random_uuid();
 failed_status uuid := gen_random_uuid();
 group_post uuid := gen_random_uuid();
 anchor timestamptz := now()+interval '9 days';
BEGIN
 INSERT INTO public.scheduled_status(id,user_id,caption,scheduled_at,status,repeat_days,repeat_zone,repeat_anchor_at)
 VALUES(first_status,account,'Weekly',anchor,'processing',7,'Europe/Lisbon',anchor),
       (failed_status,account,'Daily',anchor,'processing',1,'Africa/Maputo',anchor);
 UPDATE public.scheduled_status SET status='failed' WHERE id=failed_status;
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.scheduled_status WHERE repeat_from=failed_status),'failed publication does not start next occurrence');
 UPDATE public.scheduled_status SET status='sent' WHERE id=first_status;
 UPDATE public.scheduled_status SET status='sent' WHERE id=first_status;
 PERFORM public.test_assert((SELECT count(*) FROM public.scheduled_status WHERE repeat_from=first_status)=1,'one successor for acknowledged publication');
 PERFORM public.test_assert(
   (SELECT scheduled_at AT TIME ZONE 'Europe/Lisbon' FROM public.scheduled_status WHERE repeat_from=first_status)
   =(anchor AT TIME ZONE 'Europe/Lisbon')+interval '7 days','weekly repeat preserves the configured local hour');
 INSERT INTO public.scheduled_messages(id,user_id,target_type,group_jid,group_name,message,scheduled_at,status,repeat_days,repeat_zone,repeat_anchor_at)
 VALUES(group_post,account,'group','12345@g.us','Grupo','Aviso',anchor,'processing',1,'Africa/Maputo',anchor);
 UPDATE public.scheduled_messages SET status='sent' WHERE id=group_post;
 PERFORM public.test_assert((SELECT count(*) FROM public.scheduled_messages WHERE repeat_from=group_post
 AND group_jid='12345@g.us' AND target_type='group' AND message='Aviso' AND status='pending')
 =1,'group announcement recurrence preserves destination and text');
END;
$$;
RESET ROLE;

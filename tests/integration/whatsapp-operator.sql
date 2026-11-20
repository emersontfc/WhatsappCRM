INSERT INTO public.contacts(id,user_id)
VALUES ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001');

SET ROLE authenticated;
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.whatsapp_contact_alerts','SELECT'), 'browser cannot query alert history');
SELECT public.test_assert(NOT has_function_privilege(current_user,'public.agentx_claim_contact_alert(uuid,uuid)','EXECUTE'), 'alert claim is service only');
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE
 owner_id uuid := '00000000-0000-4000-8000-000000000001';
 other_id uuid := '00000000-0000-4000-8000-000000000002';
 contact uuid := '00000000-0000-4000-8000-000000000081';
BEGIN
 PERFORM public.test_assert(NOT public.agentx_claim_contact_alert(owner_id,contact), 'alerts are opt-in');
 INSERT INTO public.whatsapp_operator_settings VALUES (owner_id,true),(other_id,true);
 PERFORM public.test_assert(NOT public.agentx_claim_contact_alert(other_id,contact), 'another account cannot claim contact');
 PERFORM public.test_assert(public.agentx_claim_contact_alert(owner_id,contact), 'first alert claimed');
 PERFORM public.test_assert(NOT public.agentx_claim_contact_alert(owner_id,contact), 'repeats suppressed inside cooldown');
 UPDATE public.whatsapp_contact_alerts SET last_alert_at=now()-interval '31 minutes' WHERE user_id=owner_id;
 PERFORM public.test_assert(public.agentx_claim_contact_alert(owner_id,contact), 'claim eligible after cooldown');
END;
$$;
RESET ROLE;

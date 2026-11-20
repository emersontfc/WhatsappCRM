CREATE FUNCTION public.test_assert(value boolean, description text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', description; END IF;
END;
$$;

SET ROLE service_role;
SELECT public.agentx_create_organization('00000000-0000-4000-8000-000000000001','Tenant A','tenant-a') AS org_a \gset
SELECT public.agentx_create_organization('00000000-0000-4000-8000-000000000002','Tenant B','tenant-b') AS org_b \gset
SELECT public.agentx_set_member(:'org_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','finance_admin');
SELECT set_config('agentx.test.org_a', :'org_a', false), set_config('agentx.test.org_b', :'org_b', false);
RESET ROLE;

INSERT INTO storage.objects VALUES ('agentx-v2-digital', :'org_a' || '/00000000-0000-4000-8000-000000000011');
SELECT public.test_assert(NOT public, 'asset bucket is private') FROM storage.buckets WHERE id = 'agentx-v2-digital';

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
SELECT public.test_assert((SELECT array_agg(id) FROM public.organizations) = ARRAY[:'org_a'::uuid], 'organization RLS scopes finance member');
SELECT public.test_assert((SELECT count(*) = 1 FROM public.organization_members), 'membership RLS scopes current user');
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.organization_members','UPDATE'), 'no browser member mutations');
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.agentx_payment_proofs','SELECT'), 'proof records are private');
SELECT public.test_assert((SELECT count(*) = 0 FROM storage.objects), 'restrictive policy blocks broad legacy object access');
SELECT public.test_assert((SELECT count(*) = 0 FROM storage.buckets), 'restrictive policy blocks broad legacy bucket access');
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.agentx_digital_deliveries','SELECT'), 'deliveries are private');
SELECT public.test_assert(NOT has_function_privilege(current_user,'public.agentx_review_payment(uuid,uuid,uuid,text,text,text,text)','EXECUTE'), 'review callable only by service');
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE
 a uuid := current_setting('agentx.test.org_a')::uuid;
 b uuid := current_setting('agentx.test.org_b')::uuid;
 owner_a uuid := '00000000-0000-4000-8000-000000000001';
 owner_b uuid := '00000000-0000-4000-8000-000000000002';
 customer uuid := '00000000-0000-4000-8000-000000000003';
 reviewer uuid := '00000000-0000-4000-8000-000000000004';
 outsider uuid := '00000000-0000-4000-8000-000000000005';
 asset uuid := '00000000-0000-4000-8000-000000000011';
 order_a uuid := '00000000-0000-4000-8000-000000000021';
 order_b uuid := '00000000-0000-4000-8000-000000000022';
 order_c uuid := '00000000-0000-4000-8000-000000000023';
 proof_a uuid;
 proof_b uuid;
BEGIN
 BEGIN
   PERFORM public.agentx_set_member(a, outsider, outsider, 'finance_admin');
   RAISE 'outsider assigned role';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_create_digital_order(b, owner_b, order_b, customer, '841234567', 25, 'MZN', asset);
   RAISE 'cross-tenant asset accepted';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 PERFORM public.agentx_create_digital_order(a, owner_a, order_a, customer, '841234567', 25, 'MZN', asset);
 PERFORM public.test_assert(public.agentx_create_digital_order(a, owner_a, order_a, customer, '841234567', 25, 'MZN', asset) = order_a, 'order creation retries');
 PERFORM public.agentx_create_digital_order(a, owner_a, order_b, customer, '841234567', 25, 'MZN', asset);
 PERFORM public.agentx_create_digital_order(a, owner_a, order_c, customer, '841234567', 25, 'MZN', asset);
 BEGIN
   PERFORM public.agentx_submit_proof(a, order_a, outsider, 'Recebeu 25.00 MT', 25, 'REF1');
   RAISE 'another customer submitted proof';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 proof_a := public.agentx_submit_proof(a, order_a, customer, 'Recebeu 25.00 MT', 25, 'REF1');
 PERFORM public.test_assert(public.agentx_submit_proof(a, order_a, customer, 'Recebeu 25.00 MT', 25, 'REF1') = proof_a, 'proof retry returns same ID');
 proof_b := public.agentx_submit_proof(a, order_b, customer, 'Recebeu 25.00 MT', 25, 'REF1');
 PERFORM public.test_assert((SELECT bool_and(repeated_proof) FROM public.agentx_pending_proofs(a, reviewer)), 'proof repeats flagged in finance inbox');
 PERFORM public.test_assert((SELECT status FROM public.agentx_orders WHERE id = order_a) = 'review_pending', 'extracted amount does not settle payment');
 PERFORM public.test_assert(public.agentx_process_digital_deliveries() = 0, 'no delivery while review pending');

 BEGIN
   PERFORM public.agentx_review_payment(a, proof_a, owner_b, 'approve', '', 'mpesa', 'REF1');
   RAISE 'cross-tenant approval accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_review_payment(b, proof_a, owner_b, 'approve', '', 'mpesa', 'REF1');
   RAISE 'cross-tenant proof visible';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_review_payment(a, proof_a, reviewer, 'approve', '', 'mpesa', NULL);
   RAISE 'approval accepted without verified settlement';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 PERFORM public.agentx_review_payment(a, proof_a, reviewer, 'approve', '', 'mpesa', 'REF1');
 PERFORM public.agentx_review_payment(a, proof_a, reviewer, 'approve', '', 'mpesa', 'REF1');
 PERFORM public.test_assert((SELECT count(*) = 1 FROM public.agentx_outbox WHERE organization_id = a), 'approval retry emits one event');
 PERFORM public.test_assert((SELECT reviewed_by = reviewer AND reviewed_at IS NOT NULL FROM public.agentx_payment_proofs WHERE id = proof_a), 'review has actor and timestamp');
 BEGIN
   PERFORM public.agentx_review_payment(a, proof_b, reviewer, 'approve', '', 'mpesa', 'REF1');
   RAISE 'duplicate settlement accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 PERFORM public.test_assert((SELECT status FROM public.agentx_payment_proofs WHERE id = proof_b) = 'pending', 'duplicate settlement rolls back review');
 PERFORM public.agentx_review_payment(a, proof_b, reviewer, 'reject', 'Duplicate settlement', NULL, NULL);
 PERFORM public.test_assert(public.agentx_submit_proof(a, order_b, customer, 'Recebeu 25.00 MT', 25, 'REF1') = proof_b, 'rejected proof retry cannot reopen order');
 PERFORM public.test_assert(public.agentx_get_digital_asset(a, order_a, customer) IS NULL, 'no access until worker grants delivery');
 BEGIN
   PERFORM public.agentx_process_digital_deliveries();
   RAISE EXCEPTION 'simulated worker crash' USING ERRCODE = '40001';
 EXCEPTION WHEN serialization_failure THEN NULL;
 END;
 PERFORM public.test_assert(public.agentx_get_digital_asset(a, order_a, customer) IS NULL, 'worker failure rolls back access');
 PERFORM public.test_assert(public.agentx_process_digital_deliveries() = 1, 'worker retry grants one delivery');
 PERFORM public.test_assert(public.agentx_process_digital_deliveries() = 0, 'worker replay does not duplicate delivery');
 PERFORM public.test_assert(public.agentx_get_digital_asset(a, order_a, customer) = a::text || '/' || asset::text, 'paid customer gets entitled file');
 PERFORM public.test_assert(public.agentx_get_digital_asset(a, order_a, outsider) IS NULL, 'another customer cannot download');
 PERFORM public.test_assert(public.agentx_get_digital_asset(b, order_a, customer) IS NULL, 'another tenant cannot download');
 PERFORM public.test_assert(public.agentx_get_digital_asset(a, order_b, customer) IS NULL, 'rejected order cannot download');
 PERFORM public.agentx_submit_proof(a, order_c, customer, 'Recebeu 25.00 MT outra referencia', 25, 'REF2');
END;
$$;
RESET ROLE;

UPDATE public.organizations SET status = 'suspended' WHERE id = :'org_a';
SET ROLE service_role;
SELECT public.test_assert(public.agentx_get_digital_asset(:'org_a','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000003') IS NULL, 'suspended tenant cannot mint download');
RESET ROLE;
UPDATE public.organizations SET status = 'active' WHERE id = :'org_a';

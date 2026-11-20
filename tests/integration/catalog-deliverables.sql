UPDATE public.products SET deliverable_path = user_id::text || '/sample-private-file',
 deliverable_name = 'livro.pdf', type = 'digital';
SET ROLE authenticated;
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.orders','UPDATE'), 'browser cannot approve legacy orders');
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.products','SELECT'), 'browser cannot read private catalog metadata');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='agentx-product-files'), 'legacy storage policy cannot reveal product bucket');
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE
 account_a uuid := '00000000-0000-4000-8000-000000000001';
 account_b uuid := '00000000-0000-4000-8000-000000000002';
 product uuid := (SELECT id FROM public.products WHERE user_id = account_a LIMIT 1);
 order_data jsonb;
 order_id uuid;
BEGIN
 BEGIN
   PERFORM public.agentx_catalog_create_order(account_b, product, 1, '841234567','Buyer',NULL,'mpesa','TEST-B');
   RAISE 'cross-tenant product accepted' USING ERRCODE = 'XX000';
 EXCEPTION WHEN raise_exception THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_catalog_create_order(account_a, product, 1000, '841234567','Buyer',NULL,'mpesa','TEST-A');
   RAISE 'invalid quantity accepted' USING ERRCODE = 'XX000';
 EXCEPTION WHEN raise_exception THEN NULL;
 END;
 order_data := public.agentx_catalog_create_order(account_a, product, 2, '841234567','Buyer',NULL,'mpesa','TEST-A');
 order_id := (order_data->>'id')::uuid;
 PERFORM public.test_assert((order_data->>'total_amount')::numeric = 50, 'order total uses database product price');
 UPDATE public.products SET deliverable_name = 'livro-novo.pdf' WHERE id = product;
 PERFORM public.test_assert(
   (SELECT deliverable_snapshot->>'name' FROM public.order_items i WHERE i.order_id = (order_data->>'id')::uuid) = 'livro.pdf',
   'order preserves attached file from purchase');
 BEGIN
   PERFORM public.agentx_catalog_approve_order(account_a, order_id, '');
   RAISE 'order approved without pending proof' USING ERRCODE = 'XX000';
 EXCEPTION WHEN raise_exception THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_catalog_approve_order(account_b, order_id, '');
   RAISE 'other account approved order';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 UPDATE public.orders SET status = 'verification_pending' WHERE id = order_id;
 INSERT INTO public.payment_verifications(order_id,user_id,customer_phone) VALUES(order_id,account_a,'841234567');
 PERFORM public.test_assert(public.agentx_catalog_approve_order(account_a, order_id, 'Confirmed')->>'status' = 'paid', 'human approval marks order paid');
 PERFORM public.agentx_catalog_approve_order(account_a, order_id, 'Confirmed again');
 PERFORM public.test_assert((SELECT count(*) = 1 FROM public.agent_operations a WHERE a.order_id = (order_data->>'id')::uuid AND a.step = 'admin_approved'), 'approval audit is idempotent');
END;
$$;
RESET ROLE;

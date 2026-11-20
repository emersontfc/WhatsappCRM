SET ROLE service_role;
DO $$
DECLARE
 org_a uuid := (SELECT id FROM public.organizations WHERE slug = 'tenant-a');
 org_b uuid := (SELECT id FROM public.organizations WHERE slug = 'tenant-b');
 owner_a uuid := '00000000-0000-4000-8000-000000000001';
 owner_b uuid := '00000000-0000-4000-8000-000000000002';
 customer uuid := '00000000-0000-4000-8000-000000000003';
 reviewer uuid := '00000000-0000-4000-8000-000000000004';
 asset uuid := '00000000-0000-4000-8000-000000000011';
 order_id uuid := '00000000-0000-4000-8000-000000000024';
 proof uuid;
 pdf text := encode(convert_to('%PDF-1.7 fixture', 'UTF8'), 'base64');
BEGIN
 PERFORM public.agentx_create_digital_order(org_a, owner_a, order_id, customer, '841234567', 25, 'MZN', asset);
 BEGIN
   PERFORM public.agentx_submit_proof_attachment(org_a, order_id, owner_b, 'pdf', pdf);
   RAISE 'unrelated user uploaded an attachment';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_submit_proof_attachment(org_a, order_id, customer, 'png', pdf);
   RAISE 'incorrect file header accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 proof := public.agentx_submit_proof_attachment(org_a, order_id, customer, 'pdf', pdf);
 PERFORM public.test_assert(public.agentx_submit_proof_attachment(org_a, order_id, customer, 'pdf', pdf) = proof, 'same attachment retries safely');
 PERFORM public.test_assert((SELECT has_attachment FROM public.agentx_pending_proofs(org_a, reviewer) WHERE id = proof), 'queue advertises attached file');
 PERFORM public.test_assert(public.agentx_get_proof_attachment(org_a, proof, reviewer)->>'content' = pdf, 'reviewer can read attachment bytes');
 PERFORM public.test_assert(public.agentx_get_digital_asset(org_a, order_id, customer) IS NULL, 'attachment alone does not release order');
 BEGIN
   PERFORM public.agentx_get_proof_attachment(org_b, proof, owner_b);
   RAISE 'cross-tenant attachment readable';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 BEGIN
   PERFORM public.agentx_get_proof_attachment(org_a, proof, customer);
   RAISE 'buyer called reviewer-only operation';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END;
$$;
RESET ROLE;
SET ROLE authenticated;
SELECT public.test_assert(NOT has_table_privilege(current_user,'public.agentx_proof_attachments','SELECT'), 'browser cannot read attachment bytes directly');
RESET ROLE;

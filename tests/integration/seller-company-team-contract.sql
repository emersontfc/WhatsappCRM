BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at, deleted_at) VALUES
  ('00000000-0000-4000-8000-000000003701', 'team-owner@example.com', now(), NULL),
  ('00000000-0000-4000-8000-000000003702', 'team-operator@example.com', now(), NULL),
  ('00000000-0000-4000-8000-000000003703', 'team-finance@example.com', now(), NULL),
  ('00000000-0000-4000-8000-000000003704', 'team-other-owner@example.com', now(), NULL),
  ('00000000-0000-4000-8000-000000003705', 'team-unconfirmed@example.com', NULL, NULL),
  ('00000000-0000-4000-8000-000000003706', 'team-deleted@example.com', now(), now());
SET LOCAL ROLE service_role;

DO $$
DECLARE
  owner_id constant uuid := '00000000-0000-4000-8000-000000003701';
  operator_id constant uuid := '00000000-0000-4000-8000-000000003702';
  finance_id constant uuid := '00000000-0000-4000-8000-000000003703';
  other_owner constant uuid := '00000000-0000-4000-8000-000000003704';
  unconfirmed_id constant uuid := '00000000-0000-4000-8000-000000003705';
  buyer_phone constant text := '258849003701';
  other_phone constant text := '258849003702';
  company uuid;
  other_company uuid;
  product uuid;
  other_product uuid;
  purchase uuid;
  cancelled_purchase uuid;
  other_purchase uuid;
  pending_proof uuid;
  result jsonb;
  unavailable_email text;
  proof_payload jsonb := '{"provider":"mpesa","transaction_reference":"TEAM37PAY","amount":100,"sender_phone":"","sender_name":"","proof_type":"sms","proof_raw_text":"Referência TEAM37PAY. Transferiste 100 MT.","confidence_score":0.95,"extracted_data":{}}';
BEGIN
  IF public.agentx_seller_team_ready() IS DISTINCT FROM true
    OR has_table_privilege('authenticated', 'public.agentx_seller_organizations', 'SELECT')
    OR has_function_privilege('authenticated', 'public.agentx_seller_team_confirm_payment(uuid,uuid,uuid,text,boolean,text,text,uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Team contract or permissions failed readiness';
  END IF;

  result := public.agentx_seller_team_access(owner_id);
  IF result->>'organization_id' IS NOT NULL OR result->>'account_id' IS DISTINCT FROM owner_id::text THEN
    RAISE EXCEPTION 'Unlinked standalone owner changed scope';
  END IF;
  result := public.agentx_link_seller_organization(owner_id, NULL, 'Loja de teste');
  company := (result->>'organization_id')::uuid;
  IF company IS NULL OR result->>'account_id' IS DISTINCT FROM owner_id::text OR result->>'name' IS DISTINCT FROM 'Loja de teste'
    OR public.agentx_link_seller_organization(owner_id, NULL, 'Outro nome')->>'organization_id' IS DISTINCT FROM company::text THEN
    RAISE EXCEPTION 'Organization link failed or replay created a second link';
  END IF;

  other_company := public.agentx_create_organization(other_owner, 'Empresa anterior', 'seller-other-37');
  BEGIN
    PERFORM public.agentx_link_seller_organization(other_owner, NULL, 'Nova empresa duplicada');
    RAISE EXCEPTION 'Owner with an existing company should select it explicitly';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_link_seller_organization(other_owner, company);
    RAISE EXCEPTION 'Owner should not link another owner company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.agentx_link_seller_organization(other_owner, other_company);

  FOREACH unavailable_email IN ARRAY ARRAY['team-unconfirmed@example.com', 'team-deleted@example.com', 'operator@example.com'] LOOP
    BEGIN
      PERFORM public.agentx_seller_team_set_member(owner_id, company, 'operator', unavailable_email);
      RAISE EXCEPTION 'Unverified or partial mail should not be resolved';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;
  END LOOP;
  PERFORM public.agentx_set_member(company, owner_id, unconfirmed_id, 'finance_admin');
  IF EXISTS (SELECT 1 FROM public.agentx_seller_team_list(unconfirmed_id)) THEN
    RAISE EXCEPTION 'Unverified account appeared in the company list after legacy provisioning';
  END IF;
  BEGIN
    PERFORM public.agentx_seller_team_access(unconfirmed_id, company);
    RAISE EXCEPTION 'Unverified V2 member inherited scoped seller access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.agentx_seller_team_set_member(owner_id, company, NULL, NULL, unconfirmed_id);
  PERFORM public.agentx_seller_team_set_member(owner_id, company, 'operator', 'TEAM-OPERATOR@EXAMPLE.COM');
  PERFORM public.agentx_seller_team_set_member(owner_id, company, 'finance_admin', 'team-finance@example.com');
  IF public.agentx_seller_team_access(operator_id, company)->>'account_id' IS DISTINCT FROM owner_id::text
    OR public.agentx_seller_team_access(operator_id)->>'account_id' IS DISTINCT FROM operator_id::text
    OR NOT EXISTS (SELECT 1 FROM public.agentx_seller_team_list(finance_id) x WHERE x.organization_id = company AND x.role = 'finance_admin' AND x.linked)
    OR (SELECT count(*) FROM public.agentx_seller_team_members(owner_id, company)) <> 3 THEN
    RAISE EXCEPTION 'Memberships did not grant exactly the requested organization';
  END IF;
  BEGIN
    PERFORM * FROM public.agentx_seller_team_members(finance_id, company);
    RAISE EXCEPTION 'Finance must not list private member emails';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.products (user_id, name, price, stock, type) VALUES (owner_id, 'Produto local', 100, 2, 'physical') RETURNING id INTO product;
  INSERT INTO public.products (user_id, name, price, stock, type) VALUES (other_owner, 'Outro produto', 100, 1, 'physical') RETURNING id INTO other_product;
  purchase := (public.agentx_seller_create_order(owner_id, product, 1, buyer_phone, 'Cliente', NULL, NULL,
    'AGX-TEAM-PAY', 'team-contract-order')->>'id')::uuid;
  other_purchase := (public.agentx_seller_create_order(other_owner, other_product, 1, other_phone, 'Outro', NULL, NULL,
    'AGX-OTHER-TEAM-PAY', 'team-contract-other-order')->>'id')::uuid;
  pending_proof := (public.agentx_seller_submit_proof(owner_id, purchase, buyer_phone,
    'team-contract-first-proof', proof_payload)->>'id')::uuid;

  BEGIN
    PERFORM public.agentx_seller_team_confirm_payment(operator_id, company, purchase, 'Sem permissão', true, NULL, NULL, pending_proof);
    RAISE EXCEPTION 'Operator must not approve payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_seller_team_confirm_payment(finance_id, company, other_purchase, 'Fora da equipa', true);
    RAISE EXCEPTION 'Finance must not approve another company order';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_seller_team_confirm_payment(finance_id, company, purchase, 'Sem conferir', false, NULL, NULL, pending_proof);
    RAISE EXCEPTION 'Role does not replace human settlement verification';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  result := public.agentx_seller_team_reject_payment(finance_id, company, purchase, 'Não corresponde', pending_proof);
  IF result->>'notify' IS DISTINCT FROM 'true' OR result->'order'->>'status' IS DISTINCT FROM 'rejected'
    OR NOT EXISTS (SELECT 1 FROM public.payment_verifications v WHERE v.id = pending_proof AND v.reviewed_by = finance_id AND v.user_id = owner_id)
    OR NOT EXISTS (SELECT 1 FROM public.agent_operations a WHERE a.order_id = purchase AND a.step = 'admin_rejected' AND a.metadata->>'actorId' = finance_id::text) THEN
    RAISE EXCEPTION 'Delegated rejection did not retain owner scope and reviewer identity';
  END IF;

  pending_proof := (public.agentx_seller_submit_proof(owner_id, purchase, buyer_phone,
    'team-contract-second-proof', proof_payload)->>'id')::uuid;
  result := public.agentx_seller_team_confirm_payment(finance_id, company, purchase, 'Conferido no prestador', true, NULL, NULL, pending_proof);
  IF result->>'approved_by' IS DISTINCT FROM finance_id::text OR result->>'user_id' IS DISTINCT FROM owner_id::text
    OR NOT EXISTS (SELECT 1 FROM public.payment_verifications v WHERE v.id = pending_proof AND v.reviewed_by = finance_id AND v.status = 'approved')
    OR NOT EXISTS (SELECT 1 FROM public.agent_operations a WHERE a.order_id = purchase AND a.step = 'admin_approved' AND a.metadata->>'actorId' = finance_id::text) THEN
    RAISE EXCEPTION 'Delegated approval failed to record the real reviewer';
  END IF;
  PERFORM public.agentx_seller_team_confirm_payment(owner_id, company, purchase, 'Conferido no prestador', true, NULL, NULL, pending_proof);
  IF (SELECT stock FROM public.products WHERE id = product) <> 1
    OR (SELECT approved_by FROM public.orders WHERE id = purchase) IS DISTINCT FROM finance_id THEN
    RAISE EXCEPTION 'Payment replay changed stock or approval actor';
  END IF;
  BEGIN
    PERFORM public.agentx_seller_team_claim_delivery(finance_id, company, purchase, now());
    RAISE EXCEPTION 'Finance must not claim a manual delivery';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF public.agentx_seller_team_claim_delivery(operator_id, company, purchase, now()) IS DISTINCT FROM true
    OR public.agentx_seller_team_claim_delivery(operator_id, company, purchase, now()) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Operator delivery claim failed or replayed';
  END IF;
  PERFORM public.agentx_seller_team_confirm_delivery(operator_id, company, purchase);
  IF NOT EXISTS (SELECT 1 FROM public.agent_operations a WHERE a.order_id = purchase AND a.step = 'fulfilled' AND a.metadata->>'actorId' = operator_id::text) THEN
    RAISE EXCEPTION 'Manual delivery was not audited with the operator identity';
  END IF;

  cancelled_purchase := (public.agentx_seller_create_order(owner_id, product, 1, buyer_phone, 'Cliente', NULL, NULL,
    'AGX-TEAM-CANCEL', 'team-contract-order-cancel')->>'id')::uuid;
  BEGIN
    PERFORM public.agentx_seller_team_cancel_order(finance_id, company, cancelled_purchase);
    RAISE EXCEPTION 'Finance must not cancel sale';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.agentx_seller_team_cancel_order(operator_id, company, cancelled_purchase);
  IF NOT EXISTS (SELECT 1 FROM public.agent_operations a WHERE a.order_id = cancelled_purchase AND a.step = 'order_cancelled' AND a.metadata->>'actorId' = operator_id::text) THEN
    RAISE EXCEPTION 'Cancellation was not audited with the operator identity';
  END IF;

  PERFORM public.agentx_seller_team_set_member(owner_id, company, NULL, NULL, finance_id);
  BEGIN
    PERFORM public.agentx_seller_team_access(finance_id, company);
    RAISE EXCEPTION 'Revoked member still accesses company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.organizations SET status = 'suspended' WHERE id = company;
  BEGIN
    PERFORM public.agentx_seller_team_access(owner_id);
    RAISE EXCEPTION 'Linked owner bypassed suspended company via ambient personal scope';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

ROLLBACK;

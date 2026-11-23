BEGIN;

CREATE FUNCTION public.assert_group_proof_contract(result boolean, description text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF result IS DISTINCT FROM true THEN RAISE EXCEPTION '%', description; END IF;
END;
$$;

INSERT INTO public.orders(id, order_number, user_id, customer_phone, total_amount, status, payment_method)
VALUES ('00000000-0000-4000-8000-000000000081', 'AGX-A01', '00000000-0000-4000-8000-000000000001', '258840000001', 50, 'awaiting_payment', 'mpesa'),
  ('00000000-0000-4000-8000-000000000082', 'AGX-A02', '00000000-0000-4000-8000-000000000001', '258840000001', 50, 'awaiting_payment', 'mpesa'),
  ('00000000-0000-4000-8000-000000000083', 'AGX-B01', '00000000-0000-4000-8000-000000000002', '258840000001', 50, 'awaiting_payment', 'mpesa'),
  ('00000000-0000-4000-8000-000000000084', 'AGX-A03', '00000000-0000-4000-8000-000000000001', '258840000001', 50, 'awaiting_payment', 'mpesa');

SELECT public.assert_group_proof_contract(NOT has_function_privilege('authenticated',
  'public.agentx_submit_group_payment_proof(uuid,text,uuid,text,text,jsonb,jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon',
  'public.agentx_submit_group_payment_proof(uuid,text,uuid,text,text,jsonb,jsonb)', 'EXECUTE'), 'group proof intake RPC is service-only');
SELECT public.assert_group_proof_contract(NOT has_table_privilege('authenticated',
  'public.agentx_group_payment_attachments', 'SELECT') AND NOT has_table_privilege('anon',
  'public.agentx_group_payment_attachments', 'SELECT'), 'attachment metadata is service-only');
SELECT public.assert_group_proof_contract(NOT has_table_privilege('authenticated', 'public.group_rules', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.group_rules', 'UPDATE'), 'browser users cannot opt groups into receipt collection directly');

SET LOCAL ROLE service_role;
DO $$
DECLARE
  account_a uuid := '00000000-0000-4000-8000-000000000001';
  account_b uuid := '00000000-0000-4000-8000-000000000002';
  order_a1 uuid := '00000000-0000-4000-8000-000000000081';
  order_a2 uuid := '00000000-0000-4000-8000-000000000082';
  order_a3 uuid := '00000000-0000-4000-8000-000000000084';
  order_b1 uuid := '00000000-0000-4000-8000-000000000083';
  phone text := '258840000001';
  target_group text := '120363000000001@g.us';
  other_jid text := '120363000000002@g.us';
  group_source text := 'group:' || target_group || ':';
  evidence jsonb := jsonb_build_object('proof_raw_text', 'Comprovativo M-Pesa do pedido AGX-A01',
    'provider', 'mpesa', 'amount', 50, 'confidence_score', 0.98, 'transaction_reference', 'MPV000045');
  attachment jsonb := jsonb_build_object('path', account_a::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'name', 'recibo.pdf', 'mime', 'application/pdf', 'size', 12, 'sha256', repeat('a', 64));
  resent_attachment jsonb := attachment || jsonb_build_object('path', account_a::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  other_account_attachment jsonb := attachment || jsonb_build_object('path', account_b::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  original jsonb;
  repeated jsonb;
  other_order jsonb;
  other_account jsonb;
  text_proof jsonb;
  original_id uuid;
  current_state jsonb;
BEGIN
  PERFORM public.assert_group_proof_contract(public.agentx_group_proof_contract_ready(), 'migration contract is available');
  PERFORM public.assert_group_proof_contract((SELECT active AND anti_spam AND NOT proof_intake_enabled
    FROM public.group_rules r WHERE r.user_id = account_a AND r.group_jid = target_group),
    'existing moderation survives and group intake starts disabled');
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, phone, group_source || 'message1', evidence, attachment);
    RAISE EXCEPTION 'disabled group unexpectedly accepted proof';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.group_rules r SET proof_intake_enabled = true WHERE r.user_id = account_a AND r.group_jid = target_group;
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_b, target_group, order_b1, phone, group_source || 'message1', evidence, other_account_attachment);
    RAISE EXCEPTION 'enabling group for account A enabled account B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, other_jid, order_a1, phone,
      'group:' || other_jid || ':message1', evidence, attachment);
    RAISE EXCEPTION 'enabling one group enabled another';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, target_group, order_b1, phone, group_source || 'message1', evidence, attachment);
    RAISE EXCEPTION 'a tenant submitted proof for another tenant order';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, '258840000099', group_source || 'message1', evidence, attachment);
    RAISE EXCEPTION 'a different buyer submitted proof for an order';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, phone, group_source || 'message1', evidence, other_account_attachment);
    RAISE EXCEPTION 'another account attachment path was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  original := public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, phone, group_source || 'message1', evidence, attachment);
  original_id := (original->>'id')::uuid;
  PERFORM public.assert_group_proof_contract(original @> '{"created":true}', 'first group proof is recorded');
  repeated := public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, phone, group_source || 'message1', evidence, attachment);
  PERFORM public.assert_group_proof_contract(repeated = jsonb_build_object('created', false, 'id', original_id), 'message redelivery is idempotent');
  repeated := public.agentx_submit_group_payment_proof(account_a, target_group, order_a1, phone, group_source || 'message2',
    evidence || '{"proof_raw_text":"Legenda diferente para o mesmo ficheiro AGX-A01"}', resent_attachment);
  PERFORM public.assert_group_proof_contract(repeated = jsonb_build_object('created', false, 'id', original_id), 'resending an identical file on the same order is idempotent');
  PERFORM public.assert_group_proof_contract((SELECT count(*) = 1 FROM public.payment_verifications WHERE order_id = order_a1 AND user_id = account_a)
    AND (SELECT count(*) = 1 FROM public.agent_operations WHERE order_id = order_a1 AND user_id = account_a),
    'deduplicated messages do not create extra reviews or audit records');
  PERFORM public.assert_group_proof_contract((SELECT user_id = account_a AND storage_path = attachment->>'path' AND file_name = 'recibo.pdf'
    AND mime_type = 'application/pdf' AND size_bytes = 12 FROM public.agentx_group_payment_attachments WHERE verification_id = original_id),
    'only the original private attachment metadata is linked');
  PERFORM public.assert_group_proof_contract((SELECT status = 'pending' AND reviewed_by IS NULL AND proof_type = 'pdf'
    AND extracted_data @> jsonb_build_object('source', 'whatsapp_group', 'groupJid', target_group)
    FROM public.payment_verifications WHERE id = original_id), 'group submission creates a pending manual review');
  PERFORM public.assert_group_proof_contract((SELECT status = 'verification_pending' AND approved_at IS NULL AND delivery_started_at IS NULL
    AND fulfilled_at IS NULL FROM public.orders WHERE id = order_a1)
    AND NOT EXISTS (SELECT 1 FROM public.agentx_seller_settlements WHERE order_id = order_a1),
    'incoming evidence never settles an order or starts delivery');
  BEGIN
    PERFORM public.agentx_submit_group_payment_proof(account_a, target_group, order_a2, phone, group_source || 'message1', evidence, resent_attachment);
    RAISE EXCEPTION 'one group message created proofs for more than one order';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_seller_confirm_payment(account_a, order_a1, '', false, 'OFF-A001', 'mpesa', original_id, 50);
    RAISE EXCEPTION 'order settled without confirmation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  other_order := public.agentx_submit_group_payment_proof(account_a, target_group, order_a2, phone, group_source || 'message3',
    evidence || '{"proof_raw_text":"Outra legenda e outro pedido AGX-A02"}', resent_attachment);
  PERFORM public.assert_group_proof_contract(other_order @> '{"created":true}', 'another order can queue evidence for a human to inspect');
  current_state := public.agentx_seller_confirm_payment(account_a, order_a1, 'Recebido no prestador', true, 'OFF-A001', 'mpesa', original_id, 50);
  PERFORM public.assert_group_proof_contract(current_state @> '{"status":"paid","payment_reference":"OFF-A001"}',
    'manual confirmation settles the selected proof');
  BEGIN
    PERFORM public.agentx_seller_confirm_payment(account_a, order_a2, 'Recebido no prestador', true, 'OFF-A002', 'mpesa', (other_order->>'id')::uuid, 50);
    RAISE EXCEPTION 'same file approved against a second order';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM public.assert_group_proof_contract((SELECT status = 'verification_pending' FROM public.orders WHERE id = order_a2)
    AND NOT EXISTS (SELECT 1 FROM public.agentx_seller_settlements WHERE order_id = order_a2),
    'changing caption and official reference cannot settle the same file a second time within a tenant');

  UPDATE public.group_rules r SET proof_intake_enabled = true WHERE r.user_id = account_b AND r.group_jid = target_group;
  other_account := public.agentx_submit_group_payment_proof(account_b, target_group, order_b1, phone, group_source || 'message1',
    evidence || '{"proof_raw_text":"Original da outra loja AGX-B01"}', other_account_attachment);
  current_state := public.agentx_seller_confirm_payment(account_b, order_b1, 'Recebido no prestador', true, 'OFF-A001', 'mpesa', (other_account->>'id')::uuid, 50);
  PERFORM public.assert_group_proof_contract(current_state @> '{"status":"paid"}', 'evidence and reference deduplication are tenant scoped');

  text_proof := public.agentx_submit_group_payment_proof(account_a, target_group, order_a3, phone, group_source || 'message4',
    evidence || '{"proof_raw_text":"M-Pesa MPV000046: recebeste 50 MT pelo pedido AGX-A03","proof_type":"sms"}');
  PERFORM public.assert_group_proof_contract(text_proof @> '{"created":true}' AND EXISTS (SELECT 1 FROM public.payment_verifications
    WHERE id = (text_proof->>'id')::uuid AND status = 'pending' AND proof_type = 'sms' AND proof_media_url = '')
    AND NOT EXISTS (SELECT 1 FROM public.agentx_group_payment_attachments WHERE verification_id = (text_proof->>'id')::uuid),
    'a pasted receipt also creates a manual review without attachment metadata');
END;
$$;
RESET ROLE;

INSERT INTO storage.objects(bucket_id, name) VALUES ('agentx-group-proofs', 'private-receipt.pdf');
SET LOCAL ROLE authenticated;
SELECT public.assert_group_proof_contract((SELECT count(*) = 0 FROM storage.buckets WHERE id = 'agentx-group-proofs')
  AND (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'agentx-group-proofs')
  AND (SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'unrelated'), 'RLS hides only group proof storage from signed-in browsers');
DO $$
BEGIN
  INSERT INTO storage.objects(bucket_id, name) VALUES ('agentx-group-proofs', 'attempted-browser-write.pdf');
  RAISE EXCEPTION 'signed-in browser could upload to the private bucket';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;
SET LOCAL ROLE anon;
SELECT public.assert_group_proof_contract((SELECT count(*) = 0 FROM storage.buckets WHERE id = 'agentx-group-proofs')
  AND (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'agentx-group-proofs'), 'RLS hides group proof storage from anonymous browsers');
SET LOCAL ROLE service_role;
SELECT public.assert_group_proof_contract((SELECT NOT public AND file_size_limit = 5242880 FROM storage.buckets WHERE id = 'agentx-group-proofs')
  AND (SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'agentx-group-proofs'), 'service can read the private bucket and objects');
ROLLBACK;

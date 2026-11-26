BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000351', 'stock-owner@example.com'),
  ('00000000-0000-4000-8000-000000000352', 'stock-other@example.com');
SET LOCAL ROLE service_role;

DO $$
DECLARE
  owner_id constant uuid := '00000000-0000-4000-8000-000000000351';
  other_id constant uuid := '00000000-0000-4000-8000-000000000352';
  buyer_phone constant text := '258849000351';
  another_phone constant text := '258849000352';
  product uuid;
  before_id uuid;
  waiting_id uuid;
  legacy_id uuid;
  proof_id uuid;
  result jsonb;
  proof_payload jsonb := '{"provider":"mpesa","transaction_reference":"STOCK35A","amount":100,"sender_phone":"","sender_name":"","proof_type":"sms","proof_raw_text":"Transferencia confirmada STOCK35A no montante 100 MT.","confidence_score":0.95,"extracted_data":{}}';
BEGIN
  IF public.agentx_seller_reservations_ready() IS DISTINCT FROM true
    OR has_function_privilege('anon', 'public.agentx_seller_catalog_availability(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.agentx_seller_cancel_order(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Reservations contract unavailable or callable by a browser role';
  END IF;
  INSERT INTO public.products (user_id, name, price, currency, stock, type)
    VALUES (owner_id, 'Última unidade', 100, 'MT', 1, 'physical') RETURNING id INTO product;
  INSERT INTO public.agentx_seller_settings (user_id, payment_method, payment_recipient, recipient_name)
    VALUES (owner_id, 'mpesa', '258849000359', 'Loja original');

  BEGIN
    PERFORM public.agentx_seller_create_reserved_order(owner_id, product, 1, buyer_phone,
      'Cliente A', NULL, NULL, 'AGX-PRICE', 'stock-test-price', 99, 'MT');
    RAISE EXCEPTION 'Stale quote should have failed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Catalog price or currency changed' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.agentx_seller_create_reserved_order(owner_id, product, 1, buyer_phone,
      'Cliente A', NULL, 'emola', 'AGX-UNAVAILABLE-METHOD', 'stock-test-missing-destination', 100, 'MT');
    RAISE EXCEPTION 'Explicitly unavailable payment method should have failed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Payment destination unavailable' THEN RAISE; END IF;
  END;

  result := public.agentx_seller_create_reserved_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, 'mpesa', 'AGX-RESERVATION', 'stock-test-original', 100, 'mt');
  before_id := (result->>'id')::uuid;
  IF before_id IS NULL OR COALESCE((result->>'reservation_expires_at')::timestamptz, now()) < now() + interval '29 minutes'
    OR NOT EXISTS (SELECT 1 FROM public.agentx_seller_catalog_availability(owner_id) s
      WHERE s.product_id = product AND physical_stock = 1 AND reserved_stock = 1 AND available_stock = 0)
    OR EXISTS (SELECT 1 FROM public.agentx_seller_catalog_availability(other_id) s WHERE s.product_id = product) THEN
    RAISE EXCEPTION 'Reservation did not hold the last unit within the correct account';
  END IF;

  UPDATE public.agentx_seller_settings SET payment_method = 'emola',
    payment_destinations = '{"emola":{"recipient":"258869000359","name":"Loja nova"}}' WHERE user_id = owner_id;
  result := public.agentx_seller_create_reserved_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, 'mpesa', 'AGX-ORIGINAL-SNAPSHOT', 'stock-test-original', 100, 'MT');
  IF (result->>'id')::uuid IS DISTINCT FROM before_id OR result->'seller_payment'->>'recipient' IS DISTINCT FROM '258849000359' THEN
    RAISE EXCEPTION 'Replay lost the original payment snapshot after the merchant changed methods';
  END IF;
  result := public.agentx_seller_create_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, NULL, 'AGX-RETRY-DIFFERENT-NUMBER', 'stock-test-original');
  IF (result->>'id')::uuid IS DISTINCT FROM before_id THEN RAISE EXCEPTION 'Replay created a duplicate'; END IF;
  BEGIN
    PERFORM public.agentx_seller_create_order(owner_id, product, 2, buyer_phone,
      'Cliente A', NULL, NULL, 'AGX-WRONG-QUANTITY', 'stock-test-original');
    RAISE EXCEPTION 'Conflicting replay should have failed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_seller_create_order(owner_id, product, 1, another_phone,
      'Cliente B', NULL, NULL, 'AGX-SECOND-BUYER', 'stock-test-second');
    RAISE EXCEPTION 'Second buyer should have been blocked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Insufficient available stock' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.products SET stock = 0 WHERE id = product;
    RAISE EXCEPTION 'Stock edit should have been blocked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'O stock já está reservado para pedidos em curso' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.products WHERE id = product;
    RAISE EXCEPTION 'Deleting reserved product should have been blocked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'O stock já está reservado para pedidos em curso' THEN RAISE; END IF;
  END;

  result := public.agentx_seller_submit_proof(owner_id, before_id, buyer_phone, 'stock-test-proof-original', proof_payload);
  proof_id := (result->>'id')::uuid;
  UPDATE public.orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = before_id;
  IF NOT EXISTS (SELECT 1 FROM public.agentx_seller_catalog_availability(owner_id) s
    WHERE s.product_id = product AND reserved_stock = 1 AND available_stock = 0) THEN
    RAISE EXCEPTION 'Review failed to preserve the hold';
  END IF;
  BEGIN
    PERFORM public.agentx_seller_cancel_order(owner_id, before_id);
    RAISE EXCEPTION 'Review order should not be cancellable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  result := public.agentx_seller_confirm_payment(owner_id, before_id, 'Conferido no prestador', true, NULL, NULL, proof_id);
  PERFORM public.agentx_seller_confirm_payment(owner_id, before_id, 'Conferido no prestador', true, NULL, NULL, proof_id);
  IF result->>'status' IS DISTINCT FROM 'paid' OR NOT EXISTS (SELECT 1 FROM public.agentx_seller_catalog_availability(owner_id) s
    WHERE s.product_id = product AND physical_stock = 0 AND reserved_stock = 0 AND available_stock = 0) THEN
    RAISE EXCEPTION 'Confirmation did not consume the original hold exactly once';
  END IF;

  UPDATE public.products SET stock = 1 WHERE id = product;
  waiting_id := (public.agentx_seller_create_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, NULL, 'AGX-EXPIRE', 'stock-test-expire')->>'id')::uuid;
  UPDATE public.orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = waiting_id;
  IF NOT EXISTS (SELECT 1 FROM public.agentx_seller_catalog_availability(owner_id) s
    WHERE s.product_id = product AND reserved_stock = 0 AND available_stock = 1) THEN
    RAISE EXCEPTION 'Expired units are blocked without the worker';
  END IF;
  BEGIN
    PERFORM public.agentx_seller_submit_proof(owner_id, waiting_id, buyer_phone, 'stock-test-late-proof', proof_payload);
    RAISE EXCEPTION 'Late proof should have failed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Stock reservation expired' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.orders WHERE id = waiting_id) IS DISTINCT FROM 'awaiting_payment'
    OR EXISTS (SELECT 1 FROM public.payment_verifications WHERE order_id = waiting_id) THEN
    RAISE EXCEPTION 'Late proof persisted review side effects';
  END IF;
  PERFORM public.agentx_expire_seller_reservations();
  IF (SELECT status FROM public.orders WHERE id = waiting_id) IS DISTINCT FROM 'expired'
    OR NOT EXISTS (SELECT 1 FROM public.agent_operations WHERE order_id = waiting_id AND step = 'order_expired') THEN
    RAISE EXCEPTION 'Worker failed to audit the expired reservation';
  END IF;
  result := public.agentx_seller_cancel_order(owner_id, waiting_id);
  IF result->>'status' IS DISTINCT FROM 'expired' THEN RAISE EXCEPTION 'Cancellation changed an already expired order'; END IF;

  waiting_id := (public.agentx_seller_create_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, NULL, 'AGX-EXPIRED-CANCEL', 'stock-test-expired-cancel')->>'id')::uuid;
  UPDATE public.orders SET reservation_expires_at=clock_timestamp() - interval '1 second' WHERE id=waiting_id;
  result := public.agentx_seller_cancel_order(owner_id, waiting_id);
  IF result->>'status' IS DISTINCT FROM 'expired'
    OR (SELECT count(*) FROM public.agent_operations WHERE order_id=waiting_id AND step='order_expired') <> 1 THEN
    RAISE EXCEPTION 'Cancellation at the deadline did not record the expiration';
  END IF;

  before_id := (public.agentx_seller_create_order(owner_id, product, 1, buyer_phone,
    'Cliente A', NULL, NULL, 'AGX-REPLACE', 'stock-test-replace')->>'id')::uuid;
  proof_id := (public.agentx_seller_submit_proof(owner_id, before_id, buyer_phone, 'stock-test-first-proof', proof_payload)->>'id')::uuid;
  PERFORM public.agentx_seller_reject_proof(owner_id, before_id, proof_id, 'Dados não confirmados');
  waiting_id := (public.agentx_seller_create_order(owner_id, product, 1, another_phone,
    'Cliente B', NULL, NULL, 'AGX-AFTER-REJECT', 'stock-test-after-reject')->>'id')::uuid;
  BEGIN
    PERFORM public.agentx_seller_submit_proof(owner_id, before_id, buyer_phone, 'stock-test-replacement', proof_payload);
    RAISE EXCEPTION 'Replacement proof should not steal the second buyer hold';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Insufficient available stock' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.agentx_seller_cancel_order(other_id, waiting_id);
    RAISE EXCEPTION 'Cross-account cancellation should have failed';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM public.agentx_seller_cancel_order(owner_id, waiting_id);
  PERFORM public.agentx_seller_cancel_order(owner_id, waiting_id);
  IF (SELECT count(*) FROM public.agent_operations WHERE order_id = waiting_id AND step = 'order_cancelled') <> 1 THEN
    RAISE EXCEPTION 'Cancellation replay duplicated the audit';
  END IF;
  result := public.agentx_seller_submit_proof(owner_id, before_id, buyer_phone, 'stock-test-replacement', proof_payload);
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Replacement proof failed to reacquire released stock'; END IF;

  INSERT INTO public.orders (order_number, user_id, customer_phone, status, total_amount, tracks_catalog_stock)
    VALUES ('AGX-OLD-ORDER', owner_id, another_phone, 'verification_pending', 100, true) RETURNING id INTO legacy_id;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
    VALUES (legacy_id, product, 'Última unidade', 1, 100, 100);
  INSERT INTO public.payment_verifications (order_id, user_id, customer_phone, proof_raw_text)
    VALUES (legacy_id, owner_id, another_phone, 'Comprovativo legado com referência diferente.');
  BEGIN
    PERFORM public.agentx_catalog_approve_order(owner_id, legacy_id, 'Tentativa sem unidades livres');
    RAISE EXCEPTION 'Legacy order must not consume a newer hold';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Insufficient available stock' THEN RAISE; END IF;
  END;
  PERFORM public.agentx_seller_reject_order(owner_id, before_id, 'Dados não confirmados');
  result := public.agentx_catalog_approve_order(owner_id, legacy_id, 'Conferido no prestador');
  IF result->>'status' IS DISTINCT FROM 'paid' OR (SELECT stock FROM public.products WHERE id = product) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Legacy approval did not use the released stock';
  END IF;
END;
$$;

ROLLBACK;

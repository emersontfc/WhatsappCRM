BEGIN;

ALTER TABLE public.agentx_seller_settings
  ADD COLUMN IF NOT EXISTS payment_destinations jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Promote the old single destination without changing existing order snapshots.
UPDATE public.agentx_seller_settings s
SET payment_destinations = s.payment_destinations || jsonb_build_object(
  s.payment_method, jsonb_build_object('recipient', s.payment_recipient, 'name', s.recipient_name))
WHERE NOT (s.payment_destinations ? s.payment_method);

CREATE OR REPLACE FUNCTION public.agentx_seller_sync_payment_destinations()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  destination jsonb;
BEGIN
  IF jsonb_typeof(NEW.payment_destinations) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Destinos de pagamento inválidos' USING ERRCODE = '22023';
  END IF;
  -- Older versions send only the original columns. Keep those writes usable.
  IF (TG_OP = 'INSERT' AND NEW.payment_destinations = '{}'::jsonb) OR
    (TG_OP = 'UPDATE' AND NEW.payment_destinations IS NOT DISTINCT FROM OLD.payment_destinations
      AND (NEW.payment_method, NEW.payment_recipient, NEW.recipient_name)
        IS DISTINCT FROM (OLD.payment_method, OLD.payment_recipient, OLD.recipient_name)) THEN
    NEW.payment_destinations := NEW.payment_destinations || jsonb_build_object(
      NEW.payment_method, jsonb_build_object('recipient', NEW.payment_recipient, 'name', NEW.recipient_name));
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(NEW.payment_destinations) AS item(method, details)
    WHERE method NOT IN ('mpesa', 'emola', 'bank_transfer')
      OR jsonb_typeof(details) IS DISTINCT FROM 'object'
      OR jsonb_typeof(details->'recipient') IS DISTINCT FROM 'string'
      OR jsonb_typeof(details->'name') IS DISTINCT FROM 'string'
      OR length(btrim(details->>'recipient')) NOT BETWEEN 5 AND 60
      OR length(btrim(details->>'name')) NOT BETWEEN 2 AND 100
  ) THEN
    RAISE EXCEPTION 'Destinos de pagamento inválidos' USING ERRCODE = '22023';
  END IF;

  destination := NEW.payment_destinations->NEW.payment_method;
  IF destination IS NULL THEN
    RAISE EXCEPTION 'Configura o destino do método de pagamento predefinido' USING ERRCODE = '22023';
  END IF;
  NEW.payment_recipient := btrim(destination->>'recipient');
  NEW.recipient_name := btrim(destination->>'name');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_seller_sync_payment_destinations ON public.agentx_seller_settings;
CREATE TRIGGER agentx_seller_sync_payment_destinations
BEFORE INSERT OR UPDATE OF payment_destinations, payment_method, payment_recipient, recipient_name
ON public.agentx_seller_settings FOR EACH ROW EXECUTE FUNCTION public.agentx_seller_sync_payment_destinations();

ALTER TABLE public.agentx_seller_settlements
  ADD COLUMN IF NOT EXISTS proof_id uuid REFERENCES public.payment_verifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_seller_settlement_evidence_uidx
  ON public.agentx_seller_settlements (user_id, evidence_hash) WHERE evidence_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agentx_seller_evidence_hash(p_text text, p_media text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH normalized AS (
    SELECT NULLIF(regexp_replace(regexp_replace(lower(COALESCE(p_text, '')),
      '\m(pedido[[:space:]:#-]*)?agx-[a-z0-9]+(-[a-z0-9]+)*\M', ' ', 'g'), '[^[:alnum:]]', '', 'g'), '') AS proof_text,
      NULLIF(split_part(btrim(p_media), '?', 1), '') AS proof_media
  )
  SELECT encode(sha256(convert_to(
    CASE WHEN proof_text IS NOT NULL THEN 'text:' || proof_text
         WHEN proof_media IS NOT NULL THEN 'media:' || proof_media END, 'UTF8')), 'hex')
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_create_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  settings public.agentx_seller_settings%ROWTYPE;
  destination jsonb;
  chosen_method text;
  created jsonb;
  phone text := public.agentx_contact_phone(p_phone);
BEGIN
  SELECT * INTO settings FROM public.agentx_seller_settings WHERE user_id = p_user;
  IF FOUND THEN
    chosen_method := CASE WHEN settings.payment_destinations ? p_method THEN p_method ELSE settings.payment_method END;
    destination := settings.payment_destinations->chosen_method;
  ELSE
    chosen_method := COALESCE(p_method, 'mpesa');
  END IF;

  created := public.agentx_whatsapp_create_order(p_user, p_product, p_quantity, phone, p_customer,
    p_contact, chosen_method, p_order_number, p_source_message);
  IF public.agentx_contact_phone(created->>'customer_phone') IS DISTINCT FROM phone THEN
    RAISE EXCEPTION 'Pedido indisponível para este contacto' USING ERRCODE = '42501';
  END IF;
  IF destination IS NOT NULL AND created->>'order_number' = p_order_number AND created->>'seller_payment' IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product AND p.user_id = p_user
      AND p.type = 'digital' AND COALESCE(p.deliverable_path, '') NOT LIKE p_user::text || '/%'
      AND btrim(COALESCE(p.digital_content, '')) = '') THEN
      RAISE EXCEPTION 'Produto digital sem ficheiro ou conteúdo para entrega' USING ERRCODE = '22023';
    END IF;
    UPDATE public.orders AS o SET seller_payment = jsonb_build_object(
      'method', chosen_method, 'recipient', destination->>'recipient', 'name', destination->>'name')
    WHERE o.id = (created->>'id')::uuid AND o.user_id = p_user RETURNING to_jsonb(o) INTO created;
  END IF;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_confirm_payment(
  p_user uuid, p_order uuid, p_note text, p_verified boolean,
  p_reference text DEFAULT NULL, p_method text DEFAULT NULL, p_proof uuid DEFAULT NULL, p_amount numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_order public.orders%ROWTYPE;
  selected_proof public.payment_verifications%ROWTYPE;
  previous_settlement public.agentx_seller_settlements%ROWTYPE;
  selected_method text;
  snapshotted_method text;
  reference_display text := NULLIF(btrim(p_reference), '');
  normalized_reference text;
  fingerprint text;
  approved jsonb;
BEGIN
  IF p_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirma a liquidação no prestador antes de aprovar' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('mpesa', 'emola', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Método de pagamento inválido' USING ERRCODE = '22023';
  END IF;
  IF reference_display IS NOT NULL THEN
    normalized_reference := upper(regexp_replace(reference_display, '[^a-zA-Z0-9]', '', 'g'));
    IF reference_display !~ '^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{3,79}$' OR length(normalized_reference) < 4 THEN
      RAISE EXCEPTION 'Referência oficial inválida' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO current_order FROM public.orders WHERE id = p_order AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF p_amount IS NOT NULL AND p_amount <> current_order.total_amount THEN
    RAISE EXCEPTION 'O valor confirmado difere do total deste pedido' USING ERRCODE = '22023';
  END IF;
  IF current_order.status IN ('paid', 'fulfilled') THEN
    SELECT * INTO previous_settlement FROM public.agentx_seller_settlements
      WHERE order_id = p_order AND user_id = p_user;
    IF FOUND AND ((p_method IS NOT NULL AND p_method <> previous_settlement.method)
      OR (normalized_reference IS NOT NULL AND normalized_reference <> previous_settlement.reference_key)
      OR (p_proof IS NOT NULL AND previous_settlement.proof_id IS NOT NULL AND p_proof <> previous_settlement.proof_id)) THEN
      RAISE EXCEPTION 'Este pedido já foi confirmado com outros dados' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(current_order);
  END IF;

  IF current_order.status <> 'verification_pending' THEN
    RAISE EXCEPTION 'Pedido fora da fila de verificação' USING ERRCODE = '22023';
  END IF;
  IF current_order.total_amount IS NULL OR NOT (current_order.total_amount > 0 AND current_order.total_amount < 10000000000) THEN
    RAISE EXCEPTION 'O pedido não tem um valor válido para confirmar' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO selected_proof FROM public.payment_verifications v
  WHERE v.user_id = p_user AND v.order_id = p_order AND v.status = 'pending'
    AND (p_proof IS NULL OR v.id = p_proof)
  ORDER BY v.created_at DESC NULLS LAST, v.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido sem o comprovativo pendente indicado' USING ERRCODE = '22023';
  END IF;
  IF selected_proof.extracted_data->>'recipientMatch' = 'mismatch' THEN
    RAISE EXCEPTION 'O destinatário indicado no comprovativo difere do destino de pagamento do pedido' USING ERRCODE = '22023';
  END IF;
  IF selected_proof.confidence_score >= 0.80 AND selected_proof.amount > 0
    AND selected_proof.amount <> current_order.total_amount THEN
    RAISE EXCEPTION 'O valor indicado no comprovativo difere do total deste pedido' USING ERRCODE = '22023';
  END IF;

  snapshotted_method := current_order.seller_payment->>'method';
  IF snapshotted_method IS NOT NULL AND p_method IS NOT NULL AND snapshotted_method <> p_method THEN
    RAISE EXCEPTION 'O método difere do método apresentado neste pedido' USING ERRCODE = '22023';
  END IF;
  selected_method := COALESCE(snapshotted_method, p_method,
    CASE WHEN current_order.payment_method IN ('mpesa', 'emola', 'bank_transfer', 'other') THEN current_order.payment_method END,
    CASE WHEN selected_proof.provider IN ('mpesa', 'emola', 'bank_transfer') THEN selected_proof.provider END, 'other');

  -- Extracted references identify evidence but do not establish settlement.
  IF reference_display IS NULL AND selected_method IN ('mpesa', 'emola', 'bank_transfer')
    AND selected_proof.provider = selected_method
    AND selected_proof.confidence_score >= 0.80
    AND selected_proof.transaction_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{3,79}$' THEN
    normalized_reference := upper(regexp_replace(selected_proof.transaction_reference, '[^a-zA-Z0-9]', '', 'g'));
    IF length(normalized_reference) >= 4 THEN
      reference_display := selected_proof.transaction_reference;
    ELSE
      normalized_reference := NULL;
    END IF;
  END IF;
  fingerprint := public.agentx_seller_evidence_hash(selected_proof.proof_raw_text, selected_proof.proof_media_url);
  IF fingerprint IS NULL AND normalized_reference IS NULL THEN
    RAISE EXCEPTION 'O comprovativo precisa de texto, anexo ou referência para impedir reutilizações' USING ERRCODE = '22023';
  END IF;
  -- Earlier app versions did not store evidence fingerprints in the settlement ledger.
  IF EXISTS (
    SELECT 1 FROM public.payment_verifications v
    WHERE v.user_id = p_user AND v.order_id <> p_order AND v.status = 'approved'
      AND (
        (fingerprint IS NOT NULL AND public.agentx_seller_evidence_hash(v.proof_raw_text, v.proof_media_url) = fingerprint)
        OR (normalized_reference IS NOT NULL AND v.provider = selected_method AND v.confidence_score >= 0.80
          AND upper(regexp_replace(v.transaction_reference, '[^a-zA-Z0-9]', '', 'g')) = normalized_reference)
      )
  ) OR (normalized_reference IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.user_id = p_user AND o.id <> p_order AND o.status IN ('paid', 'fulfilled')
      AND o.payment_method = selected_method
      AND upper(regexp_replace(o.payment_reference, '[^a-zA-Z0-9]', '', 'g')) = normalized_reference
  )) THEN
    RAISE EXCEPTION 'Este comprovativo já foi usado para confirmar outro pedido' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.agentx_seller_settlements (order_id, user_id, method, reference_key, proof_id, evidence_hash)
  VALUES (p_order, p_user, selected_method, COALESCE(normalized_reference, 'evidence:' || fingerprint),
    selected_proof.id, fingerprint);

  -- Only the proof selected by the reviewer should carry the confirmed decision.
  UPDATE public.payment_verifications v SET status = 'rejected', reviewed_by = p_user, reviewed_at = now(),
    extracted_data = COALESCE(v.extracted_data, '{}'::jsonb) || jsonb_build_object('decisionReason', 'superseded_by_selected_proof')
  WHERE v.order_id = p_order AND v.user_id = p_user AND v.status = 'pending' AND v.id <> selected_proof.id;
  PERFORM public.agentx_catalog_approve_order(p_user, p_order,
    COALESCE(NULLIF(btrim(p_note), ''), 'Liquidação conferida no prestador pelo responsável da conta.'));
  UPDATE public.orders o SET payment_reference = COALESCE(reference_display, ''), payment_method = selected_method
    WHERE o.id = p_order AND o.user_id = p_user RETURNING to_jsonb(o) INTO approved;
  RETURN approved;
END;
$$;

-- Preserve the former service contract for a previous application image.
CREATE OR REPLACE FUNCTION public.agentx_seller_approve_order(
  p_user uuid, p_order uuid, p_note text, p_method text, p_reference text, p_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_amount IS NULL OR p_method IS NULL OR NULLIF(btrim(p_reference), '') IS NULL THEN
    RAISE EXCEPTION 'Indique o método, o valor e a referência oficial do pagamento' USING ERRCODE = '22023';
  END IF;
  RETURN public.agentx_seller_confirm_payment(p_user, p_order, p_note, true, p_reference, p_method, NULL, p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_reject_proof(
  p_user uuid, p_order uuid, p_proof uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_order public.orders%ROWTYPE;
  selected_proof public.payment_verifications%ROWTYPE;
  reason text := btrim(p_reason);
  notify_customer boolean;
BEGIN
  IF p_proof IS NULL OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 250 THEN
    RAISE EXCEPTION 'Indique o comprovativo e o motivo da rejeição' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO current_order FROM public.orders WHERE id = p_order AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF current_order.status NOT IN ('verification_pending', 'rejected') THEN
    RAISE EXCEPTION 'Pedido fora da fila de verificação' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO selected_proof FROM public.payment_verifications v
  WHERE v.id = p_proof AND v.order_id = p_order AND v.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprovativo não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF selected_proof.status = 'rejected' THEN
    RETURN jsonb_build_object('order', to_jsonb(current_order), 'notify', false);
  END IF;
  IF current_order.status <> 'verification_pending' OR selected_proof.status <> 'pending' THEN
    RAISE EXCEPTION 'Comprovativo fora da fila de verificação' USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_verifications v SET status = 'rejected', reviewed_by = p_user, reviewed_at = now(),
    extracted_data = COALESCE(v.extracted_data, '{}'::jsonb)
      || jsonb_build_object('decisionReason', 'rejected_by_operator', 'rejectionReason', reason)
  WHERE v.id = p_proof AND v.order_id = p_order AND v.user_id = p_user;
  notify_customer := NOT EXISTS (
    SELECT 1 FROM public.payment_verifications v
    WHERE v.user_id = p_user AND v.order_id = p_order AND v.status = 'pending'
  );
  IF notify_customer THEN
    UPDATE public.orders SET status = 'rejected', rejected_reason = reason, updated_at = now()
      WHERE id = p_order AND user_id = p_user RETURNING * INTO current_order;
  END IF;
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description, metadata)
    VALUES (p_user, p_order, current_order.customer_phone, 'admin_rejected', reason,
      jsonb_build_object('verificationId', p_proof, 'orderRejected', notify_customer));
  RETURN jsonb_build_object('order', to_jsonb(current_order), 'notify', notify_customer);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_payments_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_seller_contract_ready()
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.agentx_seller_settings') AND a.attname = 'payment_destinations' AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
      WHERE i.indexrelid = to_regclass('public.agentx_seller_settlement_evidence_uidx') AND i.indisunique AND i.indisvalid)
    AND to_regprocedure('public.agentx_seller_confirm_payment(uuid,uuid,text,boolean,text,text,uuid,numeric)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_reject_proof(uuid,uuid,uuid,text)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_seller_sync_payment_destinations(),
  public.agentx_seller_evidence_hash(text,text),
  public.agentx_seller_confirm_payment(uuid,uuid,text,boolean,text,text,uuid,numeric),
  public.agentx_seller_reject_proof(uuid,uuid,uuid,text),
  public.agentx_seller_payments_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_seller_evidence_hash(text,text),
  public.agentx_seller_confirm_payment(uuid,uuid,text,boolean,text,text,uuid,numeric),
  public.agentx_seller_reject_proof(uuid,uuid,uuid,text),
  public.agentx_seller_payments_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

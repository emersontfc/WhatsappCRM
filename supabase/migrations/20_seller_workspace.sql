BEGIN;

CREATE TABLE IF NOT EXISTS public.agentx_seller_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('mpesa', 'emola', 'bank_transfer')),
  payment_recipient text NOT NULL CHECK (length(payment_recipient) BETWEEN 5 AND 60),
  recipient_name text NOT NULL CHECK (length(recipient_name) BETWEEN 2 AND 100),
  notification_phone text CHECK (notification_phone ~ '^[1-9][0-9]{7,14}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agentx_seller_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.agentx_seller_settlements (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  user_id uuid NOT NULL,
  method text NOT NULL,
  reference_key text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, method, reference_key)
);
ALTER TABLE public.agentx_seller_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_seller_settings, public.agentx_seller_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agentx_seller_settings TO service_role;
GRANT SELECT, INSERT ON public.agentx_seller_settlements TO service_role;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_payment jsonb;
ALTER TABLE public.payment_verifications ADD COLUMN IF NOT EXISTS source_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_proof_by_whatsapp_message
  ON public.payment_verifications (user_id, source_message_id) WHERE source_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agentx_seller_create_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  settings public.agentx_seller_settings%ROWTYPE;
  created jsonb;
  phone text := public.agentx_contact_phone(p_phone);
BEGIN
  SELECT * INTO settings FROM public.agentx_seller_settings WHERE user_id = p_user;
  created := public.agentx_whatsapp_create_order(p_user, p_product, p_quantity, phone, p_customer,
    p_contact, COALESCE(settings.payment_method, p_method), p_order_number, p_source_message);
  IF public.agentx_contact_phone(created->>'customer_phone') IS DISTINCT FROM phone THEN
    RAISE EXCEPTION 'Pedido indisponível para este contacto' USING ERRCODE = '42501';
  END IF;
  IF settings.user_id IS NOT NULL AND created->>'order_number' = p_order_number AND created->>'seller_payment' IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product AND p.user_id = p_user
      AND p.type = 'digital' AND COALESCE(p.deliverable_path, '') NOT LIKE p_user::text || '/%'
      AND btrim(COALESCE(p.digital_content, '')) = '') THEN
      RAISE EXCEPTION 'Produto digital sem ficheiro ou conteúdo para entrega' USING ERRCODE = '22023';
    END IF;
    UPDATE public.orders AS o SET seller_payment = jsonb_build_object(
      'method', settings.payment_method, 'recipient', settings.payment_recipient, 'name', settings.recipient_name)
    WHERE o.id = (created->>'id')::uuid AND o.user_id = p_user RETURNING to_jsonb(o) INTO created;
  END IF;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_submit_proof(
  p_user uuid, p_order uuid, p_phone text, p_source_message text, p_proof jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target public.orders%ROWTYPE;
  proof public.payment_verifications%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.orders WHERE id = p_order AND user_id = p_user
    AND customer_phone = p_phone FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido indisponível para receber comprovativos' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO proof FROM public.payment_verifications
  WHERE user_id = p_user AND order_id = p_order AND (
    source_message_id = p_source_message OR
    (status = 'pending' AND proof_raw_text = p_proof->>'proof_raw_text')
  ) ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('id', proof.id, 'created', false); END IF;

  IF target.status NOT IN ('created', 'awaiting_payment', 'verification_pending', 'rejected') THEN
    RAISE EXCEPTION 'O pedido já saiu da fila de pagamento' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_verifications (order_id, user_id, customer_phone, provider,
    transaction_reference, amount, currency, sender_phone, sender_name, proof_type,
    proof_raw_text, confidence_score, extracted_data, status, source_message_id)
  VALUES (p_order, p_user, p_phone, p_proof->>'provider', p_proof->>'transaction_reference',
    (p_proof->>'amount')::numeric, target.currency, p_proof->>'sender_phone', p_proof->>'sender_name',
    p_proof->>'proof_type', p_proof->>'proof_raw_text', (p_proof->>'confidence_score')::numeric,
    p_proof->'extracted_data', 'pending', p_source_message)
  RETURNING * INTO proof;

  UPDATE public.orders SET status = 'verification_pending', updated_at = now()
    WHERE id = p_order AND user_id = p_user;

  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description, metadata)
  VALUES (p_user, p_order, p_phone, 'verification_pending', 'Comprovativo recebido. Aguarda confirmação no prestador.',
    jsonb_build_object('verificationId', proof.id));
  RETURN jsonb_build_object('id', proof.id, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_approve_order(
  p_user uuid, p_order uuid, p_note text, p_method text, p_reference text, p_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_order public.orders%ROWTYPE;
  normalized_reference text := upper(regexp_replace(p_reference, '[^a-zA-Z0-9]', '', 'g'));
  approved jsonb;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('mpesa', 'emola', 'bank_transfer', 'other')
     OR p_reference IS NULL OR p_reference !~ '^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{3,79}$' OR length(normalized_reference) < 4 THEN
    RAISE EXCEPTION 'Indique o método e a referência oficial do pagamento' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO current_order FROM public.orders WHERE id = p_order AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF p_amount IS NULL OR p_amount <> current_order.total_amount THEN
    RAISE EXCEPTION 'O valor confirmado difere do total deste pedido' USING ERRCODE = '22023';
  END IF;
  IF current_order.status IN ('paid', 'fulfilled') THEN
    IF EXISTS (SELECT 1 FROM public.agentx_seller_settlements s WHERE s.order_id = p_order
        AND (s.method <> p_method OR s.reference_key <> normalized_reference)) THEN
      RAISE EXCEPTION 'Este pedido já foi confirmado com outra referência' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(current_order);
  END IF;
  IF current_order.seller_payment IS NOT NULL AND current_order.seller_payment->>'method' <> p_method THEN
    RAISE EXCEPTION 'O método difere do método apresentado neste pedido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agentx_seller_settlements (order_id, user_id, method, reference_key)
  VALUES (p_order, p_user, p_method, normalized_reference);
  PERFORM public.agentx_catalog_approve_order(p_user, p_order, p_note);
  UPDATE public.orders AS o SET payment_reference = p_reference, payment_method = p_method
    WHERE id = p_order AND user_id = p_user RETURNING to_jsonb(o) INTO approved;
  RETURN approved;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_reject_order(p_user uuid, p_order uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  rejected public.orders%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 250 THEN
    RAISE EXCEPTION 'Indique o motivo da rejeição' USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders SET status = 'rejected', rejected_reason = p_reason, updated_at = now()
    WHERE id = p_order AND user_id = p_user AND status = 'verification_pending' RETURNING * INTO rejected;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido fora da fila de revisão' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.payment_verifications SET status = 'rejected', reviewed_by = p_user, reviewed_at = now()
    WHERE order_id = p_order AND user_id = p_user AND status = 'pending';
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description)
    VALUES (p_user, p_order, rejected.customer_phone, 'admin_rejected', p_reason);
  RETURN to_jsonb(rejected);
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_seller_create_order(uuid,uuid,integer,text,text,uuid,text,text,text),
  public.agentx_seller_submit_proof(uuid,uuid,text,text,jsonb),
  public.agentx_seller_approve_order(uuid,uuid,text,text,text,numeric),
  public.agentx_seller_reject_order(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_seller_create_order(uuid,uuid,integer,text,text,uuid,text,text,text),
  public.agentx_seller_submit_proof(uuid,uuid,text,text,jsonb),
  public.agentx_seller_approve_order(uuid,uuid,text,text,text,numeric),
  public.agentx_seller_reject_order(uuid,uuid,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

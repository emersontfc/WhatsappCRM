BEGIN;

-- Existing orders retain NULL and follow the legacy payment and stock rules.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS agentx_order_items_reservation_product_idx
  ON public.order_items (product_id, order_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_orders_reservation_deadline_idx
  ON public.orders (reservation_expires_at, id)
  WHERE reservation_expires_at IS NOT NULL AND status IN ('created', 'awaiting_payment');

CREATE OR REPLACE FUNCTION public.agentx_seller_hold_is_live(p_status text, p_expires timestamptz, p_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_expires IS NOT NULL AND (p_status = 'verification_pending'
    OR (p_status IN ('created', 'awaiting_payment') AND p_expires > p_at));
$$;

-- Lock the product before calling this helper in a write transaction. A fresh
-- snapshot is required after a lock wait so newly committed holds are counted.
CREATE OR REPLACE FUNCTION public.agentx_seller_held_units(p_user uuid, p_product uuid, p_exclude uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql VOLATILE SET search_path = '' AS $$
  WITH cutoff AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
  SELECT COALESCE(sum(i.quantity), 0)
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  CROSS JOIN cutoff
  WHERE i.product_id = p_product AND o.user_id = p_user AND o.id IS DISTINCT FROM p_exclude
    AND public.agentx_seller_hold_is_live(o.status, o.reservation_expires_at, cutoff.checked_at);
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_catalog_availability(p_user uuid)
RETURNS TABLE (product_id uuid, physical_stock integer, reserved_stock integer, available_stock integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p.id, greatest(COALESCE(p.stock, 0), 0),
    least(holds.units, 2147483647)::integer,
    greatest(0, COALESCE(p.stock, 0)::bigint - holds.units)::integer
  FROM public.products p
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(i.quantity), 0) AS units
    FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
    WHERE i.product_id = p.id AND o.user_id = p_user
      AND public.agentx_seller_hold_is_live(o.status, o.reservation_expires_at, statement_timestamp())
  ) holds
  WHERE p.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.agentx_catalog_write_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_expected_price numeric, p_expected_currency text,
  p_hold boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  product public.products%ROWTYPE;
  created public.orders%ROWTYPE;
BEGIN
  IF p_user IS NULL OR p_product IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 999
    OR p_phone IS NULL OR p_phone !~ '^[0-9]{8,15}$' OR length(btrim(COALESCE(p_order_number, ''))) NOT BETWEEN 1 AND 100
    OR p_method IS NULL OR p_method NOT IN ('mpesa', 'emola', 'bank_transfer', 'reference', 'other') THEN
    RAISE EXCEPTION 'Dados do pedido inválidos' USING ERRCODE = '22023';
  END IF;
  IF p_contact IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = p_contact AND c.user_id = p_user) THEN
    RAISE EXCEPTION 'Contacto não pertence à conta' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO product FROM public.products p WHERE p.id = p_product AND p.user_id = p_user
    AND p.is_active FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT p_hold THEN RAISE EXCEPTION 'Produto indisponível ou sem stock suficiente'; END IF;
    RAISE EXCEPTION 'Produto indisponível' USING ERRCODE = 'P0002';
  END IF;
  IF (p_expected_price IS NOT NULL AND product.price IS DISTINCT FROM p_expected_price)
    OR (p_expected_currency IS NOT NULL AND upper(btrim(product.currency)) IS DISTINCT FROM upper(btrim(p_expected_currency))) THEN
    RAISE EXCEPTION 'Catalog price or currency changed' USING ERRCODE = 'P0001';
  END IF;
  IF product.price IS NULL OR NOT (product.price > 0 AND product.price * p_quantity < 10000000000) THEN
    IF NOT p_hold THEN RAISE EXCEPTION 'Produto indisponível ou sem stock suficiente'; END IF;
    RAISE EXCEPTION 'Produto sem preço válido para venda' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(product.stock, 0) - public.agentx_seller_held_units(p_user, p_product) < p_quantity THEN
    IF NOT p_hold THEN RAISE EXCEPTION 'Produto indisponível ou sem stock suficiente'; END IF;
    RAISE EXCEPTION 'Insufficient available stock' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.orders (order_number, user_id, contact_id, customer_name, customer_phone, total_amount,
    currency, status, payment_method, tracks_catalog_stock, reservation_expires_at)
  VALUES (p_order_number, p_user, p_contact, p_customer, p_phone, product.price * p_quantity, product.currency,
    'awaiting_payment', p_method, p_hold, CASE WHEN p_hold THEN clock_timestamp() + interval '30 minutes' END)
  RETURNING * INTO created;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, deliverable_snapshot)
  VALUES (created.id, product.id, product.name, p_quantity, product.price, created.total_amount,
    jsonb_build_object('productId', product.id, 'type', product.type, 'text', product.digital_content,
      'path', product.deliverable_path, 'name', product.deliverable_name));
  RETURN to_jsonb(created);
END;
$$;

-- Legacy callers do not know reservation deadlines. Activate holds only on the
-- explicit reserved-order RPC once a deadline-aware release starts using it.
CREATE OR REPLACE FUNCTION public.agentx_catalog_create_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text
) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT public.agentx_catalog_write_order(p_user, p_product, p_quantity, p_phone,
    p_customer, p_contact, p_method, p_order_number, NULL, NULL, false);
$$;

CREATE OR REPLACE FUNCTION public.agentx_whatsapp_write_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text,
  p_expected_price numeric, p_expected_currency text, p_destination jsonb, p_requires_destination boolean,
  p_hold boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  existing public.orders%ROWTYPE;
  created jsonb;
  linked_lead uuid;
  phone text := public.agentx_contact_phone(p_phone);
BEGIN
  IF p_user IS NULL OR p_product IS NULL OR phone IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'Dados do pedido inválidos' USING ERRCODE = '22023';
  END IF;

  IF p_source_message IS NOT NULL THEN
    IF length(btrim(p_source_message)) NOT BETWEEN 1 AND 160 OR length(p_source_message) > 160 THEN
      RAISE EXCEPTION 'Mensagem inválida' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':wa-order:' || p_source_message, 0));
    SELECT * INTO existing FROM public.orders o WHERE o.user_id = p_user AND o.source_message_id = p_source_message FOR UPDATE;
    IF FOUND THEN
      IF public.agentx_contact_phone(existing.customer_phone) IS DISTINCT FROM phone
        OR (p_contact IS NOT NULL AND existing.contact_id IS NOT NULL AND existing.contact_id <> p_contact) THEN
        RAISE EXCEPTION 'Pedido indisponível para este contacto' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id = existing.id
          AND (i.product_id = p_product OR (i.product_id IS NULL AND i.deliverable_snapshot->>'productId' = p_product::text))
          AND i.quantity = p_quantity
          AND (p_expected_price IS NULL OR i.unit_price = p_expected_price))
        OR (p_expected_currency IS NOT NULL AND upper(btrim(existing.currency)) IS DISTINCT FROM upper(btrim(p_expected_currency)))
        OR (p_requires_destination AND p_method IS DISTINCT FROM COALESCE(existing.seller_payment->>'method', existing.payment_method)) THEN
        RAISE EXCEPTION 'A mensagem já está associada a outro pedido' USING ERRCODE = '23505';
      END IF;
      RETURN to_jsonb(existing);
    END IF;
  END IF;

  IF p_requires_destination AND (NULLIF(btrim(p_destination->>'recipient'), '') IS NULL
    OR NULLIF(btrim(p_destination->>'name'), '') IS NULL) THEN
    RAISE EXCEPTION 'Payment destination unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- Approval and creation both acquire the lead before any product lock.
  linked_lead := public.agentx_capture_sales_lead(p_user, phone, p_contact, p_customer, 'order');
  created := public.agentx_catalog_write_order(p_user, p_product, p_quantity, phone, p_customer,
    p_contact, p_method, p_order_number, p_expected_price, p_expected_currency, p_hold);

  IF p_destination IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product AND p.user_id = p_user AND p.type = 'digital'
      AND COALESCE(p.deliverable_path, '') NOT LIKE p_user::text || '/%'
      AND btrim(COALESCE(p.digital_content, '')) = ''
  ) THEN
    RAISE EXCEPTION 'Produto digital sem ficheiro ou conteúdo para entrega' USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders o SET lead_id = linked_lead, source_message_id = p_source_message, tracks_catalog_stock = true,
    seller_payment = CASE WHEN p_destination IS NOT NULL THEN
      jsonb_build_object('method', p_method, 'recipient', p_destination->>'recipient', 'name', p_destination->>'name') END
  WHERE o.id = (created->>'id')::uuid AND o.user_id = p_user RETURNING to_jsonb(o) INTO created;
  INSERT INTO public.agent_operations (user_id, order_id, contact_id, phone, step, description)
  VALUES (p_user, (created->>'id')::uuid, p_contact, phone, 'order_created', 'Pedido criado pelo agente. A aguardar pagamento.');
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_whatsapp_create_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text
) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT public.agentx_whatsapp_write_order(p_user, p_product, p_quantity, p_phone, p_customer, p_contact,
    p_method, p_order_number, p_source_message, NULL, NULL, NULL, false, false);
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_write_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text,
  p_expected_price numeric, p_expected_currency text, p_hold boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  settings public.agentx_seller_settings%ROWTYPE;
  destination jsonb;
  chosen_method text;
  requires_destination boolean := COALESCE(p_method IN ('mpesa', 'emola', 'bank_transfer'), false)
    AND (p_expected_price IS NOT NULL OR p_expected_currency IS NOT NULL);
BEGIN
  SELECT * INTO settings FROM public.agentx_seller_settings WHERE user_id = p_user FOR SHARE;
  IF requires_destination THEN
    chosen_method := p_method;
    destination := settings.payment_destinations->chosen_method;
  ELSIF FOUND THEN
    chosen_method := CASE WHEN settings.payment_destinations ? p_method THEN p_method ELSE settings.payment_method END;
    destination := settings.payment_destinations->chosen_method;
  ELSE
    chosen_method := COALESCE(p_method, 'mpesa');
  END IF;
  RETURN public.agentx_whatsapp_write_order(p_user, p_product, p_quantity, p_phone, p_customer, p_contact,
    chosen_method, p_order_number, p_source_message, p_expected_price, p_expected_currency, destination, requires_destination, p_hold);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_create_reserved_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text,
  p_expected_price numeric DEFAULT NULL, p_expected_currency text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT public.agentx_seller_write_order(p_user, p_product, p_quantity, p_phone, p_customer, p_contact,
    p_method, p_order_number, p_source_message, p_expected_price, p_expected_currency, true);
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_create_order(
  p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
  p_contact uuid, p_method text, p_order_number text, p_source_message text
) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT public.agentx_seller_write_order(p_user, p_product, p_quantity, p_phone, p_customer, p_contact,
    p_method, p_order_number, p_source_message, NULL, NULL, false);
$$;

-- Every change that acquires or consumes a hold locks the current order before
-- touching its products. Multi-item legacy orders lock products in UUID order.
CREATE OR REPLACE FUNCTION public.agentx_lock_seller_order_stock(p_user uuid, p_order uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  item record;
  physical integer;
  item_count integer := 0;
BEGIN
  FOR item IN SELECT i.product_id, sum(i.quantity) AS units, min(i.quantity) AS smallest_quantity
    FROM public.order_items i WHERE i.order_id = p_order GROUP BY i.product_id ORDER BY i.product_id
  LOOP
    item_count := item_count + 1;
    SELECT p.stock INTO physical FROM public.products p WHERE p.id = item.product_id AND p.user_id = p_user FOR UPDATE;
    IF NOT FOUND OR item.smallest_quantity <= 0
      OR COALESCE(physical, 0) - public.agentx_seller_held_units(p_user, item.product_id, p_order) < item.units THEN
      RAISE EXCEPTION 'Insufficient available stock' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF item_count = 0 THEN RAISE EXCEPTION 'Pedido sem produto para reservar' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_guard_seller_stock_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.reservation_expires_at IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'verification_pending' THEN
    IF OLD.status NOT IN ('created', 'awaiting_payment', 'rejected') OR OLD.reservation_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Stock reservation expired' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.agentx_lock_seller_order_stock(OLD.user_id, OLD.id);
    IF OLD.reservation_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Stock reservation expired' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.status IN ('created', 'awaiting_payment') THEN
    RAISE EXCEPTION 'Não é possível reabrir a reserva deste pedido' USING ERRCODE = '22023';
  ELSIF NEW.status = 'paid' AND OLD.status <> 'verification_pending' THEN
    RAISE EXCEPTION 'Pedido fora da fila de verificação' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_guard_seller_stock_review ON public.orders;
CREATE TRIGGER agentx_guard_seller_stock_review BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.agentx_guard_seller_stock_review();

CREATE OR REPLACE FUNCTION public.agentx_guard_product_stock_holds()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  remaining integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN RETURN NEW; END IF;
    remaining := COALESCE(NEW.stock, 0);
    IF remaining < 0 THEN RAISE EXCEPTION 'O stock não pode ser negativo' USING ERRCODE = '22023'; END IF;
    IF remaining >= COALESCE(OLD.stock, 0) THEN RETURN NEW; END IF;
  END IF;
  IF remaining < public.agentx_seller_held_units(OLD.user_id, OLD.id) THEN
    RAISE EXCEPTION 'O stock já está reservado para pedidos em curso' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_guard_product_stock_holds ON public.products;
CREATE TRIGGER agentx_guard_product_stock_holds BEFORE UPDATE OF stock OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.agentx_guard_product_stock_holds();

CREATE OR REPLACE FUNCTION public.agentx_catalog_approve_order(p_user uuid, p_order uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  approved public.orders%ROWTYPE;
  linked_lead uuid;
BEGIN
  SELECT * INTO approved FROM public.orders o WHERE o.id = p_order AND o.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF approved.status IN ('paid', 'fulfilled') THEN RETURN to_jsonb(approved); END IF;
  IF approved.status <> 'verification_pending' THEN RAISE EXCEPTION 'Pedido fora da fila de verificação' USING ERRCODE = '22023'; END IF;

  IF approved.tracks_catalog_stock THEN
    linked_lead := public.agentx_capture_sales_lead(p_user, approved.customer_phone, approved.contact_id, approved.customer_name, 'sold');
    PERFORM public.agentx_lock_seller_order_stock(p_user, p_order);
  END IF;
  UPDATE public.payment_verifications SET status = 'approved', reviewed_by = p_user, reviewed_at = now()
    WHERE order_id = p_order AND user_id = p_user AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido sem comprovativo pendente' USING ERRCODE = '22023'; END IF;

  -- The product locks remain held until both the status and physical debit commit.
  UPDATE public.orders SET status = 'paid', approved_by = p_user, approved_at = now(), verification_notes = p_note,
    lead_id = COALESCE(linked_lead, lead_id), updated_at = now()
    WHERE id = p_order AND user_id = p_user RETURNING * INTO approved;
  IF approved.tracks_catalog_stock THEN
    UPDATE public.products p SET stock = p.stock - items.units, updated_at = now()
    FROM (SELECT i.product_id, sum(i.quantity)::integer AS units FROM public.order_items i
      WHERE i.order_id = p_order GROUP BY i.product_id) items
    WHERE p.id = items.product_id AND p.user_id = p_user;
  END IF;
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description)
  VALUES (p_user, p_order, approved.customer_phone, 'admin_approved', 'Pagamento validado pelo responsável da conta.');
  RETURN to_jsonb(approved);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_cancel_order(p_user uuid, p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target public.orders%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.orders o WHERE o.id = p_order AND o.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF target.status IN ('cancelled', 'expired') THEN RETURN to_jsonb(target); END IF;
  IF target.status NOT IN ('created', 'awaiting_payment') OR EXISTS (
    SELECT 1 FROM public.payment_verifications v WHERE v.user_id = p_user AND v.order_id = p_order AND v.status = 'pending'
  ) THEN RAISE EXCEPTION 'O pedido já saiu da fila de pagamento' USING ERRCODE = '22023'; END IF;

  UPDATE public.orders o SET status = CASE WHEN target.reservation_expires_at <= clock_timestamp() THEN 'expired' ELSE 'cancelled' END,
    updated_at = now()
    WHERE o.id = p_order AND o.user_id = p_user RETURNING * INTO target;
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description)
  VALUES (p_user, p_order, target.customer_phone,
    CASE WHEN target.status = 'expired' THEN 'order_expired' ELSE 'order_cancelled' END,
    CASE WHEN target.status = 'expired' THEN 'A reserva expirou sem comprovativo.' ELSE 'Pedido cancelado pelo responsável da conta.' END);
  RETURN to_jsonb(target);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_expire_seller_reservations(p_limit integer DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  expired_count integer;
BEGIN
  WITH due AS (
    SELECT o.id FROM public.orders o WHERE o.status IN ('created', 'awaiting_payment')
      AND o.reservation_expires_at <= statement_timestamp()
    ORDER BY o.reservation_expires_at, o.id LIMIT least(200, greatest(1, COALESCE(p_limit, 50))) FOR UPDATE SKIP LOCKED
  ), expired AS (
    UPDATE public.orders o SET status = 'expired', updated_at = now() FROM due
      WHERE due.id = o.id RETURNING o.user_id, o.id, o.customer_phone
  )
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description)
    SELECT e.user_id, e.id, e.customer_phone, 'order_expired', 'A reserva expirou sem comprovativo.' FROM expired e;
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_reservations_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_seller_payments_ready()
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.orders')
      AND a.attname = 'reservation_expires_at' AND NOT a.attisdropped)
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('public.agentx_order_items_reservation_product_idx'),
      ('public.agentx_orders_reservation_deadline_idx')) AS names(name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = to_regclass(names.name) AND i.indisvalid))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.orders')
      AND t.tgname = 'agentx_guard_seller_stock_review' AND t.tgenabled IN ('O', 'A'))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.products')
      AND t.tgname = 'agentx_guard_product_stock_holds' AND t.tgenabled IN ('O', 'A'))
    AND to_regprocedure('public.agentx_seller_create_reserved_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_catalog_availability(uuid)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_cancel_order(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.agentx_expire_seller_reservations(integer)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_seller_hold_is_live(text,timestamptz,timestamptz),
  public.agentx_seller_held_units(uuid,uuid,uuid), public.agentx_seller_catalog_availability(uuid),
  public.agentx_catalog_write_order(uuid,uuid,integer,text,text,uuid,text,text,numeric,text,boolean),
  public.agentx_whatsapp_write_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text,jsonb,boolean,boolean),
  public.agentx_seller_write_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text,boolean),
  public.agentx_seller_create_reserved_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text),
  public.agentx_lock_seller_order_stock(uuid,uuid), public.agentx_guard_seller_stock_review(),
  public.agentx_guard_product_stock_holds(), public.agentx_seller_cancel_order(uuid,uuid),
  public.agentx_expire_seller_reservations(integer), public.agentx_seller_reservations_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_seller_hold_is_live(text,timestamptz,timestamptz),
  public.agentx_seller_held_units(uuid,uuid,uuid), public.agentx_seller_catalog_availability(uuid),
  public.agentx_catalog_write_order(uuid,uuid,integer,text,text,uuid,text,text,numeric,text,boolean),
  public.agentx_whatsapp_write_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text,jsonb,boolean,boolean),
  public.agentx_seller_write_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text,boolean),
  public.agentx_seller_create_reserved_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text),
  public.agentx_lock_seller_order_stock(uuid,uuid), public.agentx_seller_cancel_order(uuid,uuid),
  public.agentx_expire_seller_reservations(integer), public.agentx_seller_reservations_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

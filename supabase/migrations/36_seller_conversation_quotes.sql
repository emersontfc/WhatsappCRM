BEGIN;

-- WhatsApp timestamps have one-second precision. Observe new direct messages in database order.
-- Historical rows stay untouched, and each conversation has its own transaction lock.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS agentx_conversation_seq bigint;
CREATE SEQUENCE IF NOT EXISTS public.agentx_seller_conversation_seq;
REVOKE ALL ON SEQUENCE public.agentx_seller_conversation_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.agentx_seller_conversation_seq TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_lock_seller_conversation(p_user uuid, p_contact uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'agentx:seller-conversation:' || p_user::text || ':' || p_contact::text, 0));
$$;

CREATE OR REPLACE FUNCTION public.agentx_observe_seller_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF CURRENT_USER IN ('anon', 'authenticated') AND
      (NEW.agentx_conversation_seq IS DISTINCT FROM OLD.agentx_conversation_seq
      OR NEW.agentx_live_ingress IS DISTINCT FROM OLD.agentx_live_ingress
      OR (OLD.agentx_conversation_seq IS NOT NULL AND
        ROW(NEW.user_id,NEW.contact_id,NEW.msg_id,NEW.type,NEW.text,NEW.timestamp)
          IS DISTINCT FROM ROW(OLD.user_id,OLD.contact_id,OLD.msg_id,OLD.type,OLD.text,OLD.timestamp))) THEN
      RAISE EXCEPTION 'A origem da mensagem não pode ser alterada' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  NEW.agentx_conversation_seq := NULL;
  IF CURRENT_USER IN ('anon', 'authenticated') THEN
    NEW.agentx_live_ingress := NULL;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NOT NULL AND NEW.contact_id IS NOT NULL AND NEW.type IN ('inbound', 'outbound')
    AND NEW.timestamp BETWEEN clock_timestamp() - interval '10 minutes' AND clock_timestamp() + interval '30 seconds' THEN
    PERFORM public.agentx_lock_seller_conversation(NEW.user_id, NEW.contact_id);
    NEW.agentx_conversation_seq := nextval('public.agentx_seller_conversation_seq'::regclass);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_observe_seller_conversation ON public.messages;
CREATE TRIGGER agentx_observe_seller_conversation
  BEFORE INSERT OR UPDATE OF agentx_conversation_seq,agentx_live_ingress,user_id,contact_id,msg_id,type,text,timestamp
  ON public.messages FOR EACH ROW EXECUTE FUNCTION public.agentx_observe_seller_conversation();
CREATE INDEX IF NOT EXISTS agentx_messages_seller_conversation_idx
  ON public.messages (user_id,contact_id,agentx_conversation_seq) WHERE agentx_conversation_seq IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agentx_seller_conversation_quotes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  outbound_message_id text NOT NULL CHECK (length(outbound_message_id) BETWEEN 1 AND 160),
  outbound_sequence bigint NOT NULL,
  successor_sequence bigint,
  product_id uuid NOT NULL,
  unit_price numeric(12,2) NOT NULL CHECK (unit_price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{2,3}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  accepted_message_id text CHECK (length(accepted_message_id) BETWEEN 1 AND 160),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id,outbound_message_id)
);
CREATE INDEX IF NOT EXISTS agentx_seller_quotes_conversation_idx
  ON public.agentx_seller_conversation_quotes (user_id,contact_id,outbound_sequence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agentx_seller_quotes_accepted_source_idx
  ON public.agentx_seller_conversation_quotes (user_id,accepted_message_id) WHERE accepted_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_seller_quotes_observation_idx
  ON public.agentx_seller_conversation_quotes (user_id,contact_id,outbound_sequence)
  WHERE successor_sequence IS NULL AND accepted_message_id IS NULL;
ALTER TABLE public.agentx_seller_conversation_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_seller_conversation_quotes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.agentx_seller_conversation_quotes TO service_role;
GRANT UPDATE (accepted_message_id,order_id,successor_sequence) ON public.agentx_seller_conversation_quotes TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_mark_seller_quote_successor()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.agentx_seller_conversation_quotes q SET successor_sequence=NEW.agentx_conversation_seq
    WHERE q.user_id=NEW.user_id AND q.contact_id=NEW.contact_id AND q.outbound_sequence < NEW.agentx_conversation_seq
      AND q.successor_sequence IS NULL AND q.accepted_message_id IS NULL;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS agentx_mark_seller_quote_successor ON public.messages;
CREATE TRIGGER agentx_mark_seller_quote_successor AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.agentx_conversation_seq IS NOT NULL) EXECUTE FUNCTION public.agentx_mark_seller_quote_successor();

CREATE OR REPLACE FUNCTION public.agentx_save_seller_quote(
  p_user uuid, p_contact uuid, p_outbound_message text, p_product uuid, p_unit_price numeric, p_currency text
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  sent public.messages%ROWTYPE;
  sent_at timestamptz;
  successor bigint;
BEGIN
  IF p_user IS NULL OR p_contact IS NULL OR p_product IS NULL OR p_outbound_message IS NULL
    OR length(p_outbound_message) NOT BETWEEN 1 AND 160 OR p_unit_price IS NULL OR p_unit_price <= 0
    OR p_unit_price >= 10000000000 OR scale(p_unit_price) > 2 OR p_currency IS NULL OR p_currency !~ '^[A-Z]{2,3}$' THEN
    RETURN false;
  END IF;
  PERFORM public.agentx_lock_seller_conversation(p_user,p_contact);
  sent_at := clock_timestamp();
  SELECT m.* INTO sent FROM public.messages m
    JOIN public.contacts c ON c.id=m.contact_id AND c.user_id=m.user_id
    WHERE m.user_id=p_user AND m.contact_id=p_contact AND m.msg_id=p_outbound_message
      AND m.type='outbound' AND m.agentx_conversation_seq IS NOT NULL
      AND m.timestamp BETWEEN sent_at - interval '2 minutes' AND sent_at + interval '30 seconds'
      AND COALESCE(c.ai_paused,false)=false;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=p_product AND p.user_id=p_user) THEN
    RETURN false;
  END IF;
  SELECT m.agentx_conversation_seq INTO successor FROM public.messages m WHERE m.user_id=p_user AND m.contact_id=p_contact
    AND m.agentx_conversation_seq > sent.agentx_conversation_seq ORDER BY m.agentx_conversation_seq LIMIT 1;
  INSERT INTO public.agentx_seller_conversation_quotes(
    user_id,contact_id,outbound_message_id,outbound_sequence,successor_sequence,product_id,unit_price,currency,created_at,expires_at)
    VALUES (p_user,p_contact,p_outbound_message,sent.agentx_conversation_seq,successor,p_product,p_unit_price,p_currency,
      sent_at,sent_at + interval '10 minutes')
  ON CONFLICT (user_id,outbound_message_id) DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM public.agentx_seller_conversation_quotes q
    WHERE q.user_id=p_user AND q.contact_id=p_contact AND q.outbound_message_id=p_outbound_message
      AND q.outbound_sequence=sent.agentx_conversation_seq AND q.product_id=p_product
      AND q.unit_price=p_unit_price AND q.currency=p_currency);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_accept_seller_quote(
  p_user uuid, p_contact uuid, p_source_message text, p_phone text, p_quantity integer,
  p_method text, p_order_number text, p_quoted_message text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  buyer public.contacts%ROWTYPE;
  inbound public.messages%ROWTYPE;
  quote public.agentx_seller_conversation_quotes%ROWTYPE;
  parts text[];
  method text;
  settings public.agentx_seller_settings%ROWTYPE;
  destination jsonb;
  phone text := public.agentx_contact_phone(p_phone);
  order_row jsonb;
  item public.order_items%ROWTYPE;
  result_status text;
BEGIN
  IF p_user IS NULL OR p_contact IS NULL OR phone IS NULL OR p_source_message IS NULL
    OR length(p_source_message) NOT BETWEEN 1 AND 160 OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 999
    OR p_order_number IS NULL OR p_order_number !~ '^AGX-[A-F0-9]{12}$' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_quoted_message IS NOT NULL AND length(p_quoted_message) NOT BETWEEN 1 AND 160 THEN
    RETURN jsonb_build_object('status','intervening');
  END IF;
  PERFORM public.agentx_lock_seller_conversation(p_user,p_contact);
  SELECT * INTO buyer FROM public.contacts c WHERE c.id=p_contact AND c.user_id=p_user FOR SHARE;
  IF NOT FOUND OR public.agentx_contact_phone(buyer.phone) IS DISTINCT FROM phone OR COALESCE(buyer.ai_paused,false)
    OR phone = split_part(split_part(buyer.lid,'@',1),':',1) THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT * INTO inbound FROM public.messages m WHERE m.user_id=p_user AND m.contact_id=p_contact
    AND m.msg_id=p_source_message AND m.type='inbound' AND m.agentx_live_ingress IS TRUE AND m.agentx_conversation_seq IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;

  -- Require the confirmation observed by the gateway, even if a caller passes unrelated parameters.
  parts := regexp_match(btrim(regexp_replace(translate(lower(normalize(left(inbound.text,501))),
    'çãáàâéêíóõôú‐‑‒–—―', 'caaaaeeiooou------'), '[[:space:]]+', ' ', 'g')),
    '^(?:peco|quero|manda|envia|fico com|vou levar) ([1-9][0-9]{0,2})(?: unidades?)?(?: (?:por|via) (m[- ]?pesa|e[- ]?mola|transferencia bancaria|banco))?(?:,? por favor)?[.!]?$');
  method := CASE WHEN parts[2] LIKE 'm%pesa' THEN 'mpesa' WHEN parts[2] LIKE 'e%mola' THEN 'emola'
    WHEN parts[2] IN ('transferencia bancaria','banco') THEN 'bank_transfer' END;
  IF parts IS NULL OR parts[1]::integer IS DISTINCT FROM p_quantity OR method IS DISTINCT FROM p_method
    OR length(inbound.text) > 500 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT * INTO quote FROM public.agentx_seller_conversation_quotes q
    WHERE q.user_id=p_user AND q.contact_id=p_contact AND q.accepted_message_id=p_source_message;
  IF FOUND THEN
    IF p_quoted_message IS NOT NULL AND p_quoted_message <> quote.outbound_message_id THEN
      RETURN jsonb_build_object('status','intervening');
    END IF;
    SELECT to_jsonb(o) INTO order_row FROM public.orders o WHERE o.id=quote.order_id AND o.user_id=p_user
      AND o.contact_id=p_contact AND o.customer_phone=phone;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
    result_status := 'replayed';
  ELSE
    SELECT * INTO quote FROM public.agentx_seller_conversation_quotes q WHERE q.user_id=p_user AND q.contact_id=p_contact
      AND q.outbound_sequence < inbound.agentx_conversation_seq ORDER BY q.outbound_sequence DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR quote.accepted_message_id IS NOT NULL THEN RETURN jsonb_build_object('status','missing'); END IF;
    IF quote.expires_at <= clock_timestamp() THEN RETURN jsonb_build_object('status','expired'); END IF;
    IF (p_quoted_message IS NOT NULL AND p_quoted_message <> quote.outbound_message_id)
      OR quote.successor_sequence IS DISTINCT FROM inbound.agentx_conversation_seq
      OR NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.user_id=p_user AND m.contact_id=p_contact
        AND m.msg_id=quote.outbound_message_id AND m.type='outbound' AND m.agentx_conversation_seq=quote.outbound_sequence
        AND m.timestamp <= inbound.timestamp) THEN
      RETURN jsonb_build_object('status','intervening');
    END IF;

    -- A method named by the buyer cannot silently fall back to another destination.
    SELECT * INTO settings FROM public.agentx_seller_settings s WHERE s.user_id=p_user FOR SHARE;
    destination := settings.payment_destinations->COALESCE(p_method,settings.payment_method);
    IF NOT FOUND OR destination IS NULL OR nullif(btrim(destination->>'recipient'),'') IS NULL
      OR nullif(btrim(destination->>'name'),'') IS NULL THEN
      RETURN jsonb_build_object('status','payment_unavailable');
    END IF;
    order_row := public.agentx_seller_create_reserved_order(p_user,quote.product_id,p_quantity,phone,buyer.name,p_contact,
      p_method,p_order_number,p_source_message,quote.unit_price,quote.currency);
    IF order_row IS NULL OR order_row->>'user_id' IS DISTINCT FROM p_user::text
      OR order_row->>'contact_id' IS DISTINCT FROM p_contact::text OR order_row->>'customer_phone' IS DISTINCT FROM phone
      OR order_row->>'source_message_id' IS DISTINCT FROM p_source_message THEN
      RAISE EXCEPTION 'Dados do pedido associados a outra confirmação' USING ERRCODE = '22023';
    END IF;
    result_status := 'accepted';
  END IF;

  SELECT * INTO item FROM public.order_items i WHERE i.order_id=(order_row->>'id')::uuid
    AND (i.product_id=quote.product_id OR (result_status='replayed' AND i.product_id IS NULL))
    AND i.quantity=p_quantity AND i.unit_price=quote.unit_price;
  IF NOT FOUND OR order_row->>'currency' IS DISTINCT FROM quote.currency
    OR (p_method IS NOT NULL AND order_row->>'payment_method' IS DISTINCT FROM p_method) THEN
    RAISE EXCEPTION 'Dados do pedido diferem da proposta' USING ERRCODE = '22023';
  END IF;
  IF result_status='accepted' THEN
    UPDATE public.agentx_seller_conversation_quotes SET accepted_message_id=p_source_message,order_id=(order_row->>'id')::uuid
      WHERE user_id=p_user AND contact_id=p_contact AND outbound_message_id=quote.outbound_message_id;
  END IF;
  RETURN jsonb_build_object('status',result_status,'order',order_row,'quantity',item.quantity,'productName',item.product_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_quotes_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.agentx_seller_conversation_quotes') IS NOT NULL
    AND to_regclass('public.agentx_messages_seller_conversation_idx') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_create_reserved_order(uuid,uuid,integer,text,text,uuid,text,text,text,numeric,text)') IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.messages'::regclass
      AND tgname IN ('agentx_observe_seller_conversation','agentx_mark_seller_quote_successor') AND tgenabled IN ('O','A'))=2
    AND has_function_privilege('service_role','public.agentx_accept_seller_quote(uuid,uuid,text,text,integer,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.agentx_accept_seller_quote(uuid,uuid,text,text,integer,text,text,text)','EXECUTE');
$$;

REVOKE ALL ON FUNCTION public.agentx_lock_seller_conversation(uuid,uuid), public.agentx_observe_seller_conversation(),
  public.agentx_mark_seller_quote_successor(),
  public.agentx_save_seller_quote(uuid,uuid,text,uuid,numeric,text),
  public.agentx_accept_seller_quote(uuid,uuid,text,text,integer,text,text,text), public.agentx_seller_quotes_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_lock_seller_conversation(uuid,uuid), public.agentx_observe_seller_conversation(),
  public.agentx_mark_seller_quote_successor(),
  public.agentx_save_seller_quote(uuid,uuid,text,uuid,numeric,text),
  public.agentx_accept_seller_quote(uuid,uuid,text,text,integer,text,text,text), public.agentx_seller_quotes_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

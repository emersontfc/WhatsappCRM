BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_cover_path text;

INSERT INTO storage.buckets(id, name, public, file_size_limit)
VALUES ('agentx-catalog-covers', 'agentx-catalog-covers', false, 5242880)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS agentx_private_catalog_cover_objects ON storage.objects;
CREATE POLICY agentx_private_catalog_cover_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'agentx-catalog-covers') WITH CHECK (bucket_id <> 'agentx-catalog-covers');
DROP POLICY IF EXISTS agentx_private_catalog_cover_bucket ON storage.buckets;
CREATE POLICY agentx_private_catalog_cover_bucket ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (id <> 'agentx-catalog-covers') WITH CHECK (id <> 'agentx-catalog-covers');

CREATE TABLE IF NOT EXISTS public.agentx_catalog_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  group_jid text NOT NULL,
  group_name text NOT NULL,
  merchant_phone text NOT NULL,
  code text NOT NULL CHECK (code ~ '^AXC-[0-9A-F]{32}$'),
  caption text NOT NULL DEFAULT '',
  scheduled_at timestamptz NOT NULL,
  published_at timestamptz,
  dispatch_receipt_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_key),
  UNIQUE (user_id, code)
);
CREATE INDEX IF NOT EXISTS agentx_catalog_campaign_account_recent_idx
  ON public.agentx_catalog_campaigns (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agentx_catalog_campaign_product_idx
  ON public.agentx_catalog_campaigns (product_id) WHERE product_id IS NOT NULL;

ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS campaign_id uuid
  REFERENCES public.agentx_catalog_campaigns(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_catalog_campaign_job_idx
  ON public.scheduled_messages(campaign_id) WHERE campaign_id IS NOT NULL;
DROP POLICY IF EXISTS agentx_catalog_job_service_insert ON public.scheduled_messages;
CREATE POLICY agentx_catalog_job_service_insert ON public.scheduled_messages AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (campaign_id IS NULL);
DROP POLICY IF EXISTS agentx_catalog_job_service_update ON public.scheduled_messages;
CREATE POLICY agentx_catalog_job_service_update ON public.scheduled_messages AS RESTRICTIVE FOR UPDATE TO authenticated
USING (campaign_id IS NULL) WITH CHECK (campaign_id IS NULL);
DROP POLICY IF EXISTS agentx_catalog_job_service_delete ON public.scheduled_messages;
CREATE POLICY agentx_catalog_job_service_delete ON public.scheduled_messages AS RESTRICTIVE FOR DELETE TO authenticated
USING (campaign_id IS NULL);

CREATE TABLE IF NOT EXISTS public.agentx_catalog_campaign_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.agentx_catalog_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  source_message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, campaign_id, customer_phone),
  UNIQUE (user_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS agentx_catalog_interest_lead_idx
  ON public.agentx_catalog_campaign_interests (user_id, lead_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agentx_catalog_interest_campaign_idx ON public.agentx_catalog_campaign_interests (campaign_id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS catalog_campaign_id uuid
  REFERENCES public.agentx_catalog_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS agentx_catalog_order_campaign_idx
  ON public.orders (catalog_campaign_id) WHERE catalog_campaign_id IS NOT NULL;

ALTER TABLE public.agentx_catalog_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentx_catalog_campaign_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_catalog_campaigns, public.agentx_catalog_campaign_interests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agentx_catalog_campaigns TO service_role;
GRANT SELECT, INSERT ON public.agentx_catalog_campaign_interests TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_queue_catalog_campaign(
  p_user uuid, p_key uuid, p_product uuid, p_group text, p_group_name text, p_merchant_phone text,
  p_code text, p_caption text, p_when timestamptz
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  merchant_product public.products%ROWTYPE;
  campaign public.agentx_catalog_campaigns%ROWTYPE;
  job_id uuid;
  job_status text;
BEGIN
  IF p_user IS NULL OR p_key IS NULL OR p_product IS NULL OR p_group IS NULL OR p_group !~ '^[0-9]{5,24}(-[0-9]{1,24})?@g[.]us$'
    OR p_group_name IS NULL OR length(btrim(p_group_name)) NOT BETWEEN 1 AND 200
    OR p_merchant_phone IS NULL OR p_merchant_phone !~ '^[1-9][0-9]{7,14}$'
    OR p_code IS NULL OR p_code !~ '^AXC-[0-9A-F]{32}$' OR length(COALESCE(p_caption, '')) > 400 OR p_when IS NULL THEN
    RAISE EXCEPTION 'Dados da campanha inválidos' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':campaign:' || p_key::text, 0));
  SELECT * INTO campaign FROM public.agentx_catalog_campaigns WHERE user_id = p_user AND request_key = p_key;
  IF FOUND THEN
    IF campaign.product_id IS DISTINCT FROM p_product OR campaign.group_jid <> p_group OR campaign.caption <> COALESCE(p_caption, '') THEN
      RAISE EXCEPTION 'A referência pertence a outra campanha' USING ERRCODE = '23505';
    END IF;
    SELECT id, status INTO job_id, job_status FROM public.scheduled_messages WHERE user_id = p_user AND campaign_id = campaign.id;
    RETURN jsonb_build_object('id', campaign.id, 'scheduleId', job_id, 'created', false,
      'status', CASE WHEN campaign.published_at IS NOT NULL THEN 'sent' WHEN job_status = 'sent' THEN 'failed' ELSE COALESCE(job_status, 'cancelled') END);
  END IF;

  IF p_when < now() - interval '2 minutes' OR p_when > now() + interval '180 days' THEN
    RAISE EXCEPTION 'A data da campanha está fora do período permitido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO merchant_product FROM public.products p WHERE p.id = p_product AND p.user_id = p_user
    AND p.is_active AND p.price > 0 AND p.stock > 0 AND p.catalog_cover_path LIKE p_user::text || '/%' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto indisponível ou sem fotografia no catálogo' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.agentx_catalog_campaigns(user_id, request_key, product_id, product_name, group_jid, group_name,
    merchant_phone, code, caption, scheduled_at)
  VALUES (p_user, p_key, p_product, left(merchant_product.name, 180), p_group, p_group_name,
    p_merchant_phone, p_code, COALESCE(p_caption, ''), p_when) RETURNING * INTO campaign;
  INSERT INTO public.scheduled_messages(user_id, target_type, group_jid, group_name, message, scheduled_at,
    status, attempts, repeat_days, request_key, campaign_id)
  VALUES (p_user, 'group', p_group, p_group_name, 'Campanha · ' || campaign.product_name, p_when,
    'pending', 0, 0, p_key, campaign.id) RETURNING id INTO job_id;
  RETURN jsonb_build_object('id', campaign.id, 'scheduleId', job_id, 'created', true, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_confirm_catalog_campaign_dispatch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND NEW.status = 'sent' AND OLD.status = 'processing'
    AND NULLIF(btrim(NEW.dispatch_receipt_id), '') IS NOT NULL THEN
    UPDATE public.agentx_catalog_campaigns SET published_at = now(), dispatch_receipt_id = NEW.dispatch_receipt_id
      WHERE id = NEW.campaign_id AND user_id = NEW.user_id AND group_jid = NEW.group_jid AND published_at IS NULL;
  END IF;
  IF NEW.campaign_id IS NOT NULL AND NEW.status = 'pending' AND OLD.status = 'pending'
    AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    UPDATE public.agentx_catalog_campaigns SET scheduled_at = NEW.scheduled_at
      WHERE id = NEW.campaign_id AND user_id = NEW.user_id AND group_jid = NEW.group_jid AND published_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_confirm_catalog_campaign_dispatch ON public.scheduled_messages;
CREATE TRIGGER agentx_confirm_catalog_campaign_dispatch AFTER UPDATE OF status, scheduled_at ON public.scheduled_messages
FOR EACH ROW WHEN (NEW.campaign_id IS NOT NULL) EXECUTE FUNCTION public.agentx_confirm_catalog_campaign_dispatch();

CREATE OR REPLACE FUNCTION public.agentx_capture_catalog_campaign_interest(
  p_user uuid, p_contact uuid, p_code text, p_source_message text, p_message text
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  contact public.contacts%ROWTYPE;
  selected_campaign uuid;
  captured_lead uuid;
  buyer_phone text;
  interest_id uuid;
BEGIN
  IF p_user IS NULL OR p_contact IS NULL OR p_code IS NULL OR p_code !~ '^AXC-[0-9A-F]{32}$'
    OR p_source_message IS NULL OR length(p_source_message) NOT BETWEEN 1 AND 160 THEN RETURN NULL; END IF;
  SELECT c.id INTO selected_campaign FROM public.agentx_catalog_campaigns c
    WHERE c.user_id = p_user AND c.code = p_code AND c.published_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO contact FROM public.contacts c WHERE c.id = p_contact AND c.user_id = p_user FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  buyer_phone := public.agentx_contact_phone(contact.phone);
  IF buyer_phone IS NULL OR buyer_phone = split_part(split_part(contact.lid, '@', 1), ':', 1) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':campaign-interest:' || buyer_phone, 0));
  IF EXISTS (SELECT 1 FROM public.agentx_catalog_campaign_interests i WHERE i.user_id = p_user AND
    (i.source_message_id = p_source_message OR (i.campaign_id = selected_campaign AND i.customer_phone = buyer_phone))) THEN RETURN NULL; END IF;

  captured_lead := public.agentx_capture_sales_lead(p_user, buyer_phone, p_contact, contact.name, 'interest', left(p_message, 500));
  INSERT INTO public.agentx_catalog_campaign_interests(user_id, campaign_id, contact_id, lead_id, customer_phone, source_message_id)
  VALUES (p_user, selected_campaign, p_contact, captured_lead, buyer_phone, p_source_message)
  ON CONFLICT DO NOTHING RETURNING id INTO interest_id;
  RETURN interest_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_link_catalog_campaign_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.lead_id IS NULL AND NEW.lead_id IS NOT NULL AND NEW.catalog_campaign_id IS NULL THEN
    SELECT i.campaign_id INTO NEW.catalog_campaign_id
    FROM public.agentx_catalog_campaign_interests i
    JOIN public.agentx_catalog_campaigns c ON c.id = i.campaign_id AND c.user_id = i.user_id
    WHERE i.user_id = NEW.user_id AND i.lead_id = NEW.lead_id AND i.customer_phone = NEW.customer_phone
      AND i.created_at >= now() - interval '30 days'
      AND EXISTS (SELECT 1 FROM public.order_items item WHERE item.order_id = NEW.id AND item.product_id = c.product_id)
    ORDER BY i.created_at DESC, i.id DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_link_catalog_campaign_order ON public.orders;
CREATE TRIGGER agentx_link_catalog_campaign_order BEFORE UPDATE OF lead_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.agentx_link_catalog_campaign_order();

CREATE OR REPLACE FUNCTION public.agentx_catalog_campaigns_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agentx-catalog-covers' AND NOT public AND file_size_limit = 5242880)
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('public.agentx_catalog_campaigns'), ('public.agentx_catalog_campaign_interests')) AS expected(name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass(expected.name) AND relrowsecurity))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.agentx_catalog_campaign_job_idx') AND indisunique AND indisvalid)
    AND to_regprocedure('public.agentx_queue_catalog_campaign(uuid,uuid,uuid,text,text,text,text,text,timestamptz)') IS NOT NULL
    AND to_regprocedure('public.agentx_capture_catalog_campaign_interest(uuid,uuid,text,text,text)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_queue_catalog_campaign(uuid,uuid,uuid,text,text,text,text,text,timestamptz),
  public.agentx_capture_catalog_campaign_interest(uuid,uuid,text,text,text), public.agentx_confirm_catalog_campaign_dispatch(),
  public.agentx_link_catalog_campaign_order(), public.agentx_catalog_campaigns_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_queue_catalog_campaign(uuid,uuid,uuid,text,text,text,text,text,timestamptz),
  public.agentx_capture_catalog_campaign_interest(uuid,uuid,text,text,text), public.agentx_catalog_campaigns_ready() TO service_role;
GRANT SELECT ON storage.buckets TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

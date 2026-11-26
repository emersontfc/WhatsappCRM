BEGIN;

CREATE FUNCTION public.assert_campaign(condition boolean, description text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', description; END IF;
END;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'b@example.invalid');
INSERT INTO public.users(id, email) SELECT id, email FROM auth.users;
INSERT INTO public.contacts(id, user_id, name, phone) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Cliente A', '258841234567'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'Cliente B', '258841234567');
INSERT INTO public.products(id, user_id, name, price, stock, catalog_cover_path, type) VALUES
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'Livro', 150, 5,
    '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000041', 'physical'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000002', 'Livro da outra loja', 150, 5,
    '00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000041', 'physical'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', 'Sem fotografia', 150, 5, NULL, 'physical');

-- This intentionally represents a legacy storage policy that granted broad browser reads.
CREATE POLICY fixture_read_buckets ON storage.buckets TO anon, authenticated USING (true);
CREATE POLICY fixture_read_objects ON storage.objects TO anon, authenticated USING (true);
INSERT INTO storage.buckets (id, name, public) VALUES ('fixture-other', 'fixture-other', true);
INSERT INTO storage.objects (bucket_id, name) VALUES ('agentx-catalog-covers', 'private-cover'), ('fixture-other', 'outside-cover');

SELECT public.assert_campaign(NOT has_function_privilege('anon', 'public.agentx_catalog_campaigns_ready()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.agentx_catalog_campaigns_ready()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.agentx_queue_catalog_campaign(uuid,uuid,uuid,text,text,text,text,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.agentx_capture_catalog_campaign_interest(uuid,uuid,text,text,text)', 'EXECUTE'),
  'campaign contracts are server-only');

SET LOCAL ROLE authenticated;
SELECT public.assert_campaign(NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agentx-catalog-covers')
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'agentx-catalog-covers')
  AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'fixture-other'), 'private product covers are denied even with a broad older policy');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  merchant_a uuid := '00000000-0000-4000-8000-000000000001';
  merchant_b uuid := '00000000-0000-4000-8000-000000000002';
  contact_a uuid := '00000000-0000-4000-8000-000000000011';
  contact_b uuid := '00000000-0000-4000-8000-000000000012';
  own_product uuid := '00000000-0000-4000-8000-000000000021';
  foreign_product uuid := '00000000-0000-4000-8000-000000000022';
  uncovered_product uuid := '00000000-0000-4000-8000-000000000023';
  request_key uuid := '00000000-0000-4000-8000-000000000031';
  selected_group text := '120369999999999@g.us';
  seller_phone text := '258849876543';
  campaign_code text := 'AXC-' || repeat('A', 32);
  initial jsonb;
  replay jsonb;
  campaign uuid;
  job uuid;
  recorded_interest uuid;
  sale uuid;
  other_order uuid;
BEGIN
  PERFORM public.assert_campaign(public.agentx_catalog_campaigns_ready(), 'campaign module contract available');
  BEGIN
    PERFORM public.agentx_queue_catalog_campaign(merchant_a, request_key, foreign_product, selected_group,
      'Grupo A', seller_phone, campaign_code, '', now());
    RAISE EXCEPTION 'a sale campaign accepted a foreign product';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.agentx_queue_catalog_campaign(merchant_a, request_key, uncovered_product, selected_group,
      'Grupo A', seller_phone, campaign_code, '', now());
    RAISE EXCEPTION 'a sale campaign accepted an uncovered product';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  initial := public.agentx_queue_catalog_campaign(merchant_a, request_key, own_product, selected_group,
    'Grupo A', seller_phone, campaign_code, 'Conhece o nosso livro', now() + interval '10 minutes');
  campaign := (initial->>'id')::uuid;
  job := (initial->>'scheduleId')::uuid;
  replay := public.agentx_queue_catalog_campaign(merchant_a, request_key, own_product, selected_group,
    'Grupo A', seller_phone, 'AXC-' || repeat('B', 32), 'Conhece o nosso livro', now());
  PERFORM public.assert_campaign(initial @> '{"created":true,"status":"pending"}' AND replay = jsonb_build_object('id', campaign, 'scheduleId', job, 'created', false, 'status', 'pending'),
    'the same request preserves one campaign and one Agenda row');
  PERFORM public.assert_campaign((SELECT count(*) = 1 AND bool_and(target_type = 'group' AND group_jid = selected_group AND media_url IS NULL
    AND phone IS NULL AND status = 'pending' AND scheduled_at > now()) FROM public.scheduled_messages WHERE campaign_id = campaign),
    'a campaign queues one valid scoped group job without public file URLs');
  PERFORM public.assert_campaign(public.agentx_capture_catalog_campaign_interest(merchant_a, contact_a, campaign_code, 'early-contact', 'Olá') IS NULL,
    'unpublished campaigns cannot generate leads');
  UPDATE public.scheduled_messages SET scheduled_at = now() + interval '1 day' WHERE id = job AND user_id = merchant_a;
  PERFORM public.assert_campaign((SELECT c.scheduled_at = j.scheduled_at FROM public.agentx_catalog_campaigns c
    JOIN public.scheduled_messages j ON j.campaign_id = c.id WHERE c.id = campaign), 'rescheduling updates the campaign and preserves the original job');

  UPDATE public.scheduled_messages SET status = 'processing' WHERE id = job AND user_id = merchant_a;
  UPDATE public.scheduled_messages SET status = 'sent', dispatch_receipt_id = 'verified-group-ack' WHERE id = job AND user_id = merchant_a;
  PERFORM public.assert_campaign((SELECT dispatch_receipt_id = 'verified-group-ack' AND published_at IS NOT NULL
    FROM public.agentx_catalog_campaigns WHERE id = campaign), 'the same Agenda acknowledgement records publication');
  PERFORM public.assert_campaign(public.agentx_capture_catalog_campaign_interest(merchant_b, contact_b, campaign_code, 'cross-merchant', 'Olá') IS NULL
    AND public.agentx_capture_catalog_campaign_interest(merchant_a, contact_b, campaign_code, 'wrong-contact', 'Olá') IS NULL,
    'campaign and buyer are scoped to the account');
  recorded_interest := public.agentx_capture_catalog_campaign_interest(merchant_a, contact_a, campaign_code, 'valid-private-message', 'Quero o livro');
  PERFORM public.assert_campaign(recorded_interest IS NOT NULL
    AND public.agentx_capture_catalog_campaign_interest(merchant_a, contact_a, campaign_code, 'valid-private-message', 'Quero o livro') IS NULL
    AND public.agentx_capture_catalog_campaign_interest(merchant_a, contact_a, campaign_code, 'repeated-interest', 'Quero o livro') IS NULL,
    'repeat messages and repeat customer interest create a single durable attribution');
  PERFORM public.assert_campaign((SELECT i.campaign_id = campaign AND l.phone = '258841234567' AND l.stage = 'em_atendimento'
    FROM public.agentx_catalog_campaign_interests i JOIN public.leads l ON l.id = i.lead_id WHERE i.id = recorded_interest), 'attribution linked to CRM lead');

  sale := (public.agentx_seller_create_order(merchant_a, own_product, 1, '258841234567', 'Cliente A', contact_a,
    'mpesa', 'AGX-CAMPAIGN', 'explicit-purchase') ->> 'id')::uuid;
  other_order := (public.agentx_seller_create_order(merchant_a, uncovered_product, 1, '258841234567', 'Cliente A', contact_a,
    'mpesa', 'AGX-OTHER', 'explicit-purchase-other') ->> 'id')::uuid;
  PERFORM public.assert_campaign((SELECT catalog_campaign_id = campaign AND status = 'awaiting_payment' FROM public.orders WHERE id = sale)
    AND (SELECT catalog_campaign_id IS NULL FROM public.orders WHERE id = other_order),
    'order traces matching catalog item and stays awaiting manually confirmed payment');
  DELETE FROM public.scheduled_messages WHERE id = job AND user_id = merchant_a;
  PERFORM public.assert_campaign((SELECT published_at IS NOT NULL FROM public.agentx_catalog_campaigns WHERE id = campaign),
    'removing an Agenda history entry preserves publication and lead attribution');
  replay := public.agentx_queue_catalog_campaign(merchant_a, request_key, own_product, selected_group,
    'Grupo A', seller_phone, campaign_code, 'Conhece o nosso livro', now());
  PERFORM public.assert_campaign(replay @> '{"status":"sent","scheduleId":null}',
    'replay after removing a published Agenda entry still reports sent and creates no new job');
END;
$$;
ROLLBACK;

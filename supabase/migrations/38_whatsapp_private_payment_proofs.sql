BEGIN;

INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES ('agentx-direct-proofs','agentx-direct-proofs',false,5242880)
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS agentx_private_direct_proof_objects ON storage.objects;
CREATE POLICY agentx_private_direct_proof_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING (bucket_id <> 'agentx-direct-proofs') WITH CHECK (bucket_id <> 'agentx-direct-proofs');
DROP POLICY IF EXISTS agentx_private_direct_proof_bucket ON storage.buckets;
CREATE POLICY agentx_private_direct_proof_bucket ON storage.buckets AS RESTRICTIVE FOR ALL TO anon,authenticated
USING (id <> 'agentx-direct-proofs') WITH CHECK (id <> 'agentx-direct-proofs');

CREATE TABLE IF NOT EXISTS public.agentx_direct_payment_attachments (
  verification_id uuid PRIMARY KEY REFERENCES public.payment_verifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880)
);
ALTER TABLE public.agentx_direct_payment_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_direct_payment_attachments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.agentx_direct_payment_attachments TO service_role;

CREATE TABLE IF NOT EXISTS public.agentx_direct_proof_intake_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source_message_id text NOT NULL CHECK (length(source_message_id) BETWEEN 1 AND 150),
  reason text NOT NULL CHECK (reason IN ('ambiguous_order','order_unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (user_id,source_message_id)
);
CREATE INDEX IF NOT EXISTS agentx_direct_proof_open_events_idx
  ON public.agentx_direct_proof_intake_events (user_id,created_at DESC,id) WHERE resolved_at IS NULL;
ALTER TABLE public.agentx_direct_proof_intake_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_direct_proof_intake_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.agentx_direct_proof_intake_events TO service_role;
GRANT UPDATE (resolved_at,resolved_by) ON public.agentx_direct_proof_intake_events TO service_role;

CREATE INDEX IF NOT EXISTS agentx_direct_proof_order_lookup_idx ON public.orders (user_id,customer_phone,order_number)
  WHERE status IN ('created','awaiting_payment','verification_pending','rejected','expired');

-- Match image/PDF bytes across channels while preserving hashes already registered by settlement.
CREATE OR REPLACE FUNCTION public.agentx_seller_evidence_hash(p_text text,p_media text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH normalized AS (
    SELECT NULLIF(regexp_replace(regexp_replace(lower(COALESCE(p_text,'')),
      '\m(pedido[[:space:]:#-]*)?agx-[a-z0-9]+(-[a-z0-9]+)*\M',' ','g'),'[^[:alnum:]]','','g'),'') AS proof_text,
      NULLIF(split_part(btrim(p_media),'?',1),'') AS proof_media
  )
  SELECT encode(sha256(convert_to(
    CASE WHEN proof_media ~ '^(agentx-group-proof|agentx-proof-sha256):[0-9a-f]{64}$'
         THEN 'agentx-group-proof:' || split_part(proof_media,':',2)
         WHEN proof_text IS NOT NULL THEN 'text:' || proof_text
         WHEN proof_media IS NOT NULL THEN 'media:' || proof_media END,'UTF8')),'hex')
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.agentx_direct_proof_phone(p_user uuid,p_contact uuid,p_source_message text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_contact_phone(c.phone) FROM public.contacts c
    WHERE c.user_id=p_user AND c.id=p_contact AND public.agentx_contact_phone(c.phone) IS NOT NULL
      AND public.agentx_contact_phone(c.phone) IS DISTINCT FROM split_part(split_part(c.lid,'@',1),':',1)
      AND (p_source_message IS NULL OR (length(p_source_message) BETWEEN 1 AND 150 AND EXISTS (
        SELECT 1 FROM public.messages m WHERE m.user_id=p_user AND m.contact_id=p_contact AND m.msg_id=p_source_message
          AND m.type='inbound' AND m.agentx_live_ingress IS TRUE AND m.agentx_conversation_seq IS NOT NULL
          AND m.media_type IN ('image','document') AND m.media_url IS NULL
          AND m.timestamp BETWEEN statement_timestamp() - interval '5 minutes' AND statement_timestamp() + interval '30 seconds'
      )));
$$;

CREATE OR REPLACE FUNCTION public.agentx_resolve_direct_payment_proof_order(p_user uuid,p_phone text,p_order_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  orders public.orders[];
  target public.orders;
  phones text[] := ARRAY[p_phone,'+' || p_phone,'00' || p_phone];
BEGIN
  IF p_user IS NULL OR p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{7,14}$'
    OR (p_order_number IS NOT NULL AND (length(p_order_number) > 50 OR p_order_number !~ '^AGX-[A-Z0-9]+(-[A-Z0-9]+)*$')) THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_phone ~ '^2588[2-7][0-9]{7}$' THEN phones := phones || ARRAY[substring(p_phone FROM 4),'0' || substring(p_phone FROM 4)]; END IF;

  SELECT array_agg(candidate.order_row) INTO orders FROM (
    SELECT o AS order_row FROM public.orders o WHERE o.user_id=p_user AND o.customer_phone=ANY(phones)
      AND (p_order_number IS NULL OR o.order_number=p_order_number)
      AND o.status IN ('created','awaiting_payment','verification_pending','rejected','expired')
      AND (p_order_number IS NOT NULL OR (o.status<>'expired' AND
        (o.status='verification_pending' OR o.reservation_expires_at IS NULL OR o.reservation_expires_at>statement_timestamp())))
    ORDER BY o.id LIMIT 2
  ) candidate;
  IF COALESCE(cardinality(orders),0)=0 THEN RETURN jsonb_build_object('status','missing'); END IF;
  IF cardinality(orders)>1 THEN RETURN jsonb_build_object('status','ambiguous'); END IF;
  target := orders[1];
  IF target.status='expired' OR (target.status<>'verification_pending' AND target.reservation_expires_at<=statement_timestamp()) THEN
    RETURN jsonb_build_object('status','expired');
  END IF;
  RETURN jsonb_build_object('status','matched','orderId',target.id,'orderNumber',target.order_number,
    'payment',target.seller_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_record_direct_proof_intake_event(
  p_user uuid,p_contact uuid,p_source_message text,p_reason text
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_source_message IS NULL OR public.agentx_direct_proof_phone(p_user,p_contact,p_source_message) IS NULL
    OR p_reason NOT IN ('ambiguous_order','order_unavailable') OR p_reason IS NULL THEN RETURN false; END IF;
  INSERT INTO public.agentx_direct_proof_intake_events(user_id,contact_id,source_message_id,reason)
  VALUES (p_user,p_contact,p_source_message,p_reason) ON CONFLICT (user_id,source_message_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_resolve_direct_proof_event(p_actor uuid,p_org uuid,p_event uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
BEGIN
  SELECT a.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor,p_org,ARRAY['owner','finance_admin']) a;
  IF seller IS NULL OR p_event IS NULL THEN RETURN false; END IF;
  UPDATE public.agentx_direct_proof_intake_events e SET resolved_at=clock_timestamp(),resolved_by=p_actor
    WHERE e.user_id=seller AND e.id=p_event AND e.resolved_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_submit_direct_payment_proof(
  p_user uuid,p_contact uuid,p_phone text,p_source_message text,p_order_number text,p_expected_order uuid,
  p_proof jsonb,p_attachment jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  buyer text := public.agentx_direct_proof_phone(p_user,p_contact,p_source_message);
  target public.orders%ROWTYPE;
  proof public.payment_verifications%ROWTYPE;
  caption text;
  references_found text[];
  selection jsonb;
  media_marker text;
  from_source text := 'direct:' || p_source_message;
  file_path text := p_attachment->>'path';
  file_name text := p_attachment->>'name';
  file_mime text := p_attachment->>'mime';
  file_size integer := (p_attachment->>'size')::integer;
  file_sha text := p_attachment->>'sha256';
BEGIN
  IF p_source_message IS NULL OR buyer IS NULL OR buyer IS DISTINCT FROM p_phone OR p_expected_order IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  SELECT m.text INTO caption FROM public.messages m
    WHERE m.user_id=p_user AND m.contact_id=p_contact AND m.msg_id=p_source_message;
  IF length(caption)>4000 THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT array_agg(DISTINCT upper(ref[1])) INTO references_found
    FROM regexp_matches(caption,'\m(agx-[a-z0-9]+(-[a-z0-9]+)*)\M','gi') ref;
  IF COALESCE(cardinality(references_found),0)>1
    OR references_found[1] IS DISTINCT FROM p_order_number THEN RETURN jsonb_build_object('status','ambiguous'); END IF;
  IF file_path IS NULL OR file_path !~ ('^' || p_user::text || '/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    OR file_name IS NULL OR length(file_name) NOT BETWEEN 1 AND 150 OR file_name ~ '[[:cntrl:]/]'
    OR file_mime IS NULL OR file_mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR file_size IS NULL OR file_size NOT BETWEEN 1 AND 5242880 OR file_sha IS NULL OR file_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Anexo do comprovativo inválido' USING ERRCODE = '22023';
  END IF;
  media_marker := 'agentx-proof-sha256:' || file_sha;

  SELECT * INTO target FROM public.orders o WHERE o.id=p_expected_order AND o.user_id=p_user
    AND public.agentx_contact_phone(o.customer_phone)=buyer FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;

  -- Lock in the same order used by approval. The buyer lock also serializes named order creation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || buyer,0));
  SELECT * INTO proof FROM public.payment_verifications v WHERE v.user_id=p_user AND v.order_id=target.id AND (
    v.source_message_id=from_source OR (v.status='pending' AND v.proof_media_url IN (media_marker,'agentx-group-proof:' || file_sha))
  ) ORDER BY v.created_at,v.id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','duplicate','id',proof.id,'orderId',target.id,'orderNumber',target.order_number);
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_verifications v WHERE v.user_id=p_user AND v.source_message_id=from_source) THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  selection := public.agentx_resolve_direct_payment_proof_order(p_user,buyer,p_order_number);
  IF selection->>'status'<>'matched' THEN RETURN selection; END IF;
  IF selection->>'orderId' IS DISTINCT FROM target.id::text THEN RETURN jsonb_build_object('status','ambiguous'); END IF;
  IF target.status<>'verification_pending' AND target.reservation_expires_at<=clock_timestamp() THEN
    RETURN jsonb_build_object('status','expired');
  END IF;

  INSERT INTO public.payment_verifications(order_id,user_id,customer_phone,provider,transaction_reference,amount,currency,
    sender_phone,sender_name,proof_type,proof_raw_text,proof_media_url,confidence_score,extracted_data,status,source_message_id)
  VALUES (target.id,p_user,target.customer_phone,COALESCE(p_proof->>'provider','other'),COALESCE(p_proof->>'transaction_reference',''),
    COALESCE((p_proof->>'amount')::numeric,0),target.currency,COALESCE(p_proof->>'sender_phone',''),COALESCE(p_proof->>'sender_name',''),
    CASE WHEN file_mime='application/pdf' THEN 'pdf' ELSE 'image' END,caption,media_marker,
    COALESCE((p_proof->>'confidence_score')::numeric,0),COALESCE(p_proof->'extracted_data','{}'::jsonb) ||
      jsonb_build_object('source','whatsapp_private'),'pending',from_source)
  RETURNING * INTO proof;
  INSERT INTO public.agentx_direct_payment_attachments(verification_id,user_id,storage_path,file_name,mime_type,size_bytes)
  VALUES (proof.id,p_user,file_path,file_name,file_mime,file_size);
  UPDATE public.orders SET status='verification_pending',updated_at=now() WHERE id=target.id AND user_id=p_user;
  INSERT INTO public.agent_operations(user_id,order_id,contact_id,phone,step,description,metadata)
  VALUES (p_user,target.id,p_contact,buyer,'verification_pending','Comprovativo recebido no WhatsApp privado. Aguarda conferência no prestador.',
    jsonb_build_object('verificationId',proof.id,'source','whatsapp_private'));
  RETURN jsonb_build_object('status','saved','id',proof.id,'orderId',target.id,'orderNumber',target.order_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_direct_proof_contract_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id='agentx-direct-proofs' AND NOT public AND file_size_limit=5242880)
    AND (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN (to_regclass('public.agentx_direct_payment_attachments'),
      to_regclass('public.agentx_direct_proof_intake_events')) AND relrowsecurity)=2
    AND has_function_privilege('service_role','public.agentx_submit_direct_payment_proof(uuid,uuid,text,text,text,uuid,jsonb,jsonb)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.agentx_submit_direct_payment_proof(uuid,uuid,text,text,text,uuid,jsonb,jsonb)','EXECUTE');
$$;

REVOKE ALL ON FUNCTION public.agentx_direct_proof_phone(uuid,uuid,text),public.agentx_resolve_direct_payment_proof_order(uuid,text,text),
  public.agentx_record_direct_proof_intake_event(uuid,uuid,text,text),public.agentx_submit_direct_payment_proof(uuid,uuid,text,text,text,uuid,jsonb,jsonb),
  public.agentx_resolve_direct_proof_event(uuid,uuid,uuid),public.agentx_direct_proof_contract_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_direct_proof_phone(uuid,uuid,text),public.agentx_resolve_direct_payment_proof_order(uuid,text,text),
  public.agentx_record_direct_proof_intake_event(uuid,uuid,text,text),public.agentx_submit_direct_payment_proof(uuid,uuid,text,text,text,uuid,jsonb,jsonb),
  public.agentx_resolve_direct_proof_event(uuid,uuid,uuid),public.agentx_direct_proof_contract_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

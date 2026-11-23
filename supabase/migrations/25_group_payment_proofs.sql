BEGIN;

CREATE TABLE IF NOT EXISTS public.group_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  group_jid text NOT NULL,
  anti_link boolean DEFAULT false,
  anti_spam boolean DEFAULT false,
  anti_flood boolean DEFAULT false,
  anti_delete boolean DEFAULT false,
  welcome_msg text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, group_jid)
);
ALTER TABLE public.group_rules ADD COLUMN IF NOT EXISTS proof_intake_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.group_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.group_rules TO service_role;

INSERT INTO storage.buckets(id, name, public, file_size_limit)
VALUES ('agentx-group-proofs', 'agentx-group-proofs', false, 5242880)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS agentx_private_group_proof_objects ON storage.objects;
CREATE POLICY agentx_private_group_proof_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'agentx-group-proofs') WITH CHECK (bucket_id <> 'agentx-group-proofs');
DROP POLICY IF EXISTS agentx_private_group_proof_bucket ON storage.buckets;
CREATE POLICY agentx_private_group_proof_bucket ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (id <> 'agentx-group-proofs') WITH CHECK (id <> 'agentx-group-proofs');

CREATE TABLE IF NOT EXISTS public.agentx_group_payment_attachments (
  verification_id uuid PRIMARY KEY REFERENCES public.payment_verifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880)
);
ALTER TABLE public.agentx_group_payment_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_group_payment_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agentx_group_payment_attachments TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_seller_evidence_hash(p_text text, p_media text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH normalized AS (
    SELECT NULLIF(regexp_replace(regexp_replace(lower(COALESCE(p_text, '')),
      '\m(pedido[[:space:]:#-]*)?agx-[a-z0-9]+(-[a-z0-9]+)*\M', ' ', 'g'), '[^[:alnum:]]', '', 'g'), '') AS proof_text,
      NULLIF(split_part(btrim(p_media), '?', 1), '') AS proof_media
  )
  SELECT encode(sha256(convert_to(
    CASE WHEN proof_media ~ '^agentx-group-proof:[0-9a-f]{64}$' THEN proof_media
         WHEN proof_text IS NOT NULL THEN 'text:' || proof_text
         WHEN proof_media IS NOT NULL THEN 'media:' || proof_media END, 'UTF8')), 'hex')
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.agentx_submit_group_payment_proof(
  p_user uuid, p_group text, p_order uuid, p_phone text, p_source_message text,
  p_proof jsonb, p_attachment jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target public.orders%ROWTYPE;
  proof public.payment_verifications%ROWTYPE;
  raw_text text := btrim(COALESCE(p_proof->>'proof_raw_text', ''));
  file_path text := p_attachment->>'path';
  file_name text := p_attachment->>'name';
  file_mime text := p_attachment->>'mime';
  file_size integer := (p_attachment->>'size')::integer;
  file_sha text := p_attachment->>'sha256';
  media_marker text;
BEGIN
  IF p_user IS NULL OR p_group IS NULL OR p_group !~ '^[0-9]+(-[0-9]+)?@g[.]us$'
    OR p_source_message IS NULL OR length(p_source_message) > 160
    OR left(p_source_message, length('group:' || p_group || ':')) <> 'group:' || p_group || ':'
    OR length(p_source_message) <= length('group:' || p_group || ':')
    OR length(raw_text) NOT BETWEEN 6 AND 4000 THEN
    RAISE EXCEPTION 'Origem ou comprovativo inválido' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.group_rules WHERE user_id = p_user AND group_jid = p_group AND proof_intake_enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receção de comprovativos desativada para este grupo' USING ERRCODE = '42501'; END IF;

  SELECT * INTO target FROM public.orders WHERE id = p_order AND user_id = p_user
    AND customer_phone = p_phone FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido indisponível para o remetente' USING ERRCODE = 'P0002'; END IF;

  IF p_attachment IS NOT NULL THEN
    IF file_path IS NULL OR file_path !~ ('^' || p_user::text || '/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      OR file_name IS NULL OR length(file_name) NOT BETWEEN 1 AND 150 OR file_name ~ '[[:cntrl:]/]'
      OR file_mime IS NULL OR file_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      OR file_size IS NULL OR file_size NOT BETWEEN 1 AND 5242880
      OR file_sha IS NULL OR file_sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Anexo do comprovativo inválido' USING ERRCODE = '22023';
    END IF;
    media_marker := 'agentx-group-proof:' || file_sha;
  END IF;

  SELECT * INTO proof FROM public.payment_verifications v
  WHERE v.user_id = p_user AND v.order_id = p_order AND (
    v.source_message_id = p_source_message OR (v.status = 'pending' AND
      ((media_marker IS NOT NULL AND v.proof_media_url = media_marker) OR
       (media_marker IS NULL AND COALESCE(v.proof_media_url, '') = '' AND v.proof_raw_text = raw_text)))
  ) ORDER BY v.created_at, v.id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('id', proof.id, 'created', false); END IF;

  IF target.status NOT IN ('created', 'awaiting_payment', 'verification_pending', 'rejected') THEN
    RAISE EXCEPTION 'O pedido já saiu da fila de pagamento' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_verifications (order_id, user_id, customer_phone, provider, transaction_reference,
    amount, currency, sender_phone, sender_name, proof_type, proof_raw_text, proof_media_url, confidence_score,
    extracted_data, status, source_message_id)
  VALUES (p_order, p_user, p_phone, COALESCE(p_proof->>'provider', 'other'), COALESCE(p_proof->>'transaction_reference', ''),
    COALESCE((p_proof->>'amount')::numeric, 0), target.currency, COALESCE(p_proof->>'sender_phone', ''),
    COALESCE(p_proof->>'sender_name', ''), CASE WHEN file_mime = 'application/pdf' THEN 'pdf'
      WHEN media_marker IS NOT NULL THEN 'image' ELSE COALESCE(p_proof->>'proof_type', 'text') END,
    raw_text, COALESCE(media_marker, ''), COALESCE((p_proof->>'confidence_score')::numeric, 0),
    COALESCE(p_proof->'extracted_data', '{}'::jsonb) || jsonb_build_object('source', 'whatsapp_group', 'groupJid', p_group),
    'pending', p_source_message)
  RETURNING * INTO proof;

  IF file_path IS NOT NULL THEN
    INSERT INTO public.agentx_group_payment_attachments (verification_id, user_id, storage_path, file_name, mime_type, size_bytes)
    VALUES (proof.id, p_user, file_path, file_name, file_mime, file_size);
  END IF;
  UPDATE public.orders SET status = 'verification_pending', updated_at = now()
    WHERE id = p_order AND user_id = p_user;
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description, metadata)
  VALUES (p_user, p_order, p_phone, 'verification_pending', 'Comprovativo recebido num grupo. Aguarda confirmação no prestador.',
    jsonb_build_object('verificationId', proof.id, 'source', 'whatsapp_group', 'groupJid', p_group));
  RETURN jsonb_build_object('id', proof.id, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_group_proof_contract_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agentx-group-proofs' AND NOT public)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = to_regclass('public.group_rules')
      AND attname = 'proof_intake_enabled' AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass('public.agentx_group_payment_attachments') AND relrowsecurity)
    AND to_regprocedure('public.agentx_submit_group_payment_proof(uuid,text,uuid,text,text,jsonb,jsonb)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_submit_group_payment_proof(uuid,text,uuid,text,text,jsonb,jsonb),
  public.agentx_group_proof_contract_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_submit_group_payment_proof(uuid,text,uuid,text,text,jsonb,jsonb),
  public.agentx_group_proof_contract_ready() TO service_role;
GRANT SELECT ON storage.buckets TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

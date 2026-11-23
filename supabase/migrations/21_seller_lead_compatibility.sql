BEGIN;

-- Older installations already have leads, so a CREATE TABLE IF NOT EXISTS
-- at server startup never added these columns.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS last_message text,
  ADD COLUMN IF NOT EXISTS last_action text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS interest_level text,
  ADD COLUMN IF NOT EXISTS value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_to text DEFAULT '',
  ADD COLUMN IF NOT EXISTS follow_up_date timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.leads'::regclass AND attname = 'stage' AND atthasdef
  ) THEN
    ALTER TABLE public.leads ALTER COLUMN stage SET DEFAULT 'novo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.leads'::regclass AND attname = 'status' AND atthasdef
  ) THEN
    ALTER TABLE public.leads ALTER COLUMN status SET DEFAULT 'new';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.leads'::regclass AND attname = 'created_at' AND atthasdef
  ) THEN
    ALTER TABLE public.leads ALTER COLUMN created_at SET DEFAULT now();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.leads'::regclass AND attname = 'updated_at' AND atthasdef
  ) THEN
    ALTER TABLE public.leads ALTER COLUMN updated_at SET DEFAULT now();
  END IF;
END;
$$;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agentx_leads_require_owner ON public.leads;
CREATE POLICY agentx_leads_require_owner ON public.leads AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS agentx_leads_owner_access ON public.leads;
CREATE POLICY agentx_leads_owner_access ON public.leads
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.leads TO authenticated;

-- Do not merge rows or break existing references when historical duplicates exist.
CREATE INDEX IF NOT EXISTS agentx_leads_phone_lookup
  ON public.leads (user_id, public.agentx_contact_phone(phone));

CREATE OR REPLACE FUNCTION public.agentx_capture_sales_lead(
  p_user uuid, p_phone text, p_contact uuid, p_name text, p_activity text, p_message text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  lead_id uuid;
  contact public.contacts%ROWTYPE;
  canonical_phone text := public.agentx_contact_phone(p_phone);
  linked_phone text;
  current_message text := NULLIF(left(btrim(p_message), 500), '');
  action_summary text;
  desired_stage text;
  desired_status text;
BEGIN
  IF p_user IS NULL OR canonical_phone IS NULL OR p_activity IS NULL
    OR p_activity NOT IN ('inbound', 'catalog', 'interest', 'order', 'sold', 'manual') THEN
    RAISE EXCEPTION 'Identidade ou atividade comercial inválida' USING ERRCODE = '22023';
  END IF;
  IF p_contact IS NOT NULL THEN
    SELECT * INTO contact FROM public.contacts c WHERE c.id = p_contact AND c.user_id = p_user FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contacto não pertence à conta' USING ERRCODE = '42501';
    END IF;
    linked_phone := public.agentx_contact_phone(contact.phone);
    IF (linked_phone IS NOT NULL AND linked_phone <> canonical_phone)
      OR canonical_phone = split_part(split_part(contact.lid, '@', 1), ':', 1) THEN
      RAISE EXCEPTION 'O telefone não corresponde ao contacto' USING ERRCODE = '22023';
    END IF;
  END IF;

  CASE p_activity
    WHEN 'sold' THEN
      desired_stage := 'venda_fechada'; desired_status := 'closed'; action_summary := 'Pagamento confirmado';
    WHEN 'order' THEN
      desired_stage := 'proposta_enviada'; desired_status := 'qualified'; action_summary := 'Pedido criado · a aguardar pagamento';
    WHEN 'interest' THEN
      desired_stage := 'em_atendimento'; desired_status := 'contacted'; action_summary := 'Interesse registado pelo agente';
    WHEN 'catalog' THEN
      desired_stage := 'em_atendimento'; desired_status := 'contacted'; action_summary := 'Consulta ao catálogo';
    WHEN 'manual' THEN
      desired_stage := 'novo'; desired_status := 'new'; action_summary := 'Lead criado manualmente';
    ELSE
      desired_stage := 'novo'; desired_status := 'new'; action_summary := 'Mensagem recebida';
  END CASE;

  -- Every sales writer uses this lock. Older databases can lack a unique phone
  -- constraint or already contain duplicates, and must still accept sales.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || canonical_phone, 0));
  SELECT l.id INTO lead_id FROM public.leads l
  WHERE l.user_id = p_user AND (
    public.agentx_contact_phone(l.phone) = canonical_phone OR
    (l.contact_id = p_contact AND public.agentx_contact_phone(l.phone) IS NULL)
  )
  ORDER BY (l.contact_id = p_contact) DESC NULLS LAST,
    (l.phone = canonical_phone) DESC NULLS LAST, l.created_at NULLS LAST, l.id
  LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.leads (user_id, phone, contact_id, name, stage, status, last_message, last_action, source)
    VALUES (p_user, canonical_phone, p_contact,
      COALESCE(NULLIF(btrim(contact.name), ''), NULLIF(btrim(p_name), ''), canonical_phone),
      desired_stage, desired_status, current_message, action_summary,
      CASE WHEN p_activity = 'manual' THEN 'manual' ELSE 'whatsapp' END)
    ON CONFLICT DO NOTHING RETURNING id INTO lead_id;
    IF FOUND THEN RETURN lead_id; END IF;

    -- A pre-existing unique index can conflict with a legacy upsert outside this RPC.
    SELECT l.id INTO STRICT lead_id FROM public.leads l
    WHERE l.user_id = p_user AND l.phone = canonical_phone LIMIT 1 FOR UPDATE;
  END IF;

  UPDATE public.leads l SET
    contact_id = COALESCE(l.contact_id, p_contact),
    last_message = COALESCE(current_message, l.last_message),
    last_action = CASE WHEN p_activity IN ('inbound', 'manual') THEN l.last_action ELSE action_summary END,
    stage = CASE
      WHEN p_activity IN ('inbound', 'manual') THEN l.stage
      WHEN p_activity = 'sold' OR l.stage = 'venda_fechada' OR l.status = 'closed' THEN 'venda_fechada'
      WHEN p_activity = 'order' THEN desired_stage
      WHEN l.stage IS NULL AND l.status = 'lost' THEN 'perdido'
      WHEN l.stage IS NULL AND l.status = 'qualified' THEN 'proposta_enviada'
      WHEN l.stage IS NULL OR l.stage = 'novo' THEN desired_stage
      ELSE l.stage END,
    status = CASE
      WHEN p_activity IN ('inbound', 'manual') THEN l.status
      WHEN p_activity = 'sold' OR l.stage = 'venda_fechada' OR l.status = 'closed' THEN 'closed'
      WHEN p_activity = 'order' THEN desired_status
      WHEN l.stage IS NULL AND l.status IN ('lost', 'qualified') THEN l.status
      WHEN l.stage IS NULL OR l.stage = 'novo' THEN desired_status
      ELSE l.status END,
    updated_at = now()
  WHERE l.id = lead_id AND l.user_id = p_user;
  RETURN lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_qualify_sales_lead(
  p_user uuid, p_phone text, p_contact uuid, p_name text, p_message text,
  p_interest text, p_tag text, p_note text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  phone_number text := public.agentx_contact_phone(p_phone);
  target_contact_id uuid := p_contact;
  lead_id uuid;
  saved_interest text;
  interest text := NULLIF(btrim(p_interest), '');
  tag text := NULLIF(btrim(p_tag), '');
  note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_user IS NULL OR phone_number IS NULL THEN
    RAISE EXCEPTION 'O contacto precisa de um telefone válido' USING ERRCODE = '22023';
  END IF;
  IF interest NOT IN ('alto', 'medio', 'baixo') OR length(tag) > 64 OR length(note) > 500 THEN
    RAISE EXCEPTION 'Dados de qualificação inválidos' USING ERRCODE = '22023';
  END IF;

  IF target_contact_id IS NULL THEN
    SELECT c.id INTO target_contact_id FROM public.contacts c
    WHERE c.user_id = p_user AND public.agentx_contact_phone(c.phone) = phone_number
      AND phone_number IS DISTINCT FROM split_part(split_part(c.lid, '@', 1), ':', 1)
    ORDER BY c.agentx_legacy_phone_duplicate, (c.phone = phone_number) DESC, c.created_at NULLS LAST, c.id
    LIMIT 1;
  END IF;
  IF target_contact_id IS NULL THEN
    RAISE EXCEPTION 'Contacto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Capture validates both the account and telephone before this transaction
  -- can save the qualification or touch the contact's tags.
  lead_id := public.agentx_capture_sales_lead(p_user, phone_number, target_contact_id, p_name, 'interest', p_message);
  UPDATE public.leads l SET
    interest_level = COALESCE(interest, l.interest_level),
    notes = CASE
      WHEN note IS NULL OR strpos(E'\n' || COALESCE(l.notes, '') || E'\n', E'\n' || note || E'\n') > 0 THEN l.notes
      ELSE concat_ws(E'\n', NULLIF(l.notes, ''), note) END
  WHERE l.id = lead_id AND l.user_id = p_user
  RETURNING l.interest_level INTO saved_interest;

  IF tag IS NOT NULL THEN
    UPDATE public.contacts c SET tags = array_append(COALESCE(c.tags, '{}'::text[]), tag)
    WHERE c.id = target_contact_id AND c.user_id = p_user AND NOT COALESCE(tag = ANY(c.tags), false);
  END IF;

  RETURN jsonb_build_object('id', lead_id, 'contactId', target_contact_id, 'phone', phone_number,
    'interestLevel', saved_interest, 'tag', tag);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_save_manual_lead(
  p_user uuid, p_phone text, p_contact uuid, p_name text, p_stage text, p_source text,
  p_value numeric DEFAULT NULL, p_notes text DEFAULT NULL, p_message text DEFAULT NULL,
  p_set_value boolean DEFAULT false, p_set_notes boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  phone_number text := public.agentx_contact_phone(p_phone);
  target_contact_id uuid := p_contact;
  target_lead_id uuid;
  lead_name text := NULLIF(btrim(p_name), '');
  source_name text := NULLIF(btrim(p_source), '');
  saved jsonb;
BEGIN
  IF p_user IS NULL OR phone_number IS NULL
    OR p_stage NOT IN ('novo', 'em_atendimento', 'proposta_enviada', 'venda_fechada', 'perdido')
    OR length(lead_name) > 150 OR source_name !~ '^[a-z][a-z0-9_-]{0,39}$'
    OR length(p_notes) > 3000 OR length(p_message) > 500
    OR (p_value IS NOT NULL AND (p_value < 0 OR p_value > 9999999999.99 OR round(p_value, 2) <> p_value)) THEN
    RAISE EXCEPTION 'Dados de lead inválidos' USING ERRCODE = '22023';
  END IF;
  IF target_contact_id IS NULL THEN
    SELECT c.id INTO target_contact_id FROM public.contacts c
    WHERE c.user_id = p_user AND public.agentx_contact_phone(c.phone) = phone_number
      AND phone_number IS DISTINCT FROM split_part(split_part(c.lid, '@', 1), ':', 1)
    ORDER BY c.agentx_legacy_phone_duplicate, (c.phone = phone_number) DESC, c.created_at NULLS LAST, c.id
    LIMIT 1;
  END IF;

  target_lead_id := public.agentx_capture_sales_lead(p_user, phone_number, target_contact_id, lead_name, 'manual');
  UPDATE public.leads l SET
    name = COALESCE(lead_name, l.name),
    source = COALESCE(source_name, l.source),
    stage = COALESCE(p_stage, l.stage),
    status = CASE p_stage
      WHEN 'novo' THEN 'new'
      WHEN 'em_atendimento' THEN 'contacted'
      WHEN 'proposta_enviada' THEN 'qualified'
      WHEN 'venda_fechada' THEN 'closed'
      WHEN 'perdido' THEN 'lost'
      ELSE l.status END,
    value = CASE WHEN p_set_value THEN p_value ELSE l.value END,
    notes = CASE WHEN p_set_notes THEN p_notes ELSE l.notes END,
    last_message = COALESCE(p_message, l.last_message)
  WHERE l.id = target_lead_id AND l.user_id = p_user
  RETURNING to_jsonb(l) INTO saved;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_contract_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT
    NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('public.leads', 'id'), ('public.leads', 'user_id'), ('public.leads', 'phone'),
        ('public.leads', 'contact_id'), ('public.leads', 'name'), ('public.leads', 'stage'), ('public.leads', 'status'),
        ('public.leads', 'last_message'), ('public.leads', 'last_action'), ('public.leads', 'source'),
        ('public.leads', 'interest_level'), ('public.leads', 'notes'), ('public.leads', 'value'),
        ('public.leads', 'created_at'), ('public.leads', 'updated_at'),
        ('public.contacts', 'lid'), ('public.contacts', 'tags'), ('public.contacts', 'agentx_legacy_phone_duplicate'),
        ('public.orders', 'seller_payment'), ('public.orders', 'source_message_id'),
        ('public.payment_verifications', 'source_message_id')
      ) AS required(relation, field)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = to_regclass(required.relation) AND a.attname = required.field
          AND a.attnum > 0 AND NOT a.attisdropped
      )
    )
    AND to_regprocedure('public.agentx_capture_sales_lead(uuid,text,uuid,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_qualify_sales_lead(uuid,text,uuid,text,text,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_save_manual_lead(uuid,text,uuid,text,text,text,numeric,text,text,boolean,boolean)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_create_order(uuid,uuid,integer,text,text,uuid,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_submit_proof(uuid,uuid,text,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_approve_order(uuid,uuid,text,text,text,numeric)') IS NOT NULL
    AND to_regprocedure('public.agentx_seller_reject_order(uuid,uuid,text)') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class t
      JOIN pg_catalog.pg_policy p ON p.polrelid = t.oid
      WHERE t.oid = to_regclass('public.leads') AND t.relrowsecurity
        AND p.polname = 'agentx_leads_require_owner' AND NOT p.polpermissive
    )
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('public.agentx_order_source_message_uidx'), ('public.agentx_proof_by_whatsapp_message')) AS required(index_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indexrelid = to_regclass(required.index_name) AND i.indisunique AND i.indisvalid
      )
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = to_regclass('public.agentx_seller_settlements') AND c.contype = 'u' AND c.convalidated
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (user_id, method, reference_key)'
    );
$$;

GRANT SELECT, INSERT, UPDATE ON public.leads TO service_role;
REVOKE ALL ON FUNCTION public.agentx_capture_sales_lead(uuid,text,uuid,text,text,text),
  public.agentx_qualify_sales_lead(uuid,text,uuid,text,text,text,text,text),
  public.agentx_save_manual_lead(uuid,text,uuid,text,text,text,numeric,text,text,boolean,boolean),
  public.agentx_seller_contract_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_capture_sales_lead(uuid,text,uuid,text,text,text),
  public.agentx_qualify_sales_lead(uuid,text,uuid,text,text,text,text,text),
  public.agentx_save_manual_lead(uuid,text,uuid,text,text,text,numeric,text,text,boolean,boolean),
  public.agentx_seller_contract_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

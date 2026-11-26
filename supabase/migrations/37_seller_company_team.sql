BEGIN;

CREATE TABLE IF NOT EXISTS public.agentx_seller_organizations (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  owner_account_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agentx_seller_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_seller_organizations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agentx_seller_organizations TO service_role;
-- Row-share access serializes with maintenance changes to the binding.
GRANT UPDATE (linked_at) ON public.agentx_seller_organizations TO service_role;

CREATE INDEX IF NOT EXISTS agentx_seller_org_members_lookup_idx ON public.organization_members (user_id, organization_id)
  WHERE role IN ('owner', 'operator', 'finance_admin');
GRANT SELECT, INSERT, UPDATE ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO service_role;

CREATE SCHEMA IF NOT EXISTS agentx_team_internal;
REVOKE ALL ON SCHEMA agentx_team_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA agentx_team_internal TO service_role;

CREATE OR REPLACE FUNCTION agentx_team_internal.has_verified_email(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (auth.uid() IS NULL OR auth.uid() = p_actor) AND EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_actor AND u.email_confirmed_at IS NOT NULL
      AND NULLIF(btrim(u.email), '') IS NOT NULL AND u.deleted_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION agentx_team_internal.resolve_access(p_actor uuid, p_org uuid, p_allowed_roles text[])
RETURNS TABLE (organization_id uuid, account_id uuid, role text, name text)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target_org uuid := p_org;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Acesso à empresa comercial negado' USING ERRCODE = '42501';
  END IF;
  IF target_org IS NULL THEN
    SELECT b.organization_id INTO target_org FROM public.agentx_seller_organizations b WHERE b.owner_account_id = p_actor;
    IF NOT FOUND AND 'owner' = ANY(p_allowed_roles) THEN
      RETURN QUERY SELECT NULL::uuid, p_actor, 'owner'::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT o.id, b.owner_account_id, m.role, o.name
  FROM public.agentx_seller_organizations b JOIN public.organizations o ON o.id = b.organization_id
    JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = p_actor
  WHERE o.id = target_org AND o.status = 'active' AND o.owner_user_id = b.owner_account_id
    AND m.role IN ('owner', 'operator', 'finance_admin') AND m.role = ANY(p_allowed_roles)
    AND CASE WHEN m.role = 'owner' THEN p_actor = b.owner_account_id ELSE agentx_team_internal.has_verified_email(p_actor) END
  FOR SHARE OF b, o, m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acesso à empresa comercial negado' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION agentx_team_internal.audit_order_action(
  p_account uuid, p_order uuid, p_actor uuid, p_step text, p_proof uuid DEFAULT NULL
) RETURNS void LANGUAGE sql SET search_path = '' AS $$
  UPDATE public.agent_operations a SET metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('actorId', p_actor)
  WHERE a.user_id = p_account AND a.order_id = p_order AND a.step = p_step AND a.created_at = transaction_timestamp()
    AND (p_step <> 'admin_rejected' OR a.metadata->>'verificationId' IS NOT DISTINCT FROM p_proof::text)
    AND (p_step <> 'fulfilled' OR a.metadata->>'source' = 'operator_review');
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_cancel_order(p_actor uuid, p_org uuid, p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
  prior_status text;
  result jsonb;
BEGIN
  SELECT access.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner', 'operator']) access;
  SELECT o.status INTO prior_status FROM public.orders o WHERE o.id = p_order AND o.user_id = seller FOR UPDATE;
  result := public.agentx_seller_cancel_order(seller, p_order);
  IF prior_status <> 'cancelled' THEN
    PERFORM agentx_team_internal.audit_order_action(seller, p_order, p_actor, 'order_cancelled');
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_confirm_payment(
  p_actor uuid, p_org uuid, p_order uuid, p_note text, p_verified boolean,
  p_reference text DEFAULT NULL, p_method text DEFAULT NULL, p_proof uuid DEFAULT NULL, p_amount numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
  prior_status text;
  pending_proofs uuid[];
  result jsonb;
BEGIN
  SELECT access.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner', 'finance_admin']) access;
  SELECT o.status INTO prior_status FROM public.orders o WHERE o.id = p_order AND o.user_id = seller FOR UPDATE;
  IF prior_status = 'verification_pending' THEN
    SELECT array_agg(v.id) INTO pending_proofs FROM public.payment_verifications v
      WHERE v.user_id = seller AND v.order_id = p_order AND v.status = 'pending';
  END IF;

  result := public.agentx_seller_confirm_payment(seller, p_order, p_note, p_verified, p_reference, p_method, p_proof, p_amount);
  IF prior_status = 'verification_pending' AND result->>'status' = 'paid' THEN
    UPDATE public.orders o SET approved_by = p_actor WHERE o.id = p_order AND o.user_id = seller RETURNING to_jsonb(o) INTO result;
    UPDATE public.payment_verifications v SET reviewed_by = p_actor
    WHERE v.user_id = seller AND v.id = ANY(pending_proofs) AND v.reviewed_by = seller
      AND v.reviewed_at = transaction_timestamp() AND v.status IN ('approved', 'rejected');
    PERFORM agentx_team_internal.audit_order_action(seller, p_order, p_actor, 'admin_approved');
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_reject_payment(
  p_actor uuid, p_org uuid, p_order uuid, p_reason text, p_proof uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
  pending_proofs uuid[];
  result jsonb;
BEGIN
  SELECT access.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner', 'finance_admin']) access;
  PERFORM 1 FROM public.orders o WHERE o.id = p_order AND o.user_id = seller FOR UPDATE;
  SELECT array_agg(v.id) INTO pending_proofs FROM public.payment_verifications v
    WHERE v.user_id = seller AND v.order_id = p_order AND v.status = 'pending' AND (p_proof IS NULL OR v.id = p_proof);
  IF p_proof IS NULL THEN
    result := jsonb_build_object('order', public.agentx_seller_reject_order(seller, p_order, p_reason), 'notify', true);
  ELSE
    result := public.agentx_seller_reject_proof(seller, p_order, p_proof, p_reason);
  END IF;
  UPDATE public.payment_verifications v SET reviewed_by = p_actor
  WHERE v.user_id = seller AND v.id = ANY(pending_proofs) AND v.reviewed_by = seller
    AND v.reviewed_at = transaction_timestamp() AND v.status = 'rejected';
  IF p_proof IS NULL OR cardinality(pending_proofs) > 0 THEN
    PERFORM agentx_team_internal.audit_order_action(seller, p_order, p_actor, 'admin_rejected', p_proof);
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_claim_delivery(
  p_actor uuid, p_org uuid, p_order uuid, p_started_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
BEGIN
  IF p_started_at IS NULL THEN RAISE EXCEPTION 'Data de entrega inválida' USING ERRCODE = '22023'; END IF;
  SELECT access.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner', 'operator']) access;
  UPDATE public.orders o SET delivery_started_at = p_started_at, delivery_error = NULL
  WHERE o.id = p_order AND o.user_id = seller AND o.status = 'paid' AND o.delivery_started_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_confirm_delivery(p_actor uuid, p_org uuid, p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  seller uuid;
  prior_status text;
  result jsonb;
BEGIN
  SELECT access.account_id INTO seller FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner', 'operator']) access;
  SELECT o.status INTO prior_status FROM public.orders o WHERE o.id = p_order AND o.user_id = seller FOR UPDATE;
  result := public.agentx_seller_confirm_delivery(seller, p_order);
  IF prior_status <> 'fulfilled' THEN
    PERFORM agentx_team_internal.audit_order_action(seller, p_order, p_actor, 'fulfilled');
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_access(p_actor uuid, p_org uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT to_jsonb(access) FROM agentx_team_internal.resolve_access(p_actor, p_org,
    ARRAY['owner', 'operator', 'finance_admin']) access;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_list(p_actor uuid)
RETURNS TABLE (organization_id uuid, name text, role text, linked boolean)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT o.id, o.name, m.role, b.organization_id IS NOT NULL
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  LEFT JOIN public.agentx_seller_organizations b ON b.organization_id = o.id AND b.owner_account_id = o.owner_user_id
  WHERE m.user_id = p_actor AND o.status = 'active' AND m.role IN ('owner', 'operator', 'finance_admin')
    AND CASE WHEN m.role = 'owner' THEN o.owner_user_id = p_actor
      ELSE b.organization_id IS NOT NULL AND agentx_team_internal.has_verified_email(p_actor) END
  ORDER BY o.name, o.id;
$$;

CREATE OR REPLACE FUNCTION public.agentx_link_seller_organization(
  p_actor uuid, p_org uuid DEFAULT NULL, p_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target_org uuid := p_org;
  linked_org uuid;
  organization_name text := btrim(p_name);
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Acesso à empresa comercial negado' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text || ':seller-company-link', 0));
  SELECT b.organization_id INTO linked_org FROM public.agentx_seller_organizations b WHERE b.owner_account_id = p_actor;
  IF FOUND THEN
    IF p_org IS NOT NULL AND p_org <> linked_org THEN
      RAISE EXCEPTION 'Esta conta já tem uma empresa comercial ligada' USING ERRCODE = '23505';
    END IF;
    RETURN public.agentx_seller_team_access(p_actor, linked_org);
  END IF;

  IF target_org IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_user_id = p_actor) THEN
      RAISE EXCEPTION 'Escolhe uma empresa existente para ligar ao WhatsApp' USING ERRCODE = '22023';
    END IF;
    IF organization_name IS NULL OR length(organization_name) NOT BETWEEN 2 AND 120 THEN
      RAISE EXCEPTION 'Indica o nome da empresa' USING ERRCODE = '22023';
    END IF;
    target_org := public.agentx_create_organization(p_actor, organization_name, 'vendas-' || gen_random_uuid()::text);
  END IF;

  PERFORM public.agentx_assert_role(target_org, p_actor, ARRAY['owner']);
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = target_org AND o.owner_user_id = p_actor) THEN
    RAISE EXCEPTION 'Acesso à empresa comercial negado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.agentx_seller_organizations (organization_id, owner_account_id) VALUES (target_org, p_actor);
  RETURN public.agentx_seller_team_access(p_actor, target_org);
END;
$$;

-- Only these private functions need auth.users. They check the actor against
-- the organization again and expose only email and the member identity.
CREATE OR REPLACE FUNCTION agentx_team_internal.verified_member(p_actor uuid, p_org uuid, p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  email_address text := lower(btrim(p_email));
  results uuid[];
BEGIN
  IF p_org IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() <> p_actor) THEN
    RAISE EXCEPTION 'Acesso à equipa negado' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner']);
  IF email_address IS NULL OR length(email_address) > 254 OR email_address !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Indica um e-mail válido' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(candidate.id) INTO results FROM (
    SELECT u.id FROM auth.users u WHERE lower(u.email) = email_address
      AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL LIMIT 2
  ) candidate;
  IF cardinality(results) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Não foi encontrada uma conta confirmada com esse e-mail' USING ERRCODE = 'P0002';
  END IF;
  RETURN results[1];
END;
$$;

CREATE OR REPLACE FUNCTION agentx_team_internal.list_members(p_actor uuid, p_org uuid)
RETURNS TABLE (user_id uuid, email text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() <> p_actor) THEN
    RAISE EXCEPTION 'Acesso à equipa negado' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner']);
  RETURN QUERY SELECT m.user_id, CASE WHEN u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL THEN u.email::text END, m.role
  FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org AND m.role IN ('owner', 'operator', 'finance_admin')
  ORDER BY (m.role = 'owner') DESC, u.email, m.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_members(p_actor uuid, p_org uuid)
RETURNS TABLE (user_id uuid, email text, role text)
LANGUAGE sql SET search_path = '' AS $$
  SELECT * FROM agentx_team_internal.list_members(p_actor, p_org);
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_set_member(
  p_actor uuid, p_org uuid, p_role text, p_email text DEFAULT NULL, p_member uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  member_id uuid;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'Seleciona a empresa da equipa' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM agentx_team_internal.resolve_access(p_actor, p_org, ARRAY['owner']);
  IF p_role IS NULL AND p_member IS NOT NULL AND p_email IS NULL AND p_member <> p_actor THEN
    DELETE FROM public.organization_members m WHERE m.organization_id = p_org AND m.user_id = p_member
      AND m.role IN ('operator', 'finance_admin');
    RETURN jsonb_build_object('user_id', p_member, 'role', NULL);
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('operator', 'finance_admin') OR p_member IS NOT NULL THEN
    RAISE EXCEPTION 'Papel da equipa inválido' USING ERRCODE = '22023';
  END IF;

  member_id := agentx_team_internal.verified_member(p_actor, p_org, p_email);
  IF member_id = p_actor THEN RAISE EXCEPTION 'O papel do proprietário é fixo' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (p_org, member_id, p_role)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE organization_members.role IN ('operator', 'finance_admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'A conta já tem outro papel nesta empresa' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('user_id', member_id, 'role', p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_team_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_seller_reservations_ready()
    AND to_regprocedure('public.agentx_assert_role(uuid,uuid,text[])') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.agentx_seller_organizations') AND c.relrowsecurity)
    AND NOT has_schema_privilege('authenticated', 'agentx_team_internal', 'USAGE')
    AND NOT has_schema_privilege('anon', 'agentx_team_internal', 'USAGE')
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('email_confirmed_at'), ('deleted_at')) fields(name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('auth.users')
        AND a.attname = fields.name AND NOT a.attisdropped))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('public.agentx_seller_team_access(uuid,uuid)'), ('public.agentx_seller_team_list(uuid)'),
        ('public.agentx_link_seller_organization(uuid,uuid,text)'), ('public.agentx_seller_team_members(uuid,uuid)'),
        ('public.agentx_seller_team_set_member(uuid,uuid,text,text,uuid)'), ('public.agentx_seller_team_cancel_order(uuid,uuid,uuid)'),
        ('public.agentx_seller_team_confirm_payment(uuid,uuid,uuid,text,boolean,text,text,uuid,numeric)'),
        ('public.agentx_seller_team_reject_payment(uuid,uuid,uuid,text,uuid)'),
        ('public.agentx_seller_team_claim_delivery(uuid,uuid,uuid,timestamptz)'),
        ('public.agentx_seller_team_confirm_delivery(uuid,uuid,uuid)')
      ) functions(signature)
      WHERE NOT COALESCE(has_function_privilege('service_role', to_regprocedure(functions.signature), 'EXECUTE'), false)
        OR COALESCE(has_function_privilege('anon', to_regprocedure(functions.signature), 'EXECUTE'), false)
        OR COALESCE(has_function_privilege('authenticated', to_regprocedure(functions.signature), 'EXECUTE'), false)
    );
$$;

REVOKE ALL ON FUNCTION agentx_team_internal.has_verified_email(uuid), agentx_team_internal.resolve_access(uuid,uuid,text[]),
  agentx_team_internal.audit_order_action(uuid,uuid,uuid,text,uuid),
  agentx_team_internal.verified_member(uuid,uuid,text), agentx_team_internal.list_members(uuid,uuid),
  public.agentx_seller_team_access(uuid,uuid), public.agentx_seller_team_list(uuid),
  public.agentx_link_seller_organization(uuid,uuid,text), public.agentx_seller_team_members(uuid,uuid),
  public.agentx_seller_team_set_member(uuid,uuid,text,text,uuid), public.agentx_seller_team_cancel_order(uuid,uuid,uuid),
  public.agentx_seller_team_confirm_payment(uuid,uuid,uuid,text,boolean,text,text,uuid,numeric),
  public.agentx_seller_team_reject_payment(uuid,uuid,uuid,text,uuid),
  public.agentx_seller_team_claim_delivery(uuid,uuid,uuid,timestamptz), public.agentx_seller_team_confirm_delivery(uuid,uuid,uuid),
  public.agentx_seller_team_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION agentx_team_internal.has_verified_email(uuid), agentx_team_internal.resolve_access(uuid,uuid,text[]),
  agentx_team_internal.audit_order_action(uuid,uuid,uuid,text,uuid),
  agentx_team_internal.verified_member(uuid,uuid,text), agentx_team_internal.list_members(uuid,uuid),
  public.agentx_seller_team_access(uuid,uuid), public.agentx_seller_team_list(uuid),
  public.agentx_link_seller_organization(uuid,uuid,text), public.agentx_seller_team_members(uuid,uuid),
  public.agentx_seller_team_set_member(uuid,uuid,text,text,uuid), public.agentx_seller_team_cancel_order(uuid,uuid,uuid),
  public.agentx_seller_team_confirm_payment(uuid,uuid,uuid,text,boolean,text,text,uuid,numeric),
  public.agentx_seller_team_reject_payment(uuid,uuid,uuid,text,uuid),
  public.agentx_seller_team_claim_delivery(uuid,uuid,uuid,timestamptz), public.agentx_seller_team_confirm_delivery(uuid,uuid,uuid),
  public.agentx_seller_team_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

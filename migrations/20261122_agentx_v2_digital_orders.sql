-- Apply after both 20261121 AgentX v2 migrations.
BEGIN;

INSERT INTO storage.buckets(id, name, public)
VALUES ('agentx-v2-digital', 'agentx-v2-digital', false);

-- An inherited permissive policy from another integration must not expose this bucket.
CREATE POLICY agentx_private_digital_objects ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'agentx-v2-digital') WITH CHECK (bucket_id <> 'agentx-v2-digital');
CREATE POLICY agentx_private_digital_bucket ON storage.buckets AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (id <> 'agentx-v2-digital') WITH CHECK (id <> 'agentx-v2-digital');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.organizations, public.organization_members, public.agentx_workflows,
 public.agentx_workflow_runs FROM PUBLIC, anon, authenticated;

ALTER TABLE public.agentx_orders
 ADD COLUMN customer_user_id uuid REFERENCES auth.users(id),
 ADD COLUMN digital_asset_path text,
 ADD COLUMN settlement_method text,
 ADD COLUMN settlement_reference text,
 ADD CONSTRAINT agentx_order_asset_scope CHECK (
   digital_asset_path IS NULL OR (
     customer_user_id IS NOT NULL AND
     split_part(digital_asset_path, '/', 1) = organization_id::text
   )
 );
CREATE UNIQUE INDEX agentx_unique_settlement
 ON public.agentx_orders (organization_id, settlement_method, settlement_reference)
 WHERE settlement_reference IS NOT NULL;

ALTER TABLE public.agentx_payment_proofs
 ADD COLUMN submitted_by uuid REFERENCES auth.users(id),
 ADD COLUMN proof_text text CHECK (length(proof_text) BETWEEN 10 AND 4000),
 ADD COLUMN proof_hash text CHECK (proof_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX agentx_payment_proofs_hash_idx
 ON public.agentx_payment_proofs (organization_id, proof_hash) WHERE proof_hash IS NOT NULL;

CREATE TABLE public.agentx_digital_deliveries (
 organization_id uuid NOT NULL,
 order_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, order_id),
 FOREIGN KEY (order_id, organization_id) REFERENCES public.agentx_orders(id, organization_id)
);
ALTER TABLE public.agentx_digital_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_digital_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agentx_digital_deliveries TO service_role;

CREATE FUNCTION public.agentx_create_organization(p_actor uuid, p_name text, p_slug text)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 INSERT INTO public.organizations(name, slug, owner_user_id)
 VALUES (btrim(p_name), p_slug, p_actor) RETURNING id INTO v_id;
 INSERT INTO public.organization_members(organization_id, user_id, role)
 VALUES (v_id, p_actor, 'owner');
 RETURN v_id;
END;
$$;

-- This lock makes financial and order writes wait for concurrent role/status changes.
CREATE FUNCTION public.agentx_assert_role(p_org uuid, p_actor uuid, p_roles text[])
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.organizations o
 JOIN public.organization_members m ON m.organization_id = o.id
 WHERE o.id = p_org AND o.status = 'active' AND m.user_id = p_actor
 AND m.role = ANY(p_roles) FOR SHARE OF o, m;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization access denied' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE FUNCTION public.agentx_set_member(p_org uuid, p_actor uuid, p_member uuid, p_role text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 PERFORM public.agentx_assert_role(p_org, p_actor, ARRAY['owner']);
 IF p_member = p_actor OR p_role = 'owner' THEN
   RAISE EXCEPTION 'owner role cannot be changed' USING ERRCODE = '42501';
 END IF;
 IF p_role IS NULL THEN
   DELETE FROM public.organization_members
   WHERE organization_id = p_org AND user_id = p_member AND role <> 'owner';
 ELSE
   INSERT INTO public.organization_members(organization_id, user_id, role)
   VALUES (p_org, p_member, p_role)
   ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
   WHERE organization_members.role <> 'owner';
 END IF;
END;
$$;

CREATE FUNCTION public.agentx_create_digital_order(
 p_org uuid, p_actor uuid, p_order uuid, p_customer uuid, p_phone text,
 p_amount numeric, p_currency text, p_asset uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_path text := p_org::text || '/' || p_asset::text;
 v_id uuid;
BEGIN
 PERFORM public.agentx_assert_role(p_org, p_actor, ARRAY['owner','admin','operator']);
 IF NOT EXISTS (SELECT 1 FROM storage.objects
   WHERE bucket_id = 'agentx-v2-digital' AND name = v_path) THEN
   RAISE EXCEPTION 'asset not found' USING ERRCODE = 'P0002';
 END IF;
 INSERT INTO public.agentx_orders(id, organization_id, customer_user_id, customer_phone,
   amount, currency, digital_asset_path)
 VALUES (p_order, p_org, p_customer, p_phone, p_amount, p_currency, v_path)
 ON CONFLICT (id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT id INTO v_id FROM public.agentx_orders
   WHERE id = p_order AND organization_id = p_org AND customer_user_id = p_customer
   AND customer_phone = p_phone AND amount = p_amount AND currency = p_currency
   AND digital_asset_path = v_path;
   IF NOT FOUND THEN RAISE EXCEPTION 'order ID conflict' USING ERRCODE = '23505'; END IF;
 END IF;
 RETURN v_id;
END;
$$;

CREATE FUNCTION public.agentx_submit_proof(
 p_org uuid, p_order uuid, p_actor uuid, p_text text, p_claimed_amount numeric, p_reference text
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_status text;
 v_id uuid;
 v_hash text := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
BEGIN
 SELECT a.status INTO v_status FROM public.agentx_orders a
 JOIN public.organizations o ON o.id = a.organization_id
 WHERE a.organization_id = p_org AND a.id = p_order AND a.customer_user_id = p_actor
 AND o.status = 'active' FOR UPDATE OF a FOR SHARE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;
 SELECT id INTO v_id FROM public.agentx_payment_proofs
 WHERE organization_id = p_org AND order_id = p_order AND proof_hash = v_hash;
 IF FOUND THEN RETURN v_id; END IF;
 IF v_status NOT IN ('awaiting_payment', 'rejected') THEN
   RAISE EXCEPTION 'order cannot accept a new proof';
 END IF;
 INSERT INTO public.agentx_payment_proofs(
   organization_id, order_id, storage_path, submitted_by, proof_text,
   proof_hash, claimed_amount, transaction_reference
 ) VALUES (
   p_org, p_order, 'inline:' || v_hash, p_actor, p_text,
   v_hash, p_claimed_amount, p_reference
 ) RETURNING id INTO v_id;
 UPDATE public.agentx_orders SET status = 'review_pending'
 WHERE organization_id = p_org AND id = p_order;
 RETURN v_id;
END;
$$;

-- Upgrade the existing RPC signature safely. Old approvals cannot bypass settlement checks.
DROP FUNCTION public.agentx_review_payment(uuid,uuid,uuid,text,text);
CREATE FUNCTION public.agentx_review_payment(
 p_organization_id uuid, p_proof_id uuid, p_actor_id uuid, p_decision text,
 p_note text, p_settlement_method text, p_settlement_reference text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_order public.agentx_orders%ROWTYPE;
 v_proof public.agentx_payment_proofs%ROWTYPE;
 v_status text;
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR
    length(coalesce(p_note, '')) > 1000 OR
    (p_decision = 'reject' AND btrim(coalesce(p_note, '')) = '') THEN
   RAISE EXCEPTION 'invalid review' USING ERRCODE = '22023';
 END IF;
 IF p_decision = 'approve' AND (
   p_settlement_method IS NULL OR p_settlement_method NOT IN ('mpesa','emola','bank_transfer','other') OR
   p_settlement_reference IS NULL OR p_settlement_reference !~ '^[A-Z0-9-]{4,100}$'
 ) THEN RAISE EXCEPTION 'verified settlement reference required' USING ERRCODE = '22023'; END IF;
 PERFORM public.agentx_assert_role(p_organization_id, p_actor_id, ARRAY['owner','finance_admin']);
 SELECT a.* INTO v_order FROM public.agentx_orders a
 JOIN public.agentx_payment_proofs p ON p.order_id = a.id AND p.organization_id = a.organization_id
 WHERE p.id = p_proof_id AND a.organization_id = p_organization_id FOR UPDATE OF a;
 IF NOT FOUND THEN RAISE EXCEPTION 'proof not found' USING ERRCODE = 'P0002'; END IF;
 SELECT * INTO STRICT v_proof FROM public.agentx_payment_proofs
 WHERE id = p_proof_id AND organization_id = p_organization_id FOR UPDATE;
 v_status := CASE WHEN p_decision = 'approve' THEN 'paid' ELSE 'rejected' END;
 IF v_proof.status = (CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END)
    AND v_proof.reviewed_by = p_actor_id AND v_proof.review_note IS NOT DISTINCT FROM p_note
    AND (p_decision = 'reject' OR (v_order.settlement_method = p_settlement_method
      AND v_order.settlement_reference = p_settlement_reference)) THEN
   RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status);
 END IF;
 IF v_proof.status <> 'pending' OR v_order.status <> 'review_pending' THEN
   RAISE EXCEPTION 'proof already reviewed or order not awaiting review';
 END IF;
 IF p_decision = 'approve' AND v_proof.claimed_amount IS NOT NULL
   AND v_proof.claimed_amount <> v_order.amount THEN
   RAISE EXCEPTION 'amount mismatch';
 END IF;
 UPDATE public.agentx_payment_proofs
 SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
     reviewed_by = p_actor_id, reviewed_at = now(), review_note = p_note
 WHERE id = p_proof_id AND organization_id = p_organization_id;
 IF p_decision = 'approve' THEN
   UPDATE public.agentx_orders SET status = 'paid', approved_by = p_actor_id, approved_at = now(),
     settlement_method = p_settlement_method, settlement_reference = p_settlement_reference
   WHERE id = v_order.id AND organization_id = p_organization_id;
   INSERT INTO public.agentx_outbox(organization_id,event_type,aggregate_id,idempotency_key,payload)
   VALUES (p_organization_id,'order.paid',v_order.id,'order-paid:' || v_order.id,
           jsonb_build_object('order_id', v_order.id))
   ON CONFLICT (organization_id,idempotency_key) DO NOTHING;
 ELSE
   UPDATE public.agentx_orders SET status = 'rejected'
   WHERE id = v_order.id AND organization_id = p_organization_id;
 END IF;
 RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status);
END;
$$;

CREATE FUNCTION public.agentx_pending_proofs(p_org uuid, p_actor uuid)
RETURNS TABLE (
 id uuid, order_id uuid, claimed_amount numeric, transaction_reference text,
 created_at timestamptz, status text, proof_text text, amount numeric, currency text, repeated_proof boolean
) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 PERFORM public.agentx_assert_role(p_org, p_actor, ARRAY['owner','finance_admin']);
 RETURN QUERY SELECT p.id, p.order_id, p.claimed_amount, p.transaction_reference,
   p.created_at, p.status, p.proof_text, a.amount, a.currency, EXISTS (
     SELECT 1 FROM public.agentx_payment_proofs previous
     WHERE previous.organization_id = p_org AND previous.proof_hash = p.proof_hash AND previous.id <> p.id
   )
 FROM public.agentx_payment_proofs p JOIN public.agentx_orders a
 ON a.id = p.order_id AND a.organization_id = p.organization_id
 WHERE p.organization_id = p_org AND p.status = 'pending'
 ORDER BY p.created_at, p.id LIMIT 50;
END;
$$;

CREATE FUNCTION public.agentx_get_digital_asset(p_org uuid, p_order uuid, p_actor uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT a.digital_asset_path
 FROM public.agentx_digital_deliveries d
 JOIN public.agentx_orders a ON a.id = d.order_id AND a.organization_id = d.organization_id
 JOIN public.organizations o ON o.id = d.organization_id
 WHERE d.organization_id = p_org AND d.order_id = p_order
 AND a.customer_user_id = p_actor AND a.status = 'paid' AND o.status = 'active';
$$;

-- The worker grants access and consumes the outbox atomically. A crash before commit
-- leaves the event pending and releases the lock for another worker.
CREATE FUNCTION public.agentx_process_digital_deliveries()
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
 WITH work AS (
   SELECT e.id, e.organization_id, e.aggregate_id FROM public.agentx_outbox e
   JOIN public.agentx_orders a ON a.id = e.aggregate_id AND a.organization_id = e.organization_id
   JOIN public.organizations o ON o.id = e.organization_id
   JOIN storage.objects s ON s.bucket_id = 'agentx-v2-digital' AND s.name = a.digital_asset_path
   WHERE e.event_type = 'order.paid' AND e.status = 'pending'
   AND a.status = 'paid' AND o.status = 'active'
   ORDER BY e.created_at, e.id LIMIT 50 FOR UPDATE OF e SKIP LOCKED
 ), delivered AS (
   INSERT INTO public.agentx_digital_deliveries (organization_id, order_id)
   SELECT organization_id, aggregate_id FROM work
   ON CONFLICT (organization_id, order_id) DO NOTHING
 ), completed AS (
   UPDATE public.agentx_outbox e SET status = 'completed' FROM work WHERE e.id = work.id
   RETURNING e.id
 )
 SELECT count(*) INTO v_count FROM completed;
 RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION
 public.agentx_create_organization(uuid,text,text), public.agentx_assert_role(uuid,uuid,text[]),
 public.agentx_set_member(uuid,uuid,uuid,text),
 public.agentx_create_digital_order(uuid,uuid,uuid,uuid,text,numeric,text,uuid),
 public.agentx_submit_proof(uuid,uuid,uuid,text,numeric,text),
 public.agentx_review_payment(uuid,uuid,uuid,text,text,text,text),
 public.agentx_pending_proofs(uuid,uuid), public.agentx_get_digital_asset(uuid,uuid,uuid),
 public.agentx_process_digital_deliveries()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
 public.agentx_create_organization(uuid,text,text), public.agentx_assert_role(uuid,uuid,text[]),
 public.agentx_set_member(uuid,uuid,uuid,text),
 public.agentx_create_digital_order(uuid,uuid,uuid,uuid,text,numeric,text,uuid),
 public.agentx_submit_proof(uuid,uuid,uuid,text,numeric,text),
 public.agentx_review_payment(uuid,uuid,uuid,text,text,text,text),
 public.agentx_pending_proofs(uuid,uuid), public.agentx_get_digital_asset(uuid,uuid,uuid),
 public.agentx_process_digital_deliveries()
TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

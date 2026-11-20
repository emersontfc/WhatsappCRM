-- Apply after 20261122_agentx_v2_digital_orders.sql.
BEGIN;

CREATE TABLE public.agentx_proof_attachments (
 organization_id uuid NOT NULL,
 proof_id uuid NOT NULL,
 extension text NOT NULL CHECK (extension IN ('jpg','png','pdf')),
 content bytea NOT NULL CHECK (octet_length(content) BETWEEN 4 AND 5242880),
 PRIMARY KEY (organization_id, proof_id),
 FOREIGN KEY (proof_id, organization_id) REFERENCES public.agentx_payment_proofs(id, organization_id)
);
ALTER TABLE public.agentx_proof_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_proof_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agentx_proof_attachments TO service_role;

CREATE FUNCTION public.agentx_submit_proof_attachment(
 p_org uuid, p_order uuid, p_actor uuid, p_extension text, p_content text
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_status text;
 v_id uuid;
 v_bytes bytea;
 v_hash text;
BEGIN
 SELECT a.status INTO v_status FROM public.agentx_orders a
 JOIN public.organizations o ON o.id = a.organization_id
 WHERE a.organization_id = p_org AND a.id = p_order AND a.customer_user_id = p_actor
 AND o.status = 'active' FOR UPDATE OF a FOR SHARE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;
 IF p_content IS NULL OR length(p_content) > 6990508 OR p_extension IS NULL
    OR p_extension NOT IN ('jpg','png','pdf') THEN
   RAISE EXCEPTION 'invalid attachment' USING ERRCODE = '22023';
 END IF;
 v_bytes := decode(p_content, 'base64');
 IF octet_length(v_bytes) NOT BETWEEN 4 AND 5242880 OR NOT (
   (p_extension = 'jpg' AND substring(v_bytes FROM 1 FOR 3) = decode('ffd8ff','hex')) OR
   (p_extension = 'png' AND substring(v_bytes FROM 1 FOR 8) = decode('89504e470d0a1a0a','hex')) OR
   (p_extension = 'pdf' AND substring(v_bytes FROM 1 FOR 5) = decode('255044462d','hex'))
 ) THEN RAISE EXCEPTION 'invalid attachment' USING ERRCODE = '22023'; END IF;
 v_hash := encode(sha256(v_bytes), 'hex');
 SELECT id INTO v_id FROM public.agentx_payment_proofs
 WHERE organization_id = p_org AND order_id = p_order AND proof_hash = v_hash
 AND storage_path = 'attachment:' || v_hash;
 IF FOUND THEN RETURN v_id; END IF;
 IF v_status NOT IN ('awaiting_payment', 'rejected') THEN
   RAISE EXCEPTION 'order cannot accept a new proof';
 END IF;
 INSERT INTO public.agentx_payment_proofs(organization_id, order_id, storage_path, submitted_by, proof_hash)
 VALUES (p_org, p_order, 'attachment:' || v_hash, p_actor, v_hash) RETURNING id INTO v_id;
 INSERT INTO public.agentx_proof_attachments(organization_id, proof_id, extension, content)
 VALUES (p_org, v_id, p_extension, v_bytes);
 UPDATE public.agentx_orders SET status = 'review_pending'
 WHERE organization_id = p_org AND id = p_order;
 RETURN v_id;
END;
$$;

CREATE FUNCTION public.agentx_get_proof_attachment(p_org uuid, p_proof uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_attachment jsonb;
BEGIN
 PERFORM public.agentx_assert_role(p_org, p_actor, ARRAY['owner','finance_admin']);
 SELECT jsonb_build_object('extension', extension, 'content', encode(content, 'base64'))
 INTO v_attachment FROM public.agentx_proof_attachments WHERE organization_id = p_org AND proof_id = p_proof;
 IF NOT FOUND THEN RAISE EXCEPTION 'attachment not found' USING ERRCODE = 'P0002'; END IF;
 RETURN v_attachment;
END;
$$;

DROP FUNCTION public.agentx_pending_proofs(uuid,uuid);
CREATE FUNCTION public.agentx_pending_proofs(p_org uuid, p_actor uuid)
RETURNS TABLE (
 id uuid, order_id uuid, claimed_amount numeric, transaction_reference text,
 created_at timestamptz, status text, proof_text text, amount numeric, currency text,
 repeated_proof boolean, has_attachment boolean
) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 PERFORM public.agentx_assert_role(p_org, p_actor, ARRAY['owner','finance_admin']);
 RETURN QUERY SELECT p.id, p.order_id, p.claimed_amount, p.transaction_reference,
   p.created_at, p.status, p.proof_text, a.amount, a.currency, EXISTS (
     SELECT 1 FROM public.agentx_payment_proofs previous
     WHERE previous.organization_id = p_org AND previous.proof_hash = p.proof_hash AND previous.id <> p.id
   ), EXISTS (
     SELECT 1 FROM public.agentx_proof_attachments attachment
     WHERE attachment.organization_id = p_org AND attachment.proof_id = p.id
   )
 FROM public.agentx_payment_proofs p JOIN public.agentx_orders a
 ON a.id = p.order_id AND a.organization_id = p.organization_id
 WHERE p.organization_id = p_org AND p.status = 'pending'
 ORDER BY p.created_at, p.id LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_submit_proof_attachment(uuid,uuid,uuid,text,text),
 public.agentx_get_proof_attachment(uuid,uuid,uuid), public.agentx_pending_proofs(uuid,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_submit_proof_attachment(uuid,uuid,uuid,text,text),
 public.agentx_get_proof_attachment(uuid,uuid,uuid), public.agentx_pending_proofs(uuid,uuid)
TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

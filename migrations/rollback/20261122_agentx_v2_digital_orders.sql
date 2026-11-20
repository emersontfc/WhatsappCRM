-- Stop v2 API traffic and the worker before running. The rollback preserves business records.
BEGIN;
LOCK TABLE public.agentx_orders, public.agentx_payment_proofs, public.agentx_digital_deliveries
 IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.agentx_orders WHERE customer_user_id IS NOT NULL OR settlement_reference IS NOT NULL)
 OR EXISTS (SELECT 1 FROM public.agentx_payment_proofs WHERE proof_hash IS NOT NULL)
 OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'agentx-v2-digital')
 OR EXISTS (SELECT 1 FROM public.agentx_digital_deliveries) THEN
   RAISE EXCEPTION 'refusing to drop digital commerce data';
 END IF;
END;
$$;

DROP FUNCTION public.agentx_get_digital_asset(uuid,uuid,uuid);
DROP FUNCTION public.agentx_pending_proofs(uuid,uuid);
DROP FUNCTION public.agentx_process_digital_deliveries();
DROP FUNCTION public.agentx_submit_proof(uuid,uuid,uuid,text,numeric,text);
DROP FUNCTION public.agentx_create_digital_order(uuid,uuid,uuid,uuid,text,numeric,text,uuid);
DROP FUNCTION public.agentx_review_payment(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION public.agentx_set_member(uuid,uuid,uuid,text);
DROP FUNCTION public.agentx_assert_role(uuid,uuid,text[]);
DROP FUNCTION public.agentx_create_organization(uuid,text,text);
DROP TABLE public.agentx_digital_deliveries;
ALTER TABLE public.agentx_payment_proofs DROP COLUMN submitted_by, DROP COLUMN proof_text, DROP COLUMN proof_hash;
ALTER TABLE public.agentx_orders DROP CONSTRAINT agentx_order_asset_scope,
 DROP COLUMN customer_user_id, DROP COLUMN digital_asset_path,
 DROP COLUMN settlement_method, DROP COLUMN settlement_reference;
DROP POLICY agentx_private_digital_objects ON storage.objects;
DROP POLICY agentx_private_digital_bucket ON storage.buckets;
DELETE FROM storage.buckets WHERE id = 'agentx-v2-digital';

CREATE OR REPLACE FUNCTION public.agentx_review_payment(
 p_organization_id uuid, p_proof_id uuid, p_actor_id uuid,
 p_decision text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $$
DECLARE v_proof public.agentx_payment_proofs%ROWTYPE;
DECLARE v_order public.agentx_orders%ROWTYPE;
BEGIN
 IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid decision'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.organization_members
   WHERE organization_id=p_organization_id AND user_id=p_actor_id AND role IN ('owner','finance_admin')
 ) THEN RAISE EXCEPTION 'unauthorized reviewer'; END IF;
 SELECT * INTO v_proof FROM public.agentx_payment_proofs
 WHERE id=p_proof_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'proof not found'; END IF;
 SELECT * INTO v_order FROM public.agentx_orders
 WHERE id=v_proof.order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
 IF v_proof.status <> 'pending' OR v_order.status <> 'review_pending' THEN
   RAISE EXCEPTION 'proof already reviewed or order not awaiting review';
 END IF;
 IF p_decision='approve' THEN
   IF v_proof.claimed_amount IS NOT NULL AND v_proof.claimed_amount <> v_order.amount THEN
     RAISE EXCEPTION 'amount mismatch: independent verification required';
   END IF;
   UPDATE public.agentx_payment_proofs SET status='approved',reviewed_by=p_actor_id,reviewed_at=now(),review_note=p_note WHERE id=p_proof_id;
   UPDATE public.agentx_orders SET status='paid',approved_by=p_actor_id,approved_at=now() WHERE id=v_order.id;
   INSERT INTO public.agentx_outbox(organization_id,event_type,aggregate_id,idempotency_key,payload)
   VALUES(p_organization_id,'order.paid',v_order.id,'order-paid:'||v_order.id,jsonb_build_object('order_id',v_order.id))
   ON CONFLICT(organization_id,idempotency_key) DO NOTHING;
 ELSE
   UPDATE public.agentx_payment_proofs SET status='rejected',reviewed_by=p_actor_id,reviewed_at=now(),review_note=p_note WHERE id=p_proof_id;
   UPDATE public.agentx_orders SET status='rejected' WHERE id=v_order.id;
 END IF;
 RETURN jsonb_build_object('order_id',v_order.id,'status',CASE WHEN p_decision='approve' THEN 'paid' ELSE 'rejected' END);
END; $$;
REVOKE ALL ON FUNCTION public.agentx_review_payment(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_review_payment(uuid,uuid,uuid,text,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

-- AgentX v2 manual payment review (isolated from legacy commerce).
-- APPLY AFTER 20261121_agentx_v2_foundation.sql; backup first.
BEGIN;
CREATE TABLE IF NOT EXISTS public.agentx_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 customer_phone text NOT NULL CHECK (length(customer_phone) BETWEEN 8 AND 20),
 amount numeric(14,2) NOT NULL CHECK (amount > 0),
 currency text NOT NULL DEFAULT 'MZN' CHECK (currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','review_pending','paid','rejected','fulfilled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES auth.users(id),
 approved_at timestamptz,
 UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS public.agentx_payment_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 order_id uuid NOT NULL,
 storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 500),
 transaction_reference text,
 claimed_amount numeric(14,2),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(order_id,organization_id) REFERENCES public.agentx_orders(id,organization_id),
 UNIQUE(id,organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agentx_one_pending_proof_per_order ON public.agentx_payment_proofs(order_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS public.agentx_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 event_type text NOT NULL,
 aggregate_id uuid NOT NULL,
 idempotency_key text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS agentx_outbox_pending_idx ON public.agentx_outbox(status,created_at);
ALTER TABLE public.agentx_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentx_payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentx_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_orders,public.agentx_payment_proofs,public.agentx_outbox FROM anon,authenticated;
-- No direct browser access to private proofs, orders, or internal event queue.
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
NOTIFY pgrst,'reload schema';

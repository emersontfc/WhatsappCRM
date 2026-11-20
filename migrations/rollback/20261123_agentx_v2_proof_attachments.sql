-- Stop v2 API traffic before running.
BEGIN;
LOCK TABLE public.agentx_proof_attachments IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.agentx_proof_attachments) THEN
   RAISE EXCEPTION 'refusing to drop payment proof attachments';
 END IF;
END;
$$;
DROP FUNCTION public.agentx_submit_proof_attachment(uuid,uuid,uuid,text,text);
DROP FUNCTION public.agentx_get_proof_attachment(uuid,uuid,uuid);
DROP FUNCTION public.agentx_pending_proofs(uuid,uuid);
DROP TABLE public.agentx_proof_attachments;

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

REVOKE ALL ON FUNCTION public.agentx_pending_proofs(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_pending_proofs(uuid,uuid) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated;
REVOKE INSERT (role), UPDATE (role) ON public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;
DROP POLICY IF EXISTS agentx_profile_read ON public.users;
CREATE POLICY agentx_profile_read ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS agentx_profile_read_own ON public.users;
CREATE POLICY agentx_profile_read_own ON public.users AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agents FROM PUBLIC, anon, authenticated;
REVOKE SELECT (api_key) ON public.agents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO service_role;

DO $$
BEGIN
  IF to_regclass('public.whatsapp_sessions') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.whatsapp_sessions FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_sessions TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_seller_confirm_delivery(p_user uuid, p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_order public.orders%ROWTYPE;
  confirmed_at timestamptz := now();
BEGIN
  SELECT * INTO current_order FROM public.orders WHERE id = p_order AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF current_order.status = 'fulfilled' THEN
    RETURN jsonb_build_object('id', p_order, 'status', 'fulfilled');
  END IF;
  IF current_order.status IS DISTINCT FROM 'paid' OR current_order.delivery_started_at IS NULL THEN
    RAISE EXCEPTION 'Pedido fora da revisão de entrega' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET status = 'fulfilled', fulfilled_at = confirmed_at, updated_at = confirmed_at,
    delivery_error = NULL WHERE id = p_order AND user_id = p_user;
  INSERT INTO public.agent_operations(user_id, order_id, phone, step, description, metadata)
  VALUES (p_user, p_order, current_order.customer_phone, 'fulfilled', 'Receção da entrega confirmada pelo operador.',
    jsonb_build_object('source', 'operator_review', 'confirmedAt', confirmed_at, 'actorId', p_user));
  RETURN jsonb_build_object('id', p_order, 'status', 'fulfilled');
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_seller_confirm_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_seller_confirm_delivery(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_seller_delivery_recovery_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(has_function_privilege('service_role', to_regprocedure('public.agentx_seller_confirm_delivery(uuid,uuid)'), 'EXECUTE'), false)
    AND NOT has_function_privilege('authenticated', 'public.agentx_seller_confirm_delivery(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.agentx_seller_confirm_delivery(uuid,uuid)', 'EXECUTE')
    AND NOT has_column_privilege('authenticated', 'public.agents', 'api_key', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.agents', 'api_key', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE');
$$;
REVOKE ALL ON FUNCTION public.agentx_seller_delivery_recovery_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_seller_delivery_recovery_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

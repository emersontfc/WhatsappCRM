-- Verify both production failures against a legacy schema before applying the repair.
DO $$
DECLARE
  owner_id constant uuid := '00000000-0000-4000-8000-000000000001';
  product_id uuid;
BEGIN
  BEGIN
    PERFORM public.agentx_capture_sales_lead(owner_id, '258840000002', NULL, 'Cliente', 'interest', 'Qualificar');
    RAISE EXCEPTION 'Expected legacy qualification to fail before migration 21';
  EXCEPTION WHEN undefined_column THEN
    IF position('last_action' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  INSERT INTO public.products (user_id, name, price, stock, type)
  VALUES (owner_id, 'Produto para reprodução', 100, 2, 'physical') RETURNING id INTO product_id;
  BEGIN
    PERFORM public.agentx_seller_create_order(owner_id, product_id, 1, '258840000099',
      'Cliente', NULL, 'mpesa', 'AGX-LEGACY', 'missing-last-action');
    RAISE EXCEPTION 'Expected legacy order creation to fail before migration 21';
  EXCEPTION WHEN undefined_column THEN
    IF position('last_action' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.orders WHERE order_number = 'AGX-LEGACY') THEN
    RAISE EXCEPTION 'Failed order creation left an order behind';
  END IF;
  DELETE FROM public.products WHERE id = product_id;
  RAISE NOTICE 'Reproduced missing leads.last_action for lead qualification and order creation (SQLSTATE 42703)';
END;
$$;

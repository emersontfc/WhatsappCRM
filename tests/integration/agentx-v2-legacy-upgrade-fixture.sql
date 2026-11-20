INSERT INTO public.agents(id, enabled_tools, financial_limit)
VALUES ('00000000-0000-4000-8000-000000000001', ARRAY['sales'], 100);
INSERT INTO public.products(user_id, name, price)
VALUES ('00000000-0000-4000-8000-000000000001', 'Produto existente', 25);
INSERT INTO public.orders(id, user_id, order_number, customer_phone, total_amount, status)
VALUES ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000001',
 'LEGACY-001', '841234567', 25, 'fulfilled');
INSERT INTO public.payment_verifications(order_id, user_id, customer_phone, amount, status)
VALUES ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000001',
 '841234567', 25, 'approved');
CREATE TEMPORARY TABLE agentx_legacy_before AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(o) FROM public.orders o),
 (SELECT jsonb_agg(p) FROM public.products p),
 (SELECT jsonb_agg(v) FROM public.payment_verifications v),
 (SELECT jsonb_agg(a) FROM public.agents a)
) AS snapshot;

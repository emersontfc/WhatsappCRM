BEGIN;

DO $$
BEGIN
  ASSERT (SELECT count(*) = 1 FROM agentx_internal.installation WHERE version = '0000+00-26+20261123');
  ASSERT to_regprocedure('public.exec_sql(text)') IS NULL;
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class AS relation
    WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity);
  ASSERT (SELECT count(*) = 3 FROM storage.buckets
    WHERE id IN ('agentx-product-files', 'agentx-v2-digital', 'agentx-group-proofs') AND NOT public);
  ASSERT (SELECT count(*) = 2 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('contacts', 'messages'));
  ASSERT NOT has_table_privilege('anon', 'public.contacts', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.whatsapp_sessions', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.agents', 'SELECT');
  ASSERT NOT has_column_privilege('authenticated', 'public.agents', 'api_key', 'SELECT');
  ASSERT NOT has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.license_keys', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.subscriptions', 'INSERT,UPDATE,DELETE');
  ASSERT has_function_privilege('service_role', 'public.agentx_seller_confirm_delivery(uuid,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.agentx_seller_confirm_delivery(uuid,uuid)', 'EXECUTE');
END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('91000000-0000-4000-8000-000000000001', 'um@example.invalid'),
  ('91000000-0000-4000-8000-000000000002', 'dois@example.invalid');

SET LOCAL ROLE service_role;
INSERT INTO public.users (id, email) VALUES
  ('91000000-0000-4000-8000-000000000001', 'um@example.invalid'),
  ('91000000-0000-4000-8000-000000000002', 'dois@example.invalid');
INSERT INTO public.subscriptions (user_id, plan) VALUES
  ('91000000-0000-4000-8000-000000000001', 'Free'), ('91000000-0000-4000-8000-000000000002', 'Free');
INSERT INTO public.contacts (id, user_id, phone, name) VALUES
  ('91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', '841234567', 'Contacto um'),
  ('91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000002', '841234567', 'Contacto dois');
INSERT INTO public.messages (user_id, contact_id, type, text) VALUES
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'inbound', 'Mensagem um'),
  ('91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000012', 'inbound', 'Mensagem dois');
INSERT INTO public.logs (user_id, message, type, metadata) VALUES
  ('91000000-0000-4000-8000-000000000001', 'Ligação', 'info', '{}');
INSERT INTO public.license_keys (code, plan, duration_days)
VALUES ('fixture-local-license', 'Pro', 30);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('media', '91000000-0000-4000-8000-000000000002/other.png'),
  ('agentx-group-proofs', '91000000-0000-4000-8000-000000000001/receipt');
DO $$
BEGIN
  ASSERT public.agentx_seller_payments_ready();
  ASSERT public.agentx_schedule_dispatch_ready();
  ASSERT public.agentx_appointment_contract_ready();
  ASSERT public.agentx_group_proof_contract_ready();
  ASSERT public.agentx_process_digital_deliveries() = 0;
  ASSERT public.agentx_create_organization('91000000-0000-4000-8000-000000000001', 'Empresa teste', 'empresa-teste') IS NOT NULL;
  ASSERT (SELECT count(*) = 1 FROM public.organization_members);
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$
BEGIN
  ASSERT (SELECT array_agg(role) = ARRAY['user'] FROM public.users);
  ASSERT (SELECT count(*) = 1 FROM public.subscriptions);
  ASSERT (SELECT array_agg(name) = ARRAY['Contacto um'] FROM public.contacts);
  ASSERT (SELECT array_agg(text) = ARRAY['Mensagem um'] FROM public.messages);
  ASSERT (SELECT array_agg(message) = ARRAY['Ligação'] FROM public.logs);
  ASSERT (SELECT count(*) = 0 FROM storage.objects);

  INSERT INTO storage.objects (bucket_id, name) VALUES ('media', '91000000-0000-4000-8000-000000000001/own.png');
  ASSERT (SELECT count(*) = 1 FROM storage.objects);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('media', '91000000-0000-4000-8000-000000000002/forbidden.png');
    RAISE EXCEPTION 'authenticated user could upload to another account';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
BEGIN
  ASSERT (SELECT array_agg(name ORDER BY name) = ARRAY['Free', 'Premium', 'Pro', 'Starter'] FROM public.plans);
  ASSERT (SELECT count(*) = 0 FROM storage.objects);
END;
$$;
ROLLBACK;

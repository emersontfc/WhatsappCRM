-- Scenario data only. The installer must create every AgentX table and policy.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'loja-a@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000002', 'loja-b@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000003', 'vendas@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000004', 'financeiro@example.invalid', now());
INSERT INTO public.users (id, email, name, role, plan) VALUES
  ('00000000-0000-4000-8000-000000000001', 'loja-a@example.invalid', 'Loja A', 'user', 'Pro'),
  ('00000000-0000-4000-8000-000000000002', 'loja-b@example.invalid', 'Loja B', 'user', 'Pro'),
  ('00000000-0000-4000-8000-000000000003', 'vendas@example.invalid', 'Vendas', 'user', 'Pro'),
  ('00000000-0000-4000-8000-000000000004', 'financeiro@example.invalid', 'Financeiro', 'user', 'Pro');
INSERT INTO public.subscriptions (user_id, plan, plan_id, status, end_date)
  SELECT u.id, p.name, p.id, 'active', now() + interval '30 days'
  FROM public.users u JOIN public.plans p ON p.name = u.plan;

INSERT INTO public.contacts (id, user_id, name, phone, lid) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Contacto com LID', NULL, '45678123456'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Contacto existente', '258849998888', NULL),
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', 'Primeiro contacto', '258857777777', NULL),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000002', 'Cliente da outra loja', '258870000001', NULL);

INSERT INTO public.leads (id, user_id, phone, name, stage, status, notes) VALUES
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000002',
    '258840000002', 'Cliente da outra loja', 'novo', 'new', 'Nota privada da loja B');
INSERT INTO public.messages (user_id, contact_id, type, text, msg_id) VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000022',
    'inbound', 'Mensagem privada da outra loja', 'other-store-message');

INSERT INTO public.agentx_seller_settings (user_id, payment_method, payment_recipient, recipient_name) VALUES
  ('00000000-0000-4000-8000-000000000002', 'emola', '258870000005', 'Loja anterior');

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL, file_size_limit bigint);
CREATE TABLE storage.objects (bucket_id text, name text);
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

CREATE TABLE public.users (id uuid PRIMARY KEY, email text, role text, plan text, phone text, admin_phones text);
CREATE TABLE public.plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.subscriptions (user_id uuid PRIMARY KEY, messages_used integer DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
  name text, phone text, lid text, tags text[], notes text, unread_count integer DEFAULT 0,
  last_message_at timestamptz, last_message_text text, ai_paused boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE, type text, text text, msg_id text,
  timestamp timestamptz, media_url text, media_type text, media_mimetype text, media_filename text, is_read boolean,
  is_automated boolean DEFAULT false
);
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
  provider text, api_url text, model text, is_active boolean, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
  phone text NOT NULL, contact_id uuid REFERENCES public.contacts(id), name text, stage text, status text,
  last_message text, last_action text, source text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), UNIQUE (user_id, phone)
);
CREATE UNIQUE INDEX fixture_unique_message ON public.messages(user_id, msg_id) WHERE msg_id IS NOT NULL AND msg_id != '';
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_profile ON public.users FOR SELECT TO authenticated
  USING (id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid);
CREATE POLICY fixture_own_contacts ON public.contacts FOR SELECT TO authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.users, public.contacts TO authenticated;

INSERT INTO public.users (id, email, role, plan) VALUES
  ('00000000-0000-4000-8000-000000000001', 'loja-a@example.invalid', 'admin', 'Admin'),
  ('00000000-0000-4000-8000-000000000002', 'loja-b@example.invalid', 'admin', 'Admin');
INSERT INTO auth.users SELECT id FROM public.users;
INSERT INTO public.subscriptions (user_id) SELECT id FROM public.users;
INSERT INTO public.contacts (id, user_id, name, phone, lid, tags) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Contacto com LID', NULL, '45678123456', '{}'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000002', 'Cliente da outra loja', '258870000001', NULL, '{}');
INSERT INTO public.contacts (id, user_id, name, phone, tags, created_at) VALUES
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Contacto legado', '+258 84 999 8888', '{}', '2026-01-01'),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', 'Variante legada', '849998888', '{}', '2026-02-01'),
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', 'Primeiro contacto', '258857777777', '{}', '2026-01-01'),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', 'Contacto duplicado antigo', '258857777777', '{}', '2026-02-01');
INSERT INTO public.messages (user_id, contact_id, type, text, msg_id, timestamp)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000022',
        'inbound', 'Mensagem privada da outra loja', 'other-store-message', now()),
       ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014',
        'inbound', 'Histórico de um contacto anterior à migração', 'legacy-contact-message', '2026-02-02'),
       ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000016',
        'inbound', 'Histórico do duplicado anterior à migração', 'legacy-duplicate-message', '2026-02-03');

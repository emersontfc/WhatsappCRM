-- A legacy appointments installation, without any booking or delivery columns.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id), name text, email text, role text, phone text
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
  name text, phone text, lid text, tags text[], created_at timestamptz DEFAULT now()
);
CREATE TABLE public.company_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id), name text, timezone text
);
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
  name text NOT NULL, description text, duration_minutes integer DEFAULT 30,
  price numeric DEFAULT 0, active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
  name text NOT NULL, role text, email text, phone text, working_days text[],
  start_time text DEFAULT '08:00', end_time text DEFAULT '17:00',
  break_start text DEFAULT '12:00', break_end text DEFAULT '13:00',
  active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  customer_name text NOT NULL, customer_phone text, appointment_date date NOT NULL,
  start_time text NOT NULL, end_time text NOT NULL, status text DEFAULT 'scheduled', notes text,
  reminder_24h_sent boolean DEFAULT false, reminder_2h_sent boolean DEFAULT false, created_at timestamptz DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_own_services ON public.services FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY fixture_own_professionals ON public.professionals FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY fixture_own_appointments ON public.appointments FOR ALL TO authenticated USING (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services, public.professionals, public.appointments TO authenticated;

INSERT INTO auth.users VALUES ('90000000-0000-4000-8000-000000000001'), ('90000000-0000-4000-8000-000000000002');
INSERT INTO public.users (id, name, email, role) VALUES
  ('90000000-0000-4000-8000-000000000001', 'Loja Maputo', 'maputo@example.invalid', 'user'),
  ('90000000-0000-4000-8000-000000000002', 'Loja Lisboa', 'lisboa@example.invalid', 'user');
INSERT INTO public.company_profile VALUES
  ('90000000-0000-4000-8000-000000000001', 'Loja Maputo', 'Africa/Maputo'),
  ('90000000-0000-4000-8000-000000000002', 'Loja Lisboa', 'Europe/Lisbon');

INSERT INTO public.contacts (id, user_id, name, phone, tags) VALUES
  ('90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000001', 'Cliente anterior', '258849998888', '{}'),
  ('90000000-0000-4000-8000-000000000012', '90000000-0000-4000-8000-000000000002', 'Cliente de Lisboa', '+351 912345678', '{}');

INSERT INTO public.services (id, user_id, name, duration_minutes, active) VALUES
  ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000001', 'Consulta', 30, true),
  ('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000001', 'Serviço desativado', 30, false),
  ('90000000-0000-4000-8000-000000000023', '90000000-0000-4000-8000-000000000002', 'Serviço de Lisboa', 30, true);
INSERT INTO public.professionals (id, user_id, name, working_days, start_time, end_time) VALUES
  ('90000000-0000-4000-8000-000000000031', '90000000-0000-4000-8000-000000000001', 'Ana', ARRAY['mon','tue','wed','thu','fri'], '09:00', '17:00'),
  ('90000000-0000-4000-8000-000000000032', '90000000-0000-4000-8000-000000000001', 'Célia', ARRAY['mon','tue','wed','thu','fri'], '09:00', '17:00'),
  ('90000000-0000-4000-8000-000000000033', '90000000-0000-4000-8000-000000000002', 'Rita', ARRAY['mon','tue','wed','thu','fri'], '09:00', '17:00');
INSERT INTO public.appointments (
  id, user_id, contact_id, service_id, professional_id, customer_name, customer_phone, appointment_date,
  start_time, end_time, status, notes, reminder_24h_sent, reminder_2h_sent
) VALUES (
  '90000000-0000-4000-8000-000000000041', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000031', 'Cliente anterior', '258849998888',
  '2025-03-04', '09:00:00', '09:30:00', 'completed', 'Nota que existia antes da migração.', true, true
);

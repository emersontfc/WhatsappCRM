-- 0000: base tables required by the historical AgentX upgrade migrations.
-- Apply only through install_agentx_fresh.sql on a fresh Supabase project.

CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price NUMERIC NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  max_connections INTEGER NOT NULL DEFAULT 1,
  max_contacts INTEGER NOT NULL DEFAULT 300,
  max_messages_per_day INTEGER NOT NULL DEFAULT 150,
  ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  automation_level TEXT NOT NULL DEFAULT 'basic',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user',
  plan TEXT DEFAULT 'Free',
  expires_at TIMESTAMPTZ,
  template_applied boolean NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  plan_id UUID REFERENCES public.plans(id),
  status TEXT DEFAULT 'active',
  messages_used INTEGER DEFAULT 0,
  start_date TIMESTAMPTZ DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  tags text[] DEFAULT '{}',
  last_message_at timestamptz,
  last_message_text text,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, phone)
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  msg_id TEXT,
  media_url TEXT,
  media_type TEXT,
  media_mimetype TEXT,
  media_filename TEXT,
  is_automated BOOLEAN DEFAULT FALSE,
  automation_id UUID,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Automação',
  trigger TEXT NOT NULL,
  keyword TEXT,
  response TEXT NOT NULL,
  response_type TEXT DEFAULT 'text',
  media_url TEXT,
  media_type TEXT,
  media_mimetype TEXT,
  media_filename TEXT,
  delay INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  media_mimetype TEXT,
  media_filename TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.group_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  anti_link BOOLEAN DEFAULT FALSE,
  anti_spam BOOLEAN DEFAULT FALSE,
  anti_flood BOOLEAN DEFAULT FALSE,
  anti_delete BOOLEAN DEFAULT FALSE,
  welcome_msg TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, group_jid)
);

CREATE TABLE public.smart_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  footer TEXT,
  options JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.automations ADD COLUMN smart_menu_id uuid REFERENCES public.smart_menus(id) ON DELETE SET NULL;

CREATE TABLE public.whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  last_message TEXT,
  intent TEXT,
  last_action TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, phone)
);

CREATE TABLE public.agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  intent TEXT,
  action TEXT NOT NULL,
  data JSONB,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT,
  api_key TEXT,
  api_url TEXT,
  instructions TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.scheduled_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL,
  caption TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 30,
  price NUMERIC DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  working_days TEXT[] DEFAULT ARRAY['mon','tue','wed','thu','fri'],
  start_time TEXT DEFAULT '08:00',
  end_time TEXT DEFAULT '17:00',
  break_start TEXT DEFAULT '12:00',
  break_end TEXT DEFAULT '13:00',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  appointment_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  reminder_2h_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  plan text NOT NULL,
  is_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.model_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.model_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.model_packs(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  response_text text NOT NULL,
  response_type text NOT NULL DEFAULT 'text',
  audio_url text,
  match_type text NOT NULL DEFAULT 'exact'
);

CREATE TABLE public.quick_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  response_text text NOT NULL,
  response_type text NOT NULL DEFAULT 'text',
  audio_url text,
  match_type text NOT NULL DEFAULT 'exact',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  automations jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.global_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  maintenance_mode boolean NOT NULL DEFAULT false,
  welcome_message text NOT NULL DEFAULT '',
  support_contact text NOT NULL DEFAULT ''
);

CREATE INDEX agentx_model_items_by_pack ON public.model_items(pack_id);
CREATE INDEX agentx_quick_reply_by_user ON public.quick_reply(user_id, created_at DESC);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Explicit grants work even when the Supabase project disables automatic Data API exposure.
DO $$
DECLARE base_table text;
BEGIN
  FOREACH base_table IN ARRAY ARRAY[
    'plans', 'users', 'subscriptions', 'contacts', 'messages', 'automations',
    'scheduled_messages', 'scheduled_status', 'group_rules', 'smart_menus', 'whatsapp_sessions',
    'leads', 'agent_logs', 'reminders', 'agents', 'services', 'professionals', 'appointments',
    'license_keys', 'model_packs', 'model_items', 'quick_reply', 'templates', 'global_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', base_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', base_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', base_table);
  END LOOP;

  FOREACH base_table IN ARRAY ARRAY['contacts', 'messages', 'automations', 'smart_menus', 'agent_logs'] LOOP
    EXECUTE format('CREATE POLICY agentx_base_owner ON public.%I TO authenticated '
      'USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))', base_table);
  END LOOP;
END;
$$;

CREATE POLICY agentx_base_read_own_profile ON public.users FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY agentx_base_read_own_subscription ON public.subscriptions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
GRANT SELECT (id, role) ON public.users TO authenticated;
GRANT SELECT ON public.subscriptions, public.scheduled_messages, public.scheduled_status TO authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts, public.messages, public.automations, public.smart_menus TO authenticated;
GRANT SELECT, DELETE ON public.agent_logs TO authenticated;

-- The transport consumes public announcement/messaging links. Private products and proofs use separate buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 10485760);

CREATE POLICY agentx_media_read_own_metadata ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
CREATE POLICY agentx_media_upload_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND name LIKE '%/%' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

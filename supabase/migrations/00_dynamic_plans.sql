-- 1. Create plans table
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  max_connections INTEGER NOT NULL DEFAULT 1,
  max_contacts INTEGER NOT NULL DEFAULT 300,
  max_messages_per_day INTEGER NOT NULL DEFAULT 150,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  automation_level TEXT NOT NULL DEFAULT 'basic',
  price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default plans
INSERT INTO public.plans (name, max_connections, max_contacts, max_messages_per_day, ai_enabled, automation_level, price)
VALUES 
  ('Starter', 1, 300, 150, false, 'basic', 300),
  ('Pro', 1, 999999, 800, true, 'advanced', 900),
  ('Premium', 3, 999999, 999999, true, 'advanced', 1800)
ON CONFLICT (name) DO UPDATE SET
  max_connections = EXCLUDED.max_connections,
  max_contacts = EXCLUDED.max_contacts,
  max_messages_per_day = EXCLUDED.max_messages_per_day,
  ai_enabled = EXCLUDED.ai_enabled,
  automation_level = EXCLUDED.automation_level,
  price = EXCLUDED.price;

-- 2. Update subscriptions table
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.plans(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Migrate existing data
UPDATE public.subscriptions s
SET 
  plan_id = p.id,
  expires_at = s.end_date,
  is_active = (s.status = 'active')
FROM public.plans p
WHERE s.plan = p.name AND s.plan_id IS NULL;

-- 3. Update license_keys table (or create license_codes)
-- We will just use license_keys and add plan_id
ALTER TABLE public.license_keys
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.plans(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- Migrate existing data
UPDATE public.license_keys lk
SET plan_id = p.id
FROM public.plans p
WHERE lk.plan = p.name AND lk.plan_id IS NULL;

-- Enable RLS
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Plans are viewable by everyone" ON public.plans FOR SELECT USING (true);


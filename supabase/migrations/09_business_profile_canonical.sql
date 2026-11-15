-- ==============================================================================
-- KAZIX AGENTX — MIGRATION 09: CANONICAL BUSINESS PROFILES & SETTINGS
-- Single Source of Truth for Multi-Tenant Business Profiles & Niches
-- ==============================================================================

-- 1. Ensure table company_profile has canonical columns & constraints
CREATE TABLE IF NOT EXISTS public.company_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    name TEXT NOT NULL DEFAULT 'Minha Empresa',
    type TEXT NOT NULL DEFAULT 'general',
    description TEXT DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Africa/Maputo',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Drop legacy restrictive check constraint on type if exists
DO $$
BEGIN
    ALTER TABLE public.company_profile DROP CONSTRAINT IF EXISTS company_profile_type_check;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 3. Add canonical check constraint supporting all 5 canonical business types:
-- 'general', 'clinic', 'retail', 'restaurant', 'services'
-- (plus legacy aliases 'sales', 'support', 'ecommerce' mapped safely)
ALTER TABLE public.company_profile 
ADD CONSTRAINT company_profile_type_check 
CHECK (type IN ('general', 'clinic', 'retail', 'restaurant', 'services', 'sales', 'support', 'ecommerce'));

-- 4. Ensure column timezone and settings exist if table already existed
ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Maputo';
ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.company_profile ALTER COLUMN type SET DEFAULT 'general';

-- 5. Backfill: If any company_profile had legacy types, normalize them
UPDATE public.company_profile SET type = 'general' WHERE type IN ('geral', 'sales', 'ecommerce');
UPDATE public.company_profile SET type = 'clinic' WHERE type = 'clinica';
UPDATE public.company_profile SET type = 'services' WHERE type = 'servicos';
UPDATE public.company_profile SET type = 'retail' WHERE type = 'vendas';

-- 6. Row Level Security: Users can view and manage their own company profile
ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company profile" ON public.company_profile;
CREATE POLICY "Users can view own company profile" 
ON public.company_profile FOR SELECT 
USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can update own company profile" ON public.company_profile;
CREATE POLICY "Users can update own company profile" 
ON public.company_profile FOR UPDATE 
USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can insert own company profile" ON public.company_profile;
CREATE POLICY "Users can insert own company profile" 
ON public.company_profile FOR INSERT 
WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

-- 7. Índices de performance
CREATE INDEX IF NOT EXISTS idx_company_profile_user_id ON public.company_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_company_profile_type ON public.company_profile(type);

-- 8. Recarregar cache de esquema do PostgREST
NOTIFY pgrst, 'reload schema';


-- Create company_profile table
CREATE TABLE IF NOT EXISTS public.company_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sales', 'services', 'support', 'ecommerce')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own company profile" ON public.company_profile;
CREATE POLICY "Users can manage their own company profile" 
ON public.company_profile 
FOR ALL 
USING (auth.uid() = user_id);

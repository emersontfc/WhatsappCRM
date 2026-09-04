-- ================================================================
-- WhatsCRM: Módulo de Agendamentos, Consultas & Serviços
-- Execute este script no SQL Editor do seu Supabase Dashboard
-- URL: https://supabase.com/dashboard/project/xhnxhfhmplstqiavswgo/sql
-- ================================================================

-- 1. Tabela de Serviços / Procedimentos
CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 30,
  price NUMERIC DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Profissionais / Médicos / Especialistas
CREATE TABLE IF NOT EXISTS public.professionals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 3. Tabela de Consultas e Agendamentos
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  appointment_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'completed', 'cancelled'
  notes TEXT,
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  reminder_2h_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Políticas de Segurança (Row Level Security)
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own services" ON public.services;
CREATE POLICY "Users can manage their own services" ON public.services FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own professionals" ON public.professionals;
CREATE POLICY "Users can manage their own professionals" ON public.professionals FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own appointments" ON public.appointments;
CREATE POLICY "Users can manage their own appointments" ON public.appointments FOR ALL USING (auth.uid() = user_id);

-- 5. Função RPC opcional para execuções administrativas futuras
CREATE OR REPLACE FUNCTION public.exec_sql(sql_query text)
RETURNS void AS $$
BEGIN
  EXECUTE sql_query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Recarregar cache do PostgREST
NOTIFY pgrst, 'reload schema';

-- 05_crm_core_alignment.sql
-- Migração segura e não-destrutiva para unificar Contactos, Conversas e Leads (CRM Core)

-- 1. Extensões na tabela contacts
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- 2. Extensões na tabela leads
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'novo',
ADD COLUMN IF NOT EXISTS value NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'whatsapp',
ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;

-- 3. Extensões na tabela messages
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- 4. Backfill retrocompatível de contact_id nos leads existentes
UPDATE public.leads l
SET contact_id = c.id
FROM public.contacts c
WHERE l.phone = c.phone 
  AND l.user_id = c.user_id 
  AND l.contact_id IS NULL;

-- 5. Normalização de estágios em leads antigos
UPDATE public.leads
SET stage = CASE 
  WHEN status = 'qualified' THEN 'em_atendimento'
  WHEN status = 'lost' THEN 'perdido'
  ELSE 'novo'
END
WHERE stage IS NULL OR stage = 'novo';

-- 6. Criação de índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_leads_contact_id ON public.leads (contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads (stage);
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone ON public.contacts (user_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_last_message ON public.contacts (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_contact_read ON public.messages (contact_id, is_read);

-- Recarregar cache de esquema do PostgREST
NOTIFY pgrst, 'reload schema';

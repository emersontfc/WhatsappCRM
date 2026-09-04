-- ==============================================================================
-- AGENTEX CRM - ATUALIZAÇÃO DO BANCO DE DADOS SUPABASE
-- Execute este script no SQL Editor do Supabase para ativar todas as colunas
-- ==============================================================================

-- 1. Colunas adicionais na tabela 'contacts'
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_paused_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- 2. Coluna de leitura na tabela 'messages'
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- 3. Colunas de telefone de administradores na tabela 'users'
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_phones TEXT DEFAULT '';

-- 4. Permitir status do WhatsApp apenas com texto no 'scheduled_status'
ALTER TABLE scheduled_status ALTER COLUMN media_url DROP NOT NULL;
ALTER TABLE scheduled_status ALTER COLUMN media_type DROP NOT NULL;

-- 5. Atualizar cache do PostgREST / Supabase
NOTIFY pgrst, 'reload schema';

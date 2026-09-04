-- 06_admin_authorized_phones.sql
-- Adiciona campos para identificação de Administradores e Gerentes autorizados no WhatsApp

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS admin_phones TEXT DEFAULT '';

-- Atualizar cache do esquema para o Supabase/PostgREST reconhecer imediatamente
NOTIFY pgrst, 'reload schema';

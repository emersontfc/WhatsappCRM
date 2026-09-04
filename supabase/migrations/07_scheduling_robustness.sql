-- 07_scheduling_robustness.sql
-- Garante total flexibilidade para agendamento de status (texto e mídia) e mensagens com documentos/faturas

-- 1. Permite Status em texto no WhatsApp (mídia opcional)
ALTER TABLE public.scheduled_status 
ALTER COLUMN media_url DROP NOT NULL;

ALTER TABLE public.scheduled_status 
ALTER COLUMN media_type DROP NOT NULL;

-- 2. Assegura colunas de nome de arquivo e mimetype para envio fiel de PDFs/Faturas
ALTER TABLE public.scheduled_messages
ADD COLUMN IF NOT EXISTS media_mimetype TEXT,
ADD COLUMN IF NOT EXISTS media_filename TEXT,
ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'contact';

-- 3. Recarregar cache de esquemas
NOTIFY pgrst, 'reload schema';

-- Migration 10: WhatsApp Baileys 7 LID & Messaging Architecture Fix
-- Ensures robust identification for WhatsApp LIDs (@lid), Phone Numbers (@s.whatsapp.net),
-- safe indexing, message deduplication and unread tracking.

-- 1. Support LID in contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lid TEXT;
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_contacts_user_lid ON public.contacts(user_id, lid);
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone ON public.contacts(user_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_last_message ON public.contacts(user_id, last_message_at DESC NULLS LAST);

-- 3. Robust message tracking and deduplication
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS msg_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_filename TEXT;

-- Remove existing historical duplicates before enforcing unique index
DELETE FROM public.messages
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY user_id, msg_id 
      ORDER BY timestamp ASC, id ASC
    ) as rnum
    FROM public.messages
    WHERE msg_id IS NOT NULL AND msg_id != ''
  ) t
  WHERE t.rnum > 1
);

CREATE INDEX IF NOT EXISTS idx_messages_user_contact_ts ON public.messages(user_id, contact_id, timestamp ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_user_msg_id ON public.messages(user_id, msg_id) WHERE msg_id IS NOT NULL AND msg_id != '';

-- 4. Clean up existing corrupted contacts where LID was inadvertently saved into phone
UPDATE public.contacts
SET 
  lid = COALESCE(lid, REPLACE(phone, '@lid', '')),
  phone = CASE 
    WHEN phone LIKE '%@lid' THEN ''
    ELSE phone 
  END
WHERE phone LIKE '%@lid';

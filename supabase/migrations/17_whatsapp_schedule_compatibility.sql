BEGIN;

-- The current agenda uses contact_id, group_jid or scheduled_status as the destination.
-- Some existing databases also have a mandatory phone column from the original agenda.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.scheduled_messages'::regclass
      AND attname = 'phone' AND attnotnull AND NOT attisdropped
  ) THEN
    ALTER TABLE public.scheduled_messages ALTER COLUMN phone DROP NOT NULL;
  END IF;
END;
$$;

ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.scheduled_status
  ALTER COLUMN media_url DROP NOT NULL,
  ALTER COLUMN media_type DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS error text;

-- Apply the ownership rule even where an older permissive policy remains installed.
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_messages, public.scheduled_status FROM PUBLIC, anon;

DROP POLICY IF EXISTS agentx_messages_schedule_access ON public.scheduled_messages;
CREATE POLICY agentx_messages_schedule_access ON public.scheduled_messages TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS agentx_messages_schedule_owner ON public.scheduled_messages;
CREATE POLICY agentx_messages_schedule_owner ON public.scheduled_messages AS RESTRICTIVE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS agentx_status_schedule_access ON public.scheduled_status;
CREATE POLICY agentx_status_schedule_access ON public.scheduled_status TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS agentx_status_schedule_owner ON public.scheduled_status;
CREATE POLICY agentx_status_schedule_owner ON public.scheduled_status AS RESTRICTIVE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
NOTIFY pgrst, 'reload schema';

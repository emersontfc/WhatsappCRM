BEGIN;

-- Older installations may have inherited the default EXECUTE grant from PostgreSQL.
DO $$
BEGIN
  IF to_regprocedure('public.exec_sql(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_schedule_contract_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.scheduled_messages') IS NOT NULL
    AND to_regclass('public.scheduled_status') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attnotnull AND NOT attisdropped AND (
        (attrelid = to_regclass('public.scheduled_messages') AND attname IN ('phone', 'contact_id')) OR
        (attrelid = to_regclass('public.scheduled_status') AND attname IN ('media_url', 'media_type'))
      )
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('public.scheduled_messages') AND tgname = 'agentx_create_next_group_post'
        AND tgenabled IN ('O', 'A')
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('public.scheduled_status') AND tgname = 'agentx_create_next_status'
        AND tgenabled IN ('O', 'A')
    );
$$;
REVOKE ALL ON FUNCTION public.agentx_schedule_contract_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_schedule_contract_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

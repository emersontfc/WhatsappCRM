BEGIN;
DO $$
DECLARE
 relation_name text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
   RAISE EXCEPTION 'Expected Supabase Realtime publication is missing';
 END IF;
 FOREACH relation_name IN ARRAY ARRAY['messages', 'contacts'] LOOP
   IF NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = relation_name AND c.relrowsecurity
   ) THEN
     RAISE EXCEPTION 'Expected RLS on public.% before enabling Realtime', relation_name;
   END IF;
   IF NOT EXISTS (
     SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = relation_name
   ) THEN
     EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', relation_name);
   END IF;
 END LOOP;
END;
$$;
COMMIT;

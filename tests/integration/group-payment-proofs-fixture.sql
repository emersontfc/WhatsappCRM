-- Legacy Supabase policies stay in place while the migration protects the new bucket.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO anon, authenticated;
GRANT SELECT ON storage.objects TO service_role;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_storage_buckets ON storage.buckets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY existing_storage_objects ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO storage.buckets (id, name, public) VALUES ('unrelated', 'unrelated', true);
INSERT INTO storage.objects (bucket_id, name) VALUES ('unrelated', 'other-file.pdf');

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
CREATE TABLE public.group_rules (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  group_jid text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  anti_link boolean NOT NULL DEFAULT false,
  anti_spam boolean NOT NULL DEFAULT false,
  anti_flood boolean NOT NULL DEFAULT false,
  welcome_msg text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, group_jid)
);
INSERT INTO public.group_rules(user_id, group_jid, active, anti_spam)
VALUES ('00000000-0000-4000-8000-000000000001', '120363000000001@g.us', true, true),
  ('00000000-0000-4000-8000-000000000002', '120363000000001@g.us', true, true);

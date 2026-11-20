-- Minimal Supabase role and table contracts for a disposable PostgreSQL instance.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT current_setting('request.jwt.claim.sub', true)::uuid $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL, file_size_limit bigint);
CREATE TABLE storage.objects (bucket_id text REFERENCES storage.buckets(id), name text, PRIMARY KEY(bucket_id, name));
GRANT USAGE ON SCHEMA auth, storage TO service_role, authenticated;
GRANT SELECT ON storage.objects TO service_role;
GRANT SELECT ON storage.objects, storage.buckets TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_read_all ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_read_all ON storage.buckets FOR SELECT TO authenticated USING (true);
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
-- Mirror Supabase's browser-access defaults to exercise RLS and explicit revocation.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

INSERT INTO auth.users(id)
SELECT ('00000000-0000-4000-8000-00000000000' || i)::uuid FROM generate_series(1,5) i;

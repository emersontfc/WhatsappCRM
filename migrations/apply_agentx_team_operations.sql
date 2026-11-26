\set ON_ERROR_STOP on
SET search_path = public, extensions;
SELECT pg_advisory_lock(879621, 3);

DO $$
BEGIN
  IF to_regprocedure('public.agentx_seller_quotes_ready()') IS NULL
    OR to_regprocedure('public.agentx_assert_role(uuid,uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Aplica primeiro as migrações 35 e 36 e o esquema de empresas AgentX v2.';
  END IF;
END;
$$;

\ir ../supabase/migrations/37_seller_company_team.sql
\ir ../supabase/migrations/38_whatsapp_private_payment_proofs.sql
\ir ../supabase/migrations/39_seller_notices.sql

SELECT pg_advisory_unlock(879621, 3);
\echo 'Migrações de equipa, comprovativos e avisos 37–39 concluídas.'

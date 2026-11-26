\set ON_ERROR_STOP on
SET search_path = public, extensions;
SELECT pg_advisory_lock(879621, 3);

DO $$
BEGIN
  IF to_regprocedure('public.agentx_seller_delivery_recovery_ready()') IS NULL THEN
    RAISE EXCEPTION 'Aplica as migrações do AgentX até à 26 antes de atualizar os fluxos do WhatsApp.';
  END IF;
END;
$$;

\ir ../supabase/migrations/27_whatsapp_action_claims.sql
\ir ../supabase/migrations/28_group_policy_schedule.sql
\ir ../supabase/migrations/29_catalog_campaigns.sql
\ir ../supabase/migrations/30_whatsapp_quoted_agenda.sql
\ir ../supabase/migrations/31_whatsapp_operator_audit.sql

SELECT pg_advisory_unlock(879621, 3);
\echo 'Migrações WhatsApp 27–31 concluídas.'

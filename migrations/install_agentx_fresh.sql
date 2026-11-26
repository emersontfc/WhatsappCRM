-- Run with psql and a migration-owner connection against a new managed Supabase project.
\set ON_ERROR_STOP on
SET search_path = public, extensions;
SELECT pg_advisory_lock(879621, 3);

DO $guard$
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS required(name)
       WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = required.name)) THEN
    RAISE EXCEPTION 'AgentX fresh install requires managed Supabase Auth, Storage, Realtime and database roles';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
          AND dependency.objid = relation.oid AND dependency.deptype = 'e')
  ) OR EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM storage.buckets)
    OR to_regprocedure('public.exec_sql(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'AgentX fresh install refused: this project is not empty. Use the upgrade path for existing installations.';
  END IF;
END;
$guard$;

BEGIN;
\ir 0000_agentx_base.sql
COMMIT;

\ir ../supabase/migrations/00_dynamic_plans.sql
\ir ../supabase/migrations/01_logging_system.sql
\ir ../supabase/migrations/02_add_free_plan.sql
\ir ../supabase/migrations/03_add_list_json_to_automations.sql
\ir ../supabase/migrations/04_company_profile.sql
\ir ../supabase/migrations/05_crm_core_alignment.sql
\ir ../supabase/migrations/06_admin_authorized_phones.sql
\ir ../supabase/migrations/07_scheduling_robustness.sql
\ir ../supabase/migrations/08_agentx_2_0_commerce_operations.sql
\ir ../supabase/migrations/09_business_profile_canonical.sql
\ir ../supabase/migrations/10_contacts_lid_support.sql
\ir ../supabase/migrations/11_messages_realtime.sql
\ir ../supabase/migrations/12_catalog_deliverables.sql
\ir ../supabase/migrations/13_whatsapp_operator.sql
\ir ../supabase/migrations/14_whatsapp_sales_pipeline.sql
\ir ../supabase/migrations/15_whatsapp_group_moderation.sql
\ir ../supabase/migrations/16_whatsapp_recurring_posts.sql
\ir ../supabase/migrations/17_whatsapp_schedule_compatibility.sql
\ir ../supabase/migrations/18_agentx_operations.sql
\ir ../supabase/migrations/19_contact_phone_identity.sql
\ir ../supabase/migrations/20_seller_workspace.sql
\ir ../supabase/migrations/21_seller_lead_compatibility.sql
\ir ../supabase/migrations/22_seller_payment_methods.sql
\ir ../supabase/migrations/23_agenda_dispatch.sql
\ir ../supabase/migrations/24_appointment_booking_delivery.sql
\ir ../supabase/migrations/25_group_payment_proofs.sql
\ir ../supabase/migrations/26_seller_delivery_recovery.sql
\ir ../supabase/migrations/27_whatsapp_action_claims.sql
\ir ../supabase/migrations/28_group_policy_schedule.sql
\ir ../supabase/migrations/29_catalog_campaigns.sql
\ir ../supabase/migrations/30_whatsapp_quoted_agenda.sql
\ir ../supabase/migrations/31_whatsapp_operator_audit.sql
\ir ../supabase/migrations/32_human_handoff_alerts.sql
\ir ../supabase/migrations/33_appointment_self_service.sql
\ir ../supabase/migrations/34_group_content_moderation.sql
\ir apply_agentx_v2.sql

BEGIN;

-- The older migrations inherit platform privileges. Apply explicit access for the fresh install.
REVOKE ALL ON public.logs, public.company_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logs, public.company_profile TO service_role;
GRANT SELECT, DELETE ON public.logs TO authenticated;
CREATE POLICY agentx_read_own_logs ON public.logs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY agentx_delete_own_logs ON public.logs FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Existing logger implementations use either level/details or type/metadata.
ALTER TABLE public.logs ADD COLUMN type text, ADD COLUMN metadata jsonb;

-- These v2 RPCs are security invokers. New projects need explicit table privileges for them.
GRANT SELECT, INSERT, UPDATE ON public.organizations, public.agentx_orders,
  public.agentx_payment_proofs, public.agentx_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO service_role;
GRANT SELECT ON storage.objects TO service_role;

CREATE SCHEMA agentx_internal;
REVOKE ALL ON SCHEMA agentx_internal FROM PUBLIC, anon, authenticated;
CREATE TABLE agentx_internal.installation (
  version text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF public.agentx_seller_payments_ready() IS DISTINCT FROM true
     OR public.agentx_schedule_dispatch_ready() IS DISTINCT FROM true
     OR public.agentx_appointment_contract_ready() IS DISTINCT FROM true
     OR public.agentx_group_proof_contract_ready() IS DISTINCT FROM true
     OR public.agentx_whatsapp_action_ready() IS DISTINCT FROM true
     OR public.agentx_group_policy_ready() IS DISTINCT FROM true
     OR public.agentx_catalog_campaigns_ready() IS DISTINCT FROM true
     OR public.agentx_whatsapp_quote_ready() IS DISTINCT FROM true
     OR public.agentx_whatsapp_operator_audit_ready() IS DISTINCT FROM true
     OR public.agentx_human_handoff_ready() IS DISTINCT FROM true
     OR public.agentx_appointment_self_service_ready() IS DISTINCT FROM true
     OR public.agentx_group_moderation_ready() IS DISTINCT FROM true
     OR NOT has_function_privilege('service_role', 'public.agentx_seller_confirm_delivery(uuid,uuid)', 'EXECUTE')
     OR public.agentx_contact_phone('841234567') IS DISTINCT FROM '258841234567' THEN
    RAISE EXCEPTION 'AgentX fresh install: schema contract is incomplete';
  END IF;
END;
$$;

INSERT INTO agentx_internal.installation (version) VALUES ('0000+00-34+20261123');
COMMIT;
NOTIFY pgrst, 'reload schema';
SELECT pg_advisory_unlock(879621, 3);
\echo 'AgentX fresh database installation completed.'

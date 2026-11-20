-- Run with psql against the existing Supabase PostgreSQL database.
\set ON_ERROR_STOP on
SELECT pg_advisory_lock(879621, 2);

SELECT to_regclass('public.organizations') IS NULL AS need_foundation \gset
\if :need_foundation
  \ir 20261121_agentx_v2_foundation.sql
\endif

SELECT to_regclass('public.agentx_orders') IS NULL AS need_reviews \gset
\if :need_reviews
  \ir 20261121_agentx_v2_payment_reviews.sql
\endif

SELECT to_regclass('public.agentx_digital_deliveries') IS NULL AS need_delivery \gset
\if :need_delivery
  \ir 20261122_agentx_v2_digital_orders.sql
\endif

SELECT to_regclass('public.agentx_proof_attachments') IS NULL AS need_attachments \gset
\if :need_attachments
  \ir 20261123_agentx_v2_proof_attachments.sql
\endif

DO $$
BEGIN
 IF to_regclass('public.organization_members') IS NULL
 OR to_regclass('public.agentx_workflows') IS NULL
 OR to_regclass('public.agentx_workflow_runs') IS NULL
 OR to_regclass('public.agentx_payment_proofs') IS NULL
 OR to_regclass('public.agentx_outbox') IS NULL
 OR to_regprocedure('public.agentx_review_payment(uuid,uuid,uuid,text,text,text,text)') IS NULL
 OR to_regprocedure('public.agentx_process_digital_deliveries()') IS NULL
 OR to_regprocedure('public.agentx_submit_proof_attachment(uuid,uuid,uuid,text,text)') IS NULL
 OR to_regprocedure('public.agentx_get_proof_attachment(uuid,uuid,uuid)') IS NULL
 OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agentx-v2-digital' AND NOT public) THEN
   RAISE EXCEPTION 'AgentX v2 migration state is incomplete or the delivery bucket is not private';
 END IF;
END;
$$;

SELECT pg_advisory_unlock(879621, 2);

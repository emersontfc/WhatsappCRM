#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

db="$(docker run --rm -d -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
trap 'docker stop "$db" >/dev/null' EXIT
for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done

psql_fixture() { docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_fixture < tests/integration/agentx-inbox-fixture.sql >/dev/null
psql_fixture < tests/integration/group-payment-proofs-fixture.sql >/dev/null
for migration in 08_agentx_2_0_commerce_operations 12_catalog_deliverables 14_whatsapp_sales_pipeline \
  19_contact_phone_identity 20_seller_workspace 21_seller_lead_compatibility 22_seller_payment_methods \
  25_group_payment_proofs 25_group_payment_proofs; do
  psql_fixture < "supabase/migrations/${migration}.sql" >/dev/null
done
psql_fixture < tests/integration/group-payment-proofs-contract.sql >/dev/null

# Exercise installations that did not provision group rules before this migration.
psql_fixture -c 'DROP TABLE public.group_rules' >/dev/null
psql_fixture < supabase/migrations/25_group_payment_proofs.sql >/dev/null
psql_fixture >/dev/null <<'SQL'
SET ROLE service_role;
INSERT INTO public.group_rules(user_id, group_jid)
VALUES ('00000000-0000-4000-8000-000000000001', '120363000000001@g.us');
DO $$
BEGIN
  IF NOT public.agentx_group_proof_contract_ready() OR
    NOT EXISTS (SELECT 1 FROM public.group_rules WHERE active AND NOT proof_intake_enabled) THEN
    RAISE EXCEPTION 'fresh group configuration defaults were not provisioned';
  END IF;
END;
$$;
SQL
printf 'Group payment proof SQL contract passed.\n'

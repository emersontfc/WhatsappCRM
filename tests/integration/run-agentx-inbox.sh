#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

network="$(docker network create "agentx-inbox-$$")"
db=""
rest=""
cleanup() {
  if [[ -n "$rest" ]]; then docker stop "$rest" >/dev/null; fi
  if [[ -n "$db" ]]; then docker stop "$db" >/dev/null; fi
  docker network rm "$network" >/dev/null
}
trap cleanup EXIT

db="$(docker run --rm -d --network "$network" --network-alias database \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine -c wal_level=logical)"
psql_fixture() { docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then break; fi
  sleep 0.25
done
if [[ ${AGENTX_INBOX_FRESH:-0} == 1 ]]; then
  docker exec "$db" mkdir -p /agentx/supabase
  docker cp migrations "$db:/agentx/migrations"
  docker cp supabase/migrations "$db:/agentx/supabase/migrations"
  psql_fixture < tests/integration/agentx-fresh-managed-fixture.sql >/dev/null
  psql_fixture -f /agentx/migrations/install_agentx_fresh.sql >/dev/null
  psql_fixture < tests/integration/agentx-inbox-fresh-data.sql >/dev/null
else
  psql_fixture < tests/integration/agentx-inbox-fixture.sql >/dev/null
  psql_fixture < supabase/migrations/19_contact_phone_identity.sql >/dev/null
  psql_fixture < supabase/migrations/19_contact_phone_identity.sql >/dev/null
  for migration in 08_agentx_2_0_commerce_operations 12_catalog_deliverables 14_whatsapp_sales_pipeline 20_seller_workspace; do
    psql_fixture < "supabase/migrations/${migration}.sql" >/dev/null
  done
  psql_fixture < tests/integration/seller-legacy-schema-regression.sql
  for _ in 1 2; do
    psql_fixture < supabase/migrations/21_seller_lead_compatibility.sql >/dev/null
  done
  psql_fixture >/dev/null <<'SQL'
INSERT INTO public.agentx_seller_settings (user_id, payment_method, payment_recipient, recipient_name)
VALUES ('00000000-0000-4000-8000-000000000002', 'emola', '258870000005', 'Loja anterior');
SQL
  for _ in 1 2; do
    psql_fixture < supabase/migrations/22_seller_payment_methods.sql >/dev/null
  done
  psql_fixture < supabase/migrations/26_seller_delivery_recovery.sql >/dev/null
  psql_fixture < supabase/migrations/27_whatsapp_action_claims.sql >/dev/null
fi

export AGENTX_FIXTURE_JWT_SECRET="agentx-inbox-jwt-test-secret-local-only"
rest="$(docker run --rm -d --network "$network" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI=postgres://postgres@database/postgres -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$AGENTX_FIXTURE_JWT_SECRET" postgrest/postgrest:v13.0.7)"
node tests/integration/run-agentx-inbox.mjs "http://$(docker port "$rest" 3000/tcp)"

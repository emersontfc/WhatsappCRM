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
psql_fixture < tests/integration/agentx-fresh-managed-fixture.sql >/dev/null
psql_fixture < migrations/0000_agentx_base.sql >/dev/null
for migration in 05_crm_core_alignment 08_agentx_2_0_commerce_operations 10_contacts_lid_support 12_catalog_deliverables \
  13_whatsapp_operator 14_whatsapp_sales_pipeline 16_whatsapp_recurring_posts 17_whatsapp_schedule_compatibility 18_agentx_operations \
  19_contact_phone_identity 20_seller_workspace 21_seller_lead_compatibility 22_seller_payment_methods \
  23_agenda_dispatch 29_catalog_campaigns 29_catalog_campaigns; do
  psql_fixture < "supabase/migrations/${migration}.sql" >/dev/null
done
psql_fixture < tests/integration/catalog-campaigns-contract.sql >/dev/null
printf 'Catalogue campaigns SQL contract passed.\n'

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

network="$(docker network create "agentx-bookings-$$")"
db=""
rest=""
cleanup() {
  if [[ -n "$rest" ]]; then docker stop "$rest" >/dev/null; fi
  if [[ -n "$db" ]]; then docker stop "$db" >/dev/null; fi
  docker network rm "$network" >/dev/null
}
trap cleanup EXIT

db="$(docker run --rm -d --network "$network" --network-alias database \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done

psql_fixture() { docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_fixture < tests/integration/appointment-booking-fixture.sql >/dev/null
psql_fixture < supabase/migrations/19_contact_phone_identity.sql >/dev/null

appointments_filenode() { psql_fixture -qAtc "SELECT pg_relation_filenode('public.appointments');"; }
before_filenode="$(appointments_filenode)"
psql_fixture < supabase/migrations/24_appointment_booking_delivery.sql >/dev/null
if [[ $(appointments_filenode) != "$before_filenode" ]]; then
  printf 'Migration 24 rewrote the appointments table.\n' >&2
  exit 1
fi

saved_revision="$(psql_fixture -qAt <<'SQL'
INSERT INTO public.appointments (id, user_id, customer_name, appointment_date, start_time, end_time, status)
VALUES ('90000000-0000-4000-8000-000000000043', '90000000-0000-4000-8000-000000000001',
  'Marcação criada após a migração', '2025-03-06', '10:00', '10:30', 'completed')
RETURNING schedule_revision;
SQL
)"
if [[ -z "$saved_revision" || "$saved_revision" = '00000000-0000-0000-0000-000000000000' ]]; then
  printf 'New appointments must have a generated revision.\n' >&2
  exit 1
fi
psql_fixture < supabase/migrations/24_appointment_booking_delivery.sql >/dev/null
stored_revision="$(psql_fixture -qAtc "SELECT schedule_revision FROM public.appointments WHERE id='90000000-0000-4000-8000-000000000043';")"
if [[ "$stored_revision" != "$saved_revision" || $(appointments_filenode) != "$before_filenode" ]]; then
  printf 'Reapplying migration 24 changed existing revisions or rewrote the appointments table.\n' >&2
  exit 1
fi

psql_fixture < tests/integration/appointment-booking-contract.sql >/dev/null
printf 'Appointment SQL contract passed.\n'

export AGENTX_FIXTURE_JWT_SECRET="agentx-bookings-jwt-test-secret-local-only"
rest="$(docker run --rm -d --network "$network" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI=postgres://postgres@database/postgres -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$AGENTX_FIXTURE_JWT_SECRET" postgrest/postgrest:v13.0.7)"
node --import tsx tests/integration/run-agentx-bookings.mjs "http://$(docker port "$rest" 3000/tcp)"

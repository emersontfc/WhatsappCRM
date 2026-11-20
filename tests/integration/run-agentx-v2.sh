#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

db="$(docker run --rm -d -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
test_logs="$(mktemp -d)"
trap 'docker stop "$db" >/dev/null; rm -rf "$test_logs"' EXIT
psql_test() { docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }

for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
{
  cat tests/integration/agentx-v2-supabase-fixture.sql
  cat migrations/20261121_agentx_v2_foundation.sql
  cat migrations/20261121_agentx_v2_payment_reviews.sql
  cat migrations/20261122_agentx_v2_digital_orders.sql
  cat migrations/rollback/20261122_agentx_v2_digital_orders.sql
  cat migrations/20261122_agentx_v2_digital_orders.sql
  cat migrations/20261123_agentx_v2_proof_attachments.sql
  cat migrations/rollback/20261123_agentx_v2_proof_attachments.sql
  cat migrations/20261123_agentx_v2_proof_attachments.sql
  cat tests/integration/agentx-v2-digital-orders.sql
  cat tests/integration/agentx-v2-proof-attachments.sql
} | psql_test >"$test_logs/setup" 2>&1 || { cat "$test_logs/setup"; exit 1; }

review() {
  psql_test -v reviewer="$1" -v pause="$2" <<'SQL'
SET ROLE service_role;
BEGIN;
SELECT public.agentx_review_payment(
 (SELECT id FROM public.organizations WHERE slug = 'tenant-a'),
 (SELECT id FROM public.agentx_payment_proofs WHERE order_id = '00000000-0000-4000-8000-000000000023'),
 :'reviewer', 'approve', '', 'mpesa', 'REF2'
);
SELECT pg_sleep(:pause);
COMMIT;
SQL
}

# Keep the first transaction open until the other reviewer attempts the same order.
review 00000000-0000-4000-8000-000000000001 3 >"$test_logs/first" 2>&1 &
first=$!
for attempt in {1..30}; do
  sleepers="$(psql_test -Atc "SELECT count(*) FROM pg_stat_activity WHERE wait_event = 'PgSleep'")"
  if [[ "$sleepers" == 1 ]]; then break; fi
  sleep 0.05
done
[[ "$sleepers" == 1 ]] || { cat "$test_logs/first"; exit 1; }
if review 00000000-0000-4000-8000-000000000004 0 >"$test_logs/second" 2>&1; then
  echo "Second reviewer unexpectedly approved the same proof"
  exit 1
fi
wait "$first"
rg -q 'proof already reviewed' "$test_logs/second" || { cat "$test_logs/second"; exit 1; }

psql_test <<'SQL'
SET ROLE service_role;
SELECT public.test_assert((SELECT count(*) FROM public.agentx_outbox
 WHERE aggregate_id = '00000000-0000-4000-8000-000000000023') = 1, 'concurrent reviews emit one event');
SELECT public.test_assert(public.agentx_process_digital_deliveries() = 1, 'concurrent reviews grant one delivery');
SELECT public.test_assert((SELECT count(*) FROM public.agentx_digital_deliveries
 WHERE order_id = '00000000-0000-4000-8000-000000000023') = 1, 'one grant recorded for concurrent approval');
SQL
if psql_test < migrations/rollback/20261122_agentx_v2_digital_orders.sql >"$test_logs/rollback" 2>&1; then
  echo "Rollback unexpectedly removed populated commerce data"
  exit 1
fi
rg -q 'refusing to drop digital commerce data' "$test_logs/rollback" || { cat "$test_logs/rollback"; exit 1; }
if psql_test < migrations/rollback/20261123_agentx_v2_proof_attachments.sql >"$test_logs/attachment-rollback" 2>&1; then
  echo "Rollback unexpectedly removed stored attachments"
  exit 1
fi
rg -q 'refusing to drop payment proof attachments' "$test_logs/attachment-rollback" || { cat "$test_logs/attachment-rollback"; exit 1; }
echo 'AgentX v2 PostgreSQL integration passed'

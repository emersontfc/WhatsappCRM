#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

logs="$(mktemp -d)"
db=""
cleanup() {
  if [[ -n "$db" ]]; then docker stop "$db" >/dev/null; fi
  rm -rf "$logs"
}
trap cleanup EXIT

db="$(docker run --rm -d -e POSTGRES_HOST_AUTH_METHOD=trust \
  --mount "type=bind,source=$PWD,target=/agentx,readonly" postgres:16-alpine -c wal_level=logical)"
for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then break; fi
  sleep 0.25
done

psql_fixture() { docker exec "$db" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
install_fresh() {
  if [[ "${AGENTX_FRESH_SQL_EDITOR:-0}" = 1 ]]; then
    node scripts/render-agentx-fresh-sql.mjs | docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1
  else
    psql_fixture -f /agentx/migrations/install_agentx_fresh.sql
  fi
}
psql_fixture -f /agentx/tests/integration/agentx-fresh-managed-fixture.sql >/dev/null
install_fresh >"$logs/install" 2>&1 || { cat "$logs/install"; exit 1; }
psql_fixture -f /agentx/tests/integration/agentx-fresh-schema-contract.sql >/dev/null

if install_fresh >"$logs/repeat" 2>&1; then
  printf 'Fresh installation unexpectedly accepted the existing schema.\n' >&2
  exit 1
fi
if ! rg -q 'AgentX fresh install refused' "$logs/repeat"; then
  cat "$logs/repeat"
  exit 1
fi

printf 'AgentX fresh schema passed: migrations, permissions, tenant RLS, storage ownership and populated-project refusal.\n'

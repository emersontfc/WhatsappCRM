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
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
for attempt in {1..40}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then break; fi
  sleep 0.25
done
docker exec -i "$db" psql -X -U postgres -v ON_ERROR_STOP=1 < tests/integration/agentx-inbox-fixture.sql >/dev/null

export AGENTX_FIXTURE_JWT_SECRET="agentx-inbox-jwt-test-secret-local-only"
rest="$(docker run --rm -d --network "$network" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI=postgres://postgres@database/postgres -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$AGENTX_FIXTURE_JWT_SECRET" postgrest/postgrest:v13.0.7)"
node tests/integration/run-agentx-inbox.mjs "http://$(docker port "$rest" 3000/tcp)"

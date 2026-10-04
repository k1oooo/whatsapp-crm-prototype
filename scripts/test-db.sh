#!/usr/bin/env bash
# Runs every migration on an empty Postgres, checks the schema, then runs supabase/tests/*.sql
# (row level security between two businesses, the job queue, the dashboard numbers).
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/test-db.sh
#
# It creates a throwaway database called crm_test (dropping it first), so point it at a local or CI
# Postgres, never at a real project. Needs the psql client.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Set DATABASE_URL to an admin connection to a LOCAL or CI Postgres}"
ADMIN="$DATABASE_URL"
TEST="${DATABASE_URL%/*}/crm_test"
PSQL=(psql -q -tA -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$ADMIN" -c "drop database if exists crm_test" -c "create database crm_test" >/dev/null

echo "== stub for Supabase's roles and auth schema"
"${PSQL[@]}" "$TEST" -f supabase/tests/00_local_stub.sql

for f in supabase/migrations/*.sql; do
  echo "== migration $(basename "$f")"
  "${PSQL[@]}" "$TEST" -f "$f"
done

echo "== migrations are safe to run twice"
for f in supabase/migrations/*.sql; do "${PSQL[@]}" "$TEST" -f "$f" >/dev/null; done

echo "== verify_schema.sql reports nothing missing"
missing=$("${PSQL[@]}" "$TEST" -f supabase/verify_schema.sql)
if [ -n "$missing" ]; then echo "Missing from the schema:"; echo "$missing"; exit 1; fi

for f in supabase/tests/[1-9]*.sql; do
  echo "== $(basename "$f")"
  "${PSQL[@]}" "$TEST" -f "$f"
done
echo "All database tests passed."

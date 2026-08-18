#!/usr/bin/env bash
set -euo pipefail

run_tests() {
  local database_url=$1
  for migration in supabase/migrations/*.sql; do
    psql "$database_url" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done
  for test_file in supabase/tests/*.sql; do
    psql "$database_url" -v ON_ERROR_STOP=1 -f "$test_file" >/dev/null
  done
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }
  run_tests "$DATABASE_URL"
else
  command -v initdb >/dev/null || { echo "PostgreSQL tools are required." >&2; exit 1; }

  pgdata=$(mktemp -d "${TMPDIR:-/tmp}/long-box-pg.XXXXXX")
  port=${LONG_BOX_TEST_DB_PORT:-55432}
  cleanup() {
    pg_ctl -D "$pgdata" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$pgdata"
  }
  trap cleanup EXIT

  initdb -D "$pgdata" -A trust >/dev/null
  pg_ctl -D "$pgdata" -o "-p $port" -w start >/dev/null
  createdb -p "$port" long_box_test
  run_tests "postgresql://localhost:$port/long_box_test"
fi

echo "Database migrations and integration assertions passed."

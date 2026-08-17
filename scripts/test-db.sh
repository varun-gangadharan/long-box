#!/usr/bin/env bash
set -euo pipefail

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
psql -p "$port" -d long_box_test -v ON_ERROR_STOP=1 \
  -f supabase/migrations/202608170001_phase_1_foundation.sql >/dev/null
psql -p "$port" -d long_box_test -v ON_ERROR_STOP=1 \
  -f supabase/tests/phase_1.sql >/dev/null

echo "Database migration and integration assertions passed."

#!/usr/bin/env bash
set -euo pipefail

base_url=${1:-${DEPLOY_URL:-}}
if [[ -z "$base_url" ]]; then
  echo "Usage: npm run smoke -- https://example.com" >&2
  exit 2
fi
base_url=${base_url%/}
body=$(mktemp)
trap 'rm -f "$body"' EXIT

check() {
  local name=$1 url=$2 signal=$3
  local status
  status=$(curl --silent --show-error --location --output "$body" --write-out '%{http_code}' \
    --connect-timeout 5 --max-time 15 "$url")
  if [[ "$status" != 200 ]] || ! grep -Fq "$signal" "$body"; then
    echo "FAIL $name: HTTP $status or missing response signal" >&2
    exit 1
  fi
  echo "PASS $name"
}

check "homepage" "$base_url" "Find your way into comics"
check "readiness" "$base_url/api/health" '"status":"ok"'
check "reading path" "$base_url/api/reading-path?characters=Daredevil" '"recommendations"'

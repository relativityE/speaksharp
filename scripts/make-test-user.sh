#!/usr/bin/env bash
# =============================================================================
# make-test-user.sh — throwaway test-account factory (one-liner).
# =============================================================================
# Creates a disposable pro/free test user in Supabase and (by default) wires the
# credentials into frontend/.env.test, ready for `bash scripts/run-v4-gates.sh`.
#
# How it works: a thin wrapper over the `setup-test-users.yml` GitHub workflow
# (`action=create`). The workflow creates the user **on GitHub's cloud with the
# service-role key from Secrets** — you never touch the service-role key. You only
# supply a throwaway email + password, which the script generates for you.
#
# A throwaway test-account password you mint here is NOT a protected secret
# (unlike the service-role key, API keys, real-user creds, or SOAK_TEST_PASSWORD).
#
# Usage:
#   bash scripts/make-test-user.sh <pro|free> [--no-wire] [--print-password]
#   pnpm make:test-user pro            # create a Pro user + wire it into frontend/.env.test
#   pnpm make:test-user free           # same, Free tier (FREE_TEST_*)
# =============================================================================
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

TIER="${1:-}"
case "$TIER" in
  pro|free) ;;
  *) echo "usage: make-test-user.sh <pro|free> [--no-wire] [--print-password]"; exit 1;;
esac
shift || true

WIRE=1; SHOW_PW=0
for a in "$@"; do
  case "$a" in
    --no-wire) WIRE=0;;
    --print-password) SHOW_PW=1;;
    *) echo "unknown option: $a"; exit 1;;
  esac
done

EMAIL="test-${TIER}-$(date +%Y%m%d%H%M%S)@test.com"
PASSWORD="Tt$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 18)9z"

echo "▶ creating ${TIER} test user ${EMAIL} via setup-test-users.yml (service-role stays in GitHub Secrets)…"
gh workflow run setup-test-users.yml \
  -f action=create -f create_email="$EMAIL" -f create_tier="$TIER" -f create_password="$PASSWORD" >/dev/null
sleep 6
RID="$(gh run list --workflow=setup-test-users.yml -L 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RID" --exit-status

if [ "$WIRE" = 1 ]; then
  ENVF="frontend/.env.test"; touch "$ENVF"
  if [ "$TIER" = pro ]; then EK=E2E_PRO_EMAIL; PK=E2E_PRO_PASSWORD; else EK=FREE_TEST_EMAIL; PK=FREE_TEST_PASSWORD; fi
  grep -vE "^(${EK}|${PK})=" "$ENVF" > "$ENVF.tmp" 2>/dev/null || true
  mv "$ENVF.tmp" "$ENVF"
  printf '%s=%s\n%s=%s\n' "$EK" "$EMAIL" "$PK" "$PASSWORD" >> "$ENVF"
  echo "✓ ${TIER} user created + wired into ${ENVF}  (${EK} / ${PK})"
else
  echo "✓ ${TIER} user created (not wired — use --wire-less output below)"
fi

echo "  EMAIL=${EMAIL}"
if [ "$SHOW_PW" = 1 ]; then echo "  PASSWORD=${PASSWORD}"; else echo "  PASSWORD=(written to ${ENVF:-frontend/.env.test}; pass --print-password to echo it)"; fi
echo ""
echo "Next: bash scripts/run-v4-gates.sh"

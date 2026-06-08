#!/usr/bin/env bash
# ============================================================================
# Reclassify over-classified GitHub Actions SECRETS -> VARIABLES (ENV_INVENTORY §3b)
# ============================================================================
#
# WHY a values file: GitHub secret VALUES are write-only (you cannot read a secret's
# value back via API/CLI). To create a Variable with the same value, the value must be
# supplied by the owner. Put values in a NON-repo file (default /private/tmp/github-vars.env),
# one `KEY=value` per line, for the names listed below. Values never enter the repo.
#
# SAFETY: this script ONLY creates Variables (non-secret config). It does NOT delete any
# Secret — it PRINTS the delete commands for the OWNER to run AFTER:
#   (1) dev flips the workflow refs `secrets.X` -> `vars.X`, and
#   (2) test verifies CI/Canary/Deploy is green.
# Run from repo root with `gh` authed as the repo owner.
#
# Usage:  bash scripts/ops/reclassify-github-env.sh [values-file]
set -euo pipefail
VALUES="${1:-/private/tmp/github-vars.env}"

# Over-classified -> should be a Variable. Verified present as live GitHub Secrets (2026-06-08).
VARS=(
  SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_PROJECT_ID
  STRIPE_PUBLISHABLE_KEY STRIPE_PRO_PRICE_ID STRIPE_BASIC_PRICE_ID
  SENTRY_DSN SENTRY_API_BASE SENTRY_ORG SENTRY_PROJECT
  POSTHOG_PROJECT_API_KEY POSTHOG_PROJECT_ID POSTHOG_API_HOST POSTHOG_INGEST_HOST
  EDGE_FN_URL VERCEL_PROJECT_ID
  BASIC_TEST_EMAIL PRO_TEST_EMAIL   # emails: owner may instead keep as Secrets to limit enumeration
)

if [ ! -f "$VALUES" ]; then
  echo "ERROR: values file not found: $VALUES"
  echo "Create it with one KEY=value per line for: ${VARS[*]}"
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$VALUES"; set +a

echo "Creating GitHub Variables (non-secret) from $VALUES ..."
created=0
for v in "${VARS[@]}"; do
  val="${!v:-}"
  if [ -z "$val" ]; then echo "  SKIP $v (no value provided)"; continue; fi
  gh variable set "$v" --body "$val" >/dev/null && { echo "  ✓ variable set: $v"; created=$((created+1)); }
done
echo "Done: $created variables set."

echo ""
echo "NEXT — do NOT run these yet:"
echo "  1) dev flips workflow refs  secrets.X -> vars.X  for the names above"
echo "  2) test verifies CI / Canary / Deploy are green"
echo "  3) THEN owner deletes the now-duplicated secrets:"
for v in "${VARS[@]}"; do echo "       gh secret delete $v"; done

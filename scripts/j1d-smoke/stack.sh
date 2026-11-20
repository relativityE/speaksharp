#!/usr/bin/env bash
# J1.d reserved-namespace smoke: a DISPOSABLE local Supabase stack (with Mailpit) and this commit's app, on loopback only.
#   stack.sh up    → installs nothing; starts a run-unique stack from a temporary copy of backend/, builds and serves the app,
#                    writes the env the spec reads to $J1D_SMOKE_STATE/env (mode 600) and the stack identity to identity.json
#   stack.sh down  → stops the app and the stack (no backup) and proves every recorded container, volume and network is gone
# Adapted from .github/workflows/billing-local-stack-journey.yml (stack only: no Stripe, no secrets, no hosted project); the
# stack identity is captured and proven destroyed here, by this stack's own project label.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# This stack's own Docker resources, by the Supabase CLI's project label (never another stack's).
ids() { docker "$1" ls -q${2:+ $2} --filter "label=com.supabase.cli.project=$PROJECT" | sort; }
capture() {
  local c v n
  c="$(docker ps -aq --filter "label=com.supabase.cli.project=$PROJECT" | sort | jq -R . | jq -s .)"
  v="$(ids volume | jq -R . | jq -s .)"; n="$(ids network | jq -R . | jq -s .)"
  jq -n --arg p "$PROJECT" --argjson c "$c" --argjson v "$v" --argjson n "$n" '{project: $p, containers: $c, volumes: $v, networks: $n}'
}
STATE="${J1D_SMOKE_STATE:?set J1D_SMOKE_STATE to a scratch directory}"
# In Actions the project embeds this run's id and attempt, so the teardown proof can name its own run's stack.
if [ "${GITHUB_ACTIONS:-}" = true ]; then RUN="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"; else RUN="${J1D_SMOKE_RUN:-local-$(date -u +%Y%m%d%H%M%S)}"; fi
PROJECT="j1d-smoke-${RUN}"
API_URL="http://127.0.0.1:54321"
MAIL_URL="http://127.0.0.1:54324"
APP_URL="http://localhost:5173"
mkdir -p "$STATE"; chmod 700 "$STATE"

case "${1:-}" in
up)
  [ -e "$STATE/workdir" ] && { echo "refusing: $STATE already holds a stack"; exit 1; }
  cp -R backend "$STATE/workdir"
  config="$STATE/workdir/supabase/config.toml"
  sed -i "s/^project_id = .*/project_id = \"$PROJECT\"/" "$config"
  grep -qx "project_id = \"$PROJECT\"" "$config" || { echo 'could not give the stack its run-unique project id'; exit 1; }
  # Scratch stack only: no stale seed; email confirmation ON with Mailpit; the app on loopback is the only redirect target.
  cat >> "$config" <<TOML

[db.seed]
enabled = false

[auth]
site_url = "$APP_URL"
additional_redirect_urls = ["$APP_URL", "$APP_URL/**"]

[auth.email]
enable_signup = true
enable_confirmations = true

[inbucket]
enabled = true
port = 54324
TOML
  echo "$PROJECT" > "$STATE/project"
  supabase start --workdir "$STATE/workdir" -x studio,imgproxy,vector,logflare
  status="$(supabase status --workdir "$STATE/workdir" -o json)"
  [ "$(jq -r '.API_URL' <<<"$status")" = "$API_URL" ] || { echo 'unexpected local API URL'; exit 1; }
  anon="$(jq -r '.ANON_KEY' <<<"$status")"; service="$(jq -r '.SERVICE_ROLE_KEY' <<<"$status")"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::add-mask::$anon"; echo "::add-mask::$service"; fi
  baseline="$(supabase migration list --local --workdir "$STATE/workdir" 2>/dev/null | awk -F'|' 'NF>2 && $1 ~ /[0-9]/ {gsub(/ /,"",$1); v=$1} END {print v}')"
  capture > "$STATE/identity.json"
  # This commit's Edge functions on the same loopback stack (the app's access check and account deletion run through them):
  # payments off, no provider key, the local app as SITE_URL. --no-verify-jwt matches how production publishes them.
  ( umask 077; { echo "SITE_URL=$APP_URL"; echo "PAYMENTS_ENABLED=false"; } > "$STATE/functions.env" )
  nohup supabase functions serve --workdir "$STATE/workdir" --no-verify-jwt --env-file "$STATE/functions.env" > "$STATE/functions.log" 2>&1 &
  echo $! > "$STATE/functions.pid"
  code=''
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H "Origin: $APP_URL" "$API_URL/functions/v1/check-usage-limit" || true)"
    { [ "$code" = 204 ] || [ "$code" = 200 ]; } && break
    sleep 2
  done
  { [ "$code" = 204 ] || [ "$code" = 200 ]; } || { echo 'the local Edge functions did not come up'; exit 1; }
  [ "$(jq '.containers | length' "$STATE/identity.json")" -gt 0 ] || { echo 'no containers recorded for this stack'; exit 1; }
  # The app, built for this stack only. The service key never enters the build or the browser.
  VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$anon" VITE_AUTH_MODE=real \
    pnpm --dir frontend exec vite build --mode production > "$STATE/build.log" 2>&1
  nohup pnpm --dir frontend exec vite preview --host localhost --port 5173 --strictPort > "$STATE/app.log" 2>&1 &
  echo $! > "$STATE/app.pid"
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "$APP_URL/" && break; sleep 2; done
  curl -fsS -o /dev/null "$APP_URL/" || { echo 'the local app did not come up'; exit 1; }
  curl -fsS -o /dev/null "$MAIL_URL/api/v1/messages" || { echo 'local Mailpit did not answer'; exit 1; }
  umask 077
  tools="node $(node --version) pnpm $(pnpm --version) supabase $(supabase --version 2>/dev/null | head -1) playwright $(pnpm exec playwright --version)"
  { printf 'J1D_SMOKE_APP_URL=%q\n' "$APP_URL"; printf 'J1D_SMOKE_API_URL=%q\n' "$API_URL"; printf 'J1D_SMOKE_MAIL_URL=%q\n' "$MAIL_URL"
    printf 'J1D_SMOKE_SERVICE_ROLE_KEY=%q\n' "$service"; printf 'J1D_SMOKE_ANON_KEY=%q\n' "$anon"; printf 'J1D_SMOKE_COMMIT=%q\n' "$(git rev-parse HEAD)"
    printf 'J1D_SMOKE_MIGRATION_BASELINE=%q\n' "$baseline"; printf 'J1D_SMOKE_TOOLS=%q\n' "$tools"
  } > "$STATE/env"
  echo "stack up: project=$PROJECT baseline=$baseline (keys written to $STATE/env, not printed)"
  ;;
down)
  for pid_file in app.pid functions.pid; do [ -f "$STATE/$pid_file" ] && kill "$(cat "$STATE/$pid_file")" 2>/dev/null || true; done
  rm -f "$STATE/functions.env"
  [ -d "$STATE/workdir" ] || { echo 'no stack recorded'; exit 1; }
  # A checked stop, then the checked teardown proof bound to this commit and run attempt (scripts/j1d-smoke/teardown-proof.mjs):
  # every recorded container, volume and network must answer Docker's not-found and the label selectors must be empty.
  stop_exit=0
  supabase stop --workdir "$STATE/workdir" --no-backup || stop_exit=$?
  node scripts/j1d-smoke/teardown-proof.mjs "$STATE" "$stop_exit"
  rm -f "$STATE/env"
  [ "$stop_exit" = 0 ] || { echo "supabase stop exited $stop_exit"; exit 1; }
  ;;
*) echo "usage: stack.sh up|down"; exit 2 ;;
esac

#!/usr/bin/env bash
# Stage runner for the explicitly selected Claude or GitHub execution environment.
# GitHub evidence-free cases need no privileged producer. Evidence-required cases
# use the fixed same-job parent; its service credentials never reach admission/drivers.
# This script does not dispatch a workflow or grant operational authorization.
# Stages: install-tools, build-plan, stimulus-preflight, build-plan-with-receipt, gate-and-validate, reserve (nightly), run, collect.
# Credential discipline: each stage runs under `env -i` and receives ONLY the names config credentials.runEnvironment.stages allows for it (names are
# copied from the caller's environment, never printed). The build-plan child gets the publishable key only; its parent resolver receives the
# reviewed project origin as an argument. Passwords reach the selected-role run stage only.
# Every failure is a hard failure (BLOCKED_SETUP, exit 78). Nothing is ignored, retried or swallowed.
set -euo pipefail
STAGE="${1:-}"
blocked() { echo "BLOCKED_SETUP: $*" >&2; exit 78; }
case "$STAGE" in
  install-tools|build-plan|stimulus-preflight|build-plan-with-receipt|gate-and-validate|reserve|run|collect) ;;
  *) blocked "unknown stage $STAGE" ;;
esac
[ -z "${SUPABASE_SECRET_KEY:-}" ] || blocked "SUPABASE_SECRET_KEY is present; forbidden"
[ -z "${STRIPE_SECRET_KEY:-}" ] || blocked "STRIPE_SECRET_KEY is present; forbidden"
ss_broker_service_role="${SUPABASE_SERVICE_ROLE_KEY:-}"
ss_broker_telemetry_key="${POSTHOG_PERSONAL_API_KEY:-}"
export -n ss_broker_service_role ss_broker_telemetry_key
unset SUPABASE_SERVICE_ROLE_KEY POSTHOG_PERSONAL_API_KEY
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
CFG="${CT_CONFIG:-}"
[ -n "$CFG" ] && [ -f "$CFG" ] || blocked "CT_CONFIG (the reviewed run configuration) is required"
PACKET_DIR="$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" harness.packetDir)" || blocked "CT_CONFIG cannot be read"
HP="$REPO/$PACKET_DIR"
OUT="${CT_OUT:-}"
[ -n "$OUT" ] || blocked "CT_OUT (a new, private output directory) is required"
REQ="${CT_REQUEST:-}"
[ -n "$REQ" ] || blocked "CT_REQUEST (path of the run request) is required"
ROUTE="$(python3 -I -c '
import json,sys
r=json.load(open(sys.argv[1]));runtime=r.get("executionRuntime","Claude SpeakSharp R4")
if runtime not in ("Claude SpeakSharp R4","GitHub Actions SpeakSharp"):sys.exit(78)
cases=[s.get("case") for s in r.get("selection",[])]
if not cases or any(c not in ["AHT-%02d"%n for n in range(1,16)] for c in cases):sys.exit(78)
print("claude" if runtime=="Claude SpeakSharp R4" else "github-producer" if set(cases)&{"AHT-01","AHT-02","AHT-03","AHT-07","AHT-08"} else "github-direct")
' "$REQ")" || blocked "explicit supported runtime and case selection required"
if [[ "$ROUTE" == github-* ]]; then
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" GITHUB_ACTIONS="${GITHUB_ACTIONS:-}" GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}" GITHUB_RUN_ID="${GITHUB_RUN_ID:-}" GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-}" GITHUB_JOB="${GITHUB_JOB:-}" GITHUB_SHA="${GITHUB_SHA:-}" node -e 'require(process.argv[1]).jobIdentity(process.env)' "$HP/bundle/harness/authenticated-job-producer.cjs" >/dev/null || blocked "actual GitHub job identity required"
fi
# Only the fixed privileged parent launcher may receive this key, in its run step.
# Preparation/admission/driver children never receive it. All other routes still refuse.
if [ -n "$ss_broker_service_role" ] && { [ "$ROUTE" != github-producer ] || [ "$STAGE" != run ]; }; then
  blocked "service role belongs only to the selected same-job producer run parent"
fi
mkdir -p "$OUT"
PYENV=("PATH=$PATH" "HOME=${HOME:-/tmp}" "LANG=C.UTF-8")

# run <stage> <command...>: execute with an allowlisted environment only
run_stage() {
  local stage="$1"; shift
  local -a e=("${PYENV[@]}")
  local names n
  names="$(python3 -I "$ROOT/scripts/stage_env.py" "$CFG" "$stage" "$REQ")" || blocked "stage environment configuration or request selection cannot be read"
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    [ -n "${!n:-}" ] || blocked "stage $stage needs $n and it is not set in the environment"
    e+=("$n=${!n}")
  done <<< "$names"
  for n in CT_OUT CT_REQUEST CT_REQUEST_SHA256 CT_CONFIG CT_HISTORY_INDEX CT_COUNTERS CT_APPROVAL CT_GAP_LEDGER CT_RECEIPTS_ROOT CT_RESERVATIONS CT_OFFLINE_CHECKS CT_CHECKOUT CT_FACTS_FILE CT_LIVE_ACCOUNTS_FILE CT_LIVE_ACCOUNTS_SHA256 CT_ACCOUNT_BINDINGS_FILE CT_PRIVATE_INPUT_DIR CT_TASK_ID CT_SOURCE_REFERENCE CT_ENV_ID CT_MEDIA_PARENT CT_CHROME CT_SETUP_MODE CT_SOURCE_SHA CT_EXECUTION_RUN_ID CT_EXISTING_PDFJS_DIR CT_EXISTING_DEPENDENCY_ROOT PLAYWRIGHT_BROWSERS_PATH HTTPS_PROXY HTTP_PROXY NO_PROXY SSL_CERT_FILE NODE_EXTRA_CA_CERTS; do
    [ -z "${!n:-}" ] || e+=("$n=${!n}")
  done
  for n in CT_EVIDENCE_SCOPE_FILE CT_EVIDENCE_SCOPE_SHA256; do
    [ -z "${!n:-}" ] || e+=("$n=${!n}")
  done
  if [[ "$ROUTE" == github-* ]]; then
    for n in GITHUB_ACTIONS GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_JOB GITHUB_SHA; do
      [ -n "${!n:-}" ] || blocked "actual GitHub job field $n missing"
      e+=("$n=${!n}")
    done
  fi
  if [ "$stage" = run ] && [ "$ROUTE" = github-producer ] && [ "$#" -eq 10 ] && [ "$1" = node ] && [ "$2" = "$HP/bundle/harness/with-authenticated-evidence.cjs" ] && [ "$3" = --scope ] && [ "$4" = "$OUT/plan/producer-scope.json" ] && [ "$5" = --scope-sha256 ] && [ "$7" = --plan ] && [ "$8" = "$OUT/plan/cfg/campaign-plan.json" ] && [ "$9" = --plan-sha256 ]; then
    for n in SUPABASE_URL POSTHOG_PROJECT_ID POSTHOG_API_HOST; do
      [ -z "${!n:-}" ] || e+=("$n=${!n}")
    done
    [ -z "$ss_broker_service_role" ] || e+=("SUPABASE_SERVICE_ROLE_KEY=$ss_broker_service_role")
    [ -z "$ss_broker_telemetry_key" ] || e+=("POSTHOG_PERSONAL_API_KEY=$ss_broker_telemetry_key")
    # Shell builtins keep privileged values out of an external env command's argv.
    (
      for n in $(compgen -e); do export -n "$n"; done
      export "${e[@]}"
      exec "$@"
    )
    return
  fi
  env -i "${e[@]}" "$@"
}

playwright_identity() {
  local selected="${CT_EXISTING_DEPENDENCY_ROOT:-${CT_CHECKOUT:-}}"
  [ -n "$selected" ] || blocked "an explicit existing dependency root is required"
  run_stage install-tools node -e '
    const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
    if (!path.isAbsolute(process.argv[1])) throw new Error("dependency root must be absolute");
    const root = fs.realpathSync(process.argv[1]);
    const manifest = fs.realpathSync(path.join(root, "node_modules/playwright/package.json"));
    const actual = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const expected = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).tools.browser.playwright;
    if (actual.version !== expected) throw new Error("existing Playwright version differs from the pin");
    const entry = fs.realpathSync(require.resolve("playwright", {paths: [root]}));
    if (!entry.startsWith(path.dirname(manifest) + path.sep)) throw new Error("resolved Playwright is outside the verified package");
    const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    process.stdout.write(JSON.stringify({root, manifest, manifestSha256: sha(manifest), entry, entrySha256: sha(entry),
      version: actual.version, sourceSha: process.argv[3], runId: process.argv[4]}));
  ' "$selected" "$CFG" "${CT_SOURCE_SHA:-}" "${CT_EXECUTION_RUN_ID:-}"
}

require_runtime_inputs() {
  local n
  for n in CT_CONFIG CT_HISTORY_INDEX CT_COUNTERS CT_GAP_LEDGER CT_RECEIPTS_ROOT CT_RESERVATIONS; do
    [ -n "${!n:-}" ] || blocked "$n is required; retained inputs are not supplied by the source checkout"
    [ -e "${!n}" ] || blocked "$n does not exist"
  done
  if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ]; then
    [ -n "${CT_APPROVAL:-}" ] && [ -f "$CT_APPROVAL" ] || blocked "CT_APPROVAL is required for a recurring run"
  fi
}

plan_env_file() {
  [ -f "$OUT/reconciliation.json" ] || blocked "reconciliation.json is required before plan construction"
  python3 -I "$ROOT/scripts/run_env.py" --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" \
    --reconciliation "$OUT/reconciliation.json" --out "$OUT/plan-env.txt" >/dev/null
}

ensure_account_bindings() {
  local bundle="${CT_LIVE_ACCOUNTS_FILE:-}" bundle_sha="${CT_LIVE_ACCOUNTS_SHA256:-}"
  [ -n "$bundle" ] && [ -f "$bundle" ] || blocked "CT_LIVE_ACCOUNTS_FILE is required"
  [ -n "$bundle_sha" ] || blocked "CT_LIVE_ACCOUNTS_SHA256 is required"
  local private_inputs="${CT_PRIVATE_INPUT_DIR:-${RUNNER_TEMP:?RUNNER_TEMP is required}/run-inputs}"
  CT_PRIVATE_INPUT_DIR="$private_inputs"
  local bindings_base="${CT_ACCOUNT_BINDINGS_FILE:-$private_inputs/account-bindings.json}"
  [ ! -e "$bindings_base" ] || blocked "account bindings output already exists; prebuilt or replayed bindings are refused"
  case "$STAGE" in
    build-plan) CT_ACCOUNT_BINDINGS_FILE="${bindings_base%.json}.build-plan.json" ;;
    build-plan-with-receipt) CT_ACCOUNT_BINDINGS_FILE="${bindings_base%.json}.build-plan-with-receipt.json" ;;
    *) blocked "account bindings may only be produced by a plan-build phase" ;;
  esac
  export CT_ACCOUNT_BINDINGS_FILE
  [ ! -e "$CT_ACCOUNT_BINDINGS_FILE" ] || blocked "account bindings output already exists; prebuilt or replayed bindings are refused"
  run_stage build-plan node "$ROOT/scripts/resolve_live_account_bindings.cjs" \
    --bundle "$bundle" --bundle-sha256 "$bundle_sha" --project-origin "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL is required}" \
    --campaign-id "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" runId)" --out "$CT_ACCOUNT_BINDINGS_FILE"
}

build() {
  local private="$1" with_receipt="${2:-}" builder="$REPO/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" harness.planBuilder)"
  [ -f "$builder" ] || blocked "plan builder missing at $builder"
  for n in CT_CHECKOUT CT_FACTS_FILE CT_REQUEST CT_REQUEST_SHA256; do [ -n "${!n:-}" ] || blocked "$n is required to build the plan"; done
  ensure_account_bindings
  plan_env_file
  local stim=""
  [ "$with_receipt" = "with-receipt" ] && stim="$OUT/stimulus-preflight-receipt.json"
  run_stage build-plan bash -c '
    set -euo pipefail
    set -a; . "$CT_OUT/plan-env.txt"; set +a
    export BP_PACKET="'"$HP"'" BP_CHECKOUT="$CT_CHECKOUT" BP_PRIVATE="'"$private"'" BP_FACTS="$CT_FACTS_FILE" BP_ACCOUNT_BINDINGS_FILE="$CT_ACCOUNT_BINDINGS_FILE" \
           BP_LIVE_ACCOUNTS_SHA256="$CT_LIVE_ACCOUNTS_SHA256" \
           BP_REQUEST_FILE="$CT_REQUEST" BP_REQUEST_SHA256="$CT_REQUEST_SHA256" \
           BP_MEDIA_PARENT="${CT_MEDIA_PARENT:-/var/tmp/ss-media-cloud-test}" BP_BROWSER_IDENTITY="$CT_OUT/browser-identity.json" BP_LEASE_RPCS=1 BP_LEASE_READ=1
    if [ "$BP_RUNTIME" = "Claude SpeakSharp R4" ]; then
      export BP_TASK_ID="${CT_TASK_ID:?actual Claude task required}" BP_SOURCE_REFERENCE="${CT_SOURCE_REFERENCE:?actual Claude source reference required}" BP_ENV_ID="${CT_ENV_ID:?actual Claude environment required}"
    fi
    [ -z "'"$stim"'" ] || export BP_STIM="'"$stim"'"
    if [ "$BP_PRODUCER_MODE" = same-github-job ]; then
      mkdir -m 700 "$BP_PRIVATE"
      node "'"$ROOT/scripts/authenticated_job_bootstrap.cjs"'" --authorization "${CT_EVIDENCE_SCOPE_FILE:?bound evidence scope required}" --authorization-sha256 "${CT_EVIDENCE_SCOPE_SHA256:?evidence scope hash required}" >/dev/null
    else
      python3 -I "'"$builder"'" phase1 >/dev/null
      python3 -I "'"$builder"'" phase2 >/dev/null
    fi
    echo "plan built; stimulus receipt bound: $([ -n "${BP_STIM:-}" ] && echo yes || echo no)"'
}

case "$STAGE" in
  install-tools)
    case "${CT_SETUP_MODE:-existing-only}" in
      existing-only)
        [ -n "${CT_CHROME:-}" ] || blocked "CT_CHROME is required for existing-only setup; no browser will be acquired"
        [ -n "${CT_CHECKOUT:-}" ] || blocked "CT_CHECKOUT is required for existing dependency checks"
        CHROME="$(run_stage install-tools python3 -I "$ROOT/scripts/install_browser.py" --config "$CFG" --existing "$CT_CHROME" \
          --source-sha "${CT_SOURCE_SHA:-}" --run-id "${CT_EXECUTION_RUN_ID:-}" --receipt "$OUT/browser-identity.json")" || blocked "existing browser verification failed"
        PW_IDENTITY="$(playwright_identity)" || blocked "existing pinned Playwright is unavailable; no dependency installation attempted"
        run_stage install-tools python3 -I "$ROOT/scripts/install_pdfjs.py" --config "$CFG" --checkout "$CT_CHECKOUT" \
          --source-dir "${CT_EXISTING_PDFJS_DIR:-$CT_CHECKOUT/node_modules/pdfjs-dist}" --check-only >/dev/null || blocked "existing pinned PDF parser is unavailable; no copy or installation attempted"
        [ -x "$CHROME" ] || blocked "the verified existing browser is not executable"
        printf '%s\n' "$PW_IDENTITY" > "$OUT/playwright-identity.json"
        printf '%s\n' "$CHROME" > "$OUT/chrome-path.txt"
        echo "existing pinned browser, Playwright and PDF parser verified; nothing installed" ;;
      acquire)
        blocked "CT_SETUP_MODE=acquire is unsupported by this runner because it cannot produce the required pre-plan existing-browser identity; use existing-only" ;;
      *) blocked "CT_SETUP_MODE must be existing-only" ;;
    esac ;;
  build-plan) build "$OUT/plan0" ;;
  stimulus-preflight)
    CHROME="$(cat "$OUT/chrome-path.txt")"
    case "${CT_SETUP_MODE:-existing-only}" in
      existing-only)
        [ -f "$OUT/playwright-identity.json" ] || blocked "verified Playwright identity is missing"
        PW_IDENTITY="$(playwright_identity)" || blocked "existing Playwright identity cannot be revalidated"
        [ "$PW_IDENTITY" = "$(cat "$OUT/playwright-identity.json")" ] || blocked "Playwright identity changed after setup"
        PW_CWD="$(python3 -I "$ROOT/scripts/cfg_get.py" "$OUT/playwright-identity.json" root)" || blocked "verified Playwright root cannot be read" ;;
      acquire) blocked "CT_SETUP_MODE=acquire is unsupported by this runner" ;;
      *) blocked "CT_SETUP_MODE must be existing-only" ;;
    esac
    run_stage stimulus-preflight python3 -I "$ROOT/scripts/stimulus_preflight_retry.py" --harness "$HP" --plan "$OUT/plan0/cfg/campaign-plan.json" --chrome "$CHROME" --browser-receipt "$OUT/browser-identity.json" --cwd "$PW_CWD" --out "$OUT/stimulus-preflight-receipt.json" ;;
  build-plan-with-receipt) build "$OUT/plan" with-receipt ;;
  gate-and-validate)
    require_runtime_inputs
    run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py" --config "$CFG" --ledger "$CT_GAP_LEDGER" --history-index "$CT_HISTORY_INDEX" --counters "$CT_COUNTERS" --receipts-root "$CT_RECEIPTS_ROOT" --reservations "$CT_RESERVATIONS" \
      ${CT_APPROVAL:+--approval "$CT_APPROVAL"} --request "$REQ" --out-dir "$OUT/final-gates" --stage final --stimulus-receipt "$OUT/stimulus-preflight-receipt.json" \
      ${CT_OFFLINE_CHECKS:+--offline-checks "$CT_OFFLINE_CHECKS"} --repo "${CT_CHECKOUT:-$REPO}" --enforce-go --require-secret-free
    CAT=()
    if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" sampleMode)" = full ]; then
      CAT=("$ROOT/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" modes.full.assertionCatalog.file)")
      [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" coverageMode)" != partial ] || CAT+=(--selected-full)
    fi
    run_stage gate-and-validate node "$ROOT/tests/node/plan-acceptance.cjs" "$HP" "$OUT/plan/cfg/campaign-plan.json" ${CAT[@]+"${CAT[@]}"}
    echo "final gates GO and the real runner accepts the plan" ;;
  reserve)
    require_runtime_inputs
    execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
    attempt="${GITHUB_RUN_ATTEMPT:-1}"
    [[ "$execution_run_id" =~ ^[0-9]+$ ]] && [ "$attempt" = 1 ] || blocked "reservation requires exact execution run and strict attempt 1"
    # a nightly run takes its reservation BEFORE it spends anything; any exhausted cap (requests, identity reads, Starts, takes, coaching, runner minutes, runs) refuses it
    run_stage reserve python3 -I "$ROOT/scripts/reservations.py" reserve --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" --execution-run-id "$execution_run_id" --attempt "$attempt" \
      --approval "$CT_APPROVAL" --index "$CT_HISTORY_INDEX" --ledger "$CT_RESERVATIONS" --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ;;
  run)
    if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ]; then
      require_runtime_inputs
      execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
      attempt="${GITHUB_RUN_ATTEMPT:-1}"
      [[ "$execution_run_id" =~ ^[0-9]+$ ]] && [ "$attempt" = 1 ] || blocked "run requires exact execution run and strict attempt 1"
      run_stage reserve python3 -I "$ROOT/scripts/reservations.py" require --request-sha256 "$CT_REQUEST_SHA256" --execution-run-id "$execution_run_id" --attempt "$attempt" \
        --approval "$CT_APPROVAL" --index "$CT_HISTORY_INDEX" --ledger "$CT_RESERVATIONS" --run-id "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" runId)"
    fi
    planfile="$OUT/plan/cfg/campaign-plan.json"
    build_receipt="$OUT/plan/cfg/build-plan-consumption.json"
    [ -f "$build_receipt" ] || blocked "retained build-time plan identity is missing"
    psha="$(python3 -I "$ROOT/scripts/cfg_get.py" "$build_receipt" planSha256)" || blocked "retained build-time plan identity cannot be read"
    actual_psha="$(sha256sum "$planfile" | cut -d' ' -f1)"
    [ "$psha" = "$actual_psha" ] || blocked "campaign plan changed after the build-time identity was retained"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/started.txt"
    if [ "$ROUTE" = github-producer ]; then
      scopefile="$OUT/plan/producer-scope.json"
      [ -f "$scopefile" ] || blocked "prepared bound producer scope missing"
      ssha="$(sha256sum "$scopefile" | cut -d' ' -f1)"
      run_stage run node "$HP/bundle/harness/with-authenticated-evidence.cjs" --scope "$scopefile" --scope-sha256 "$ssha" --plan "$planfile" --plan-sha256 "$psha"
    else
      run_stage run node "$HP/bundle/harness/campaign-runner.cjs" --plan "$planfile" --plan-sha256 "$psha" --execute-r0 true
    fi ;;
  collect)
    started="$(cat "$OUT/started.txt")"
    execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
    attempt="${GITHUB_RUN_ATTEMPT:-1}"
    [[ "$execution_run_id" =~ ^[0-9]+$ ]] && [ "$attempt" = 1 ] || blocked "collect requires exact execution run and strict attempt 1"
    printf '{"os":"%s","nodeVersion":"%s","taskId":"%s"}\n' "$(uname -sr)" "$(node -v)" "${CT_TASK_ID:-}" > "$OUT/runner.json"
    run_stage collect python3 -I "$ROOT/scripts/collect_run_record.py" --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" --execution-run-id "$execution_run_id" --attempt "$attempt" \
      --case-results "$OUT/plan/run/case-results.json" --cases-dir "$OUT/plan/run/cases" --ledger-dir "$OUT/plan/ledgers" \
      --gate-status "$OUT/final-gates/gate-status.json" --workflow "$ROOT/workflow.json" --runner-json "$OUT/runner.json" --started-utc "$started" --ended-utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --out "$OUT/run-record.json" ;;
  *) blocked "unknown stage $STAGE" ;;
esac

#!/usr/bin/env bash
# Stage runner for the RUN ENVIRONMENT: the Claude task environment, the only runtime the harness admission accepts (it requires an
# authoritative Claude task-environment receipt and stops on any service-role key). The GitHub workflow does NOT call this script and holds no
# credentials. Run from anywhere:  bash tools/cloud-test/scripts/execute_run.sh <stage>
# Stages: install-tools, build-plan, stimulus-preflight, build-plan-with-receipt, gate-and-validate, reserve (nightly), run, collect.
# Credential discipline: each stage runs under `env -i` and receives ONLY the names config credentials.runEnvironment.stages allows for it (names are
# copied from the caller's environment, never printed). The build-plan stages get the publishable key only; passwords reach the run stage only.
# Every failure is a hard failure (BLOCKED_SETUP, exit 78). Nothing is ignored, retried or swallowed.
set -euo pipefail
STAGE="${1:-}"
blocked() { echo "BLOCKED_SETUP: $*" >&2; exit 78; }
case "$STAGE" in
  install-tools|build-plan|stimulus-preflight|build-plan-with-receipt|gate-and-validate|reserve|run|collect) ;;
  *) blocked "unknown stage $STAGE" ;;
esac
[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || blocked "SUPABASE_SERVICE_ROLE_KEY is present; admission A4 forbids it and no stage needs it. Unset it."
[ -z "${SUPABASE_SECRET_KEY:-}" ] || blocked "SUPABASE_SECRET_KEY is present; forbidden"
[ -z "${STRIPE_SECRET_KEY:-}" ] || blocked "STRIPE_SECRET_KEY is present; forbidden"
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
mkdir -p "$OUT"
PYENV=("PATH=$PATH" "HOME=${HOME:-/tmp}" "LANG=C.UTF-8")

# run <stage> <command...>: execute with an allowlisted environment only
run_stage() {
  local stage="$1"; shift
  local -a e=("${PYENV[@]}")
  local names n
  names="$(python3 -I "$ROOT/scripts/stage_env.py" "$CFG" "$stage")" || blocked "stage environment configuration cannot be read"
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    [ -n "${!n:-}" ] || blocked "stage $stage needs $n and it is not set in the environment"
    e+=("$n=${!n}")
  done <<< "$names"
  for n in CT_OUT CT_REQUEST CT_CONFIG CT_HISTORY_INDEX CT_COUNTERS CT_APPROVAL CT_GAP_LEDGER CT_RECEIPTS_ROOT CT_RESERVATIONS CT_OFFLINE_CHECKS CT_CHECKOUT CT_FACTS_FILE CT_ACCOUNT_ID_FILE CT_TASK_ID CT_SOURCE_REFERENCE CT_ENV_ID CT_MEDIA_PARENT CT_CHROME CT_SETUP_MODE CT_SOURCE_SHA CT_EXECUTION_RUN_ID CT_EXISTING_PDFJS_DIR PLAYWRIGHT_BROWSERS_PATH HTTPS_PROXY HTTP_PROXY NO_PROXY SSL_CERT_FILE NODE_EXTRA_CA_CERTS; do
    [ -z "${!n:-}" ] || e+=("$n=${!n}")
  done
  env -i "${e[@]}" "$@"
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

plan_env_file() { python3 -I "$ROOT/scripts/run_env.py" --request "$REQ" --out "$OUT/plan-env.txt" >/dev/null; }

build() {
  local private="$1" with_receipt="${2:-}" builder="$REPO/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" harness.planBuilder)"
  [ -f "$builder" ] || blocked "plan builder missing at $builder"
  for n in CT_CHECKOUT CT_FACTS_FILE CT_ACCOUNT_ID_FILE CT_TASK_ID CT_SOURCE_REFERENCE CT_ENV_ID; do [ -n "${!n:-}" ] || blocked "$n is required to build the plan"; done
  plan_env_file
  local stim=""
  [ "$with_receipt" = "with-receipt" ] && stim="$OUT/stimulus-preflight-receipt.json"
  run_stage build-plan bash -c '
    set -euo pipefail
    set -a; . "$CT_OUT/plan-env.txt"; set +a
    export BP_PACKET="'"$HP"'" BP_CHECKOUT="$CT_CHECKOUT" BP_PRIVATE="'"$private"'" BP_FACTS="$CT_FACTS_FILE" BP_ACCOUNT_ID_FILE="$CT_ACCOUNT_ID_FILE" \
           BP_TASK_ID="$CT_TASK_ID" BP_SOURCE_REFERENCE="$CT_SOURCE_REFERENCE" BP_ENV_ID="$CT_ENV_ID" BP_MEDIA_PARENT="${CT_MEDIA_PARENT:-/var/tmp/ss-media-cloud-test}" BP_LEASE_RPCS=1 BP_LEASE_READ=1
    [ -z "'"$stim"'" ] || export BP_STIM="'"$stim"'"
    python3 -I "'"$builder"'" phase1 >/dev/null
    python3 -I "'"$builder"'" phase2 >/dev/null
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
        run_stage install-tools node -e '
          const fs = require("node:fs"), path = require("node:path");
          const actual = JSON.parse(fs.readFileSync(path.join(process.argv[1], "node_modules/playwright/package.json"), "utf8"));
          const expected = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).tools.browser.playwright;
          if (actual.version !== expected) throw new Error("existing Playwright version differs from the pin");
        ' "$CT_CHECKOUT" "$CFG" || blocked "existing pinned Playwright is unavailable; no dependency installation attempted"
        run_stage install-tools python3 -I "$ROOT/scripts/install_pdfjs.py" --config "$CFG" --checkout "$CT_CHECKOUT" \
          --source-dir "${CT_EXISTING_PDFJS_DIR:-$CT_CHECKOUT/node_modules/pdfjs-dist}" --check-only >/dev/null || blocked "existing pinned PDF parser is unavailable; no copy or installation attempted"
        [ -x "$CHROME" ] || blocked "the verified existing browser is not executable"
        printf '%s\n' "$CHROME" > "$OUT/chrome-path.txt"
        echo "existing pinned browser, Playwright and PDF parser verified; nothing installed" ;;
      acquire)
        # Separate legacy acquisition route. Selecting this mode requires its own
        # operational authorization; the restricted receiving task does not use it.
        CHROME="$(run_stage install-tools python3 -I "$ROOT/scripts/install_browser.py" --config "$CFG")"
        [ -x "$CHROME" ] || blocked "the verified browser is not executable"
        printf '%s\n' "$CHROME" > "$OUT/chrome-path.txt"
        run_stage install-tools npm --prefix "$ROOT/runner" ci --ignore-scripts --no-audit --no-fund
        run_stage install-tools python3 -I "$ROOT/scripts/install_pdfjs.py" --config "$CFG" --checkout "${CT_CHECKOUT:?CT_CHECKOUT is required to provide the pinned PDF parser}" >/dev/null
        echo "pinned browser verified; runner dependencies installed from the lockfile; pinned pdfjs-dist 4.10.38 verified in the checkout" ;;
      *) blocked "CT_SETUP_MODE must be existing-only or separately authorized acquire" ;;
    esac ;;
  build-plan) build "$OUT/plan0" ;;
  stimulus-preflight)
    CHROME="$(cat "$OUT/chrome-path.txt")"
    run_stage stimulus-preflight python3 -I "$ROOT/scripts/stimulus_preflight_retry.py" --harness "$HP" --plan "$OUT/plan0/cfg/campaign-plan.json" --chrome "$CHROME" --cwd "$ROOT/runner" --out "$OUT/stimulus-preflight-receipt.json" ;;
  build-plan-with-receipt) build "$OUT/plan" with-receipt ;;
  gate-and-validate)
    require_runtime_inputs
    run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py" --config "$CFG" --ledger "$CT_GAP_LEDGER" --history-index "$CT_HISTORY_INDEX" --counters "$CT_COUNTERS" --receipts-root "$CT_RECEIPTS_ROOT" --reservations "$CT_RESERVATIONS" \
      ${CT_APPROVAL:+--approval "$CT_APPROVAL"} --request "$REQ" --out-dir "$OUT/final-gates" --stage final --stimulus-receipt "$OUT/stimulus-preflight-receipt.json" \
      ${CT_OFFLINE_CHECKS:+--offline-checks "$CT_OFFLINE_CHECKS"} --repo "${CT_CHECKOUT:-$REPO}" --enforce-go --require-secret-free
    CAT=()
    [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" coverageMode)" != full ] || CAT=("$ROOT/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" modes.full.assertionCatalog.file)")
    run_stage gate-and-validate node "$ROOT/tests/node/plan-acceptance.cjs" "$HP" "$OUT/plan/cfg/campaign-plan.json" ${CAT[@]+"${CAT[@]}"}
    echo "final gates GO and the real runner accepts the plan" ;;
  reserve)
    require_runtime_inputs
    # a nightly run takes its reservation BEFORE it spends anything; any exhausted cap (requests, identity reads, Starts, takes, coaching, runner minutes, runs) refuses it
    run_stage reserve python3 -I "$ROOT/scripts/reservations.py" reserve --request "$REQ" --approval "$CT_APPROVAL" --index "$CT_HISTORY_INDEX" --ledger "$CT_RESERVATIONS" --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ;;
  run)
    if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ]; then
      require_runtime_inputs
      run_stage run python3 -I "$ROOT/scripts/reservations.py" require --approval "$CT_APPROVAL" --index "$CT_HISTORY_INDEX" --ledger "$CT_RESERVATIONS" --run-id "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" runId)"
    fi
    planfile="$OUT/plan/cfg/campaign-plan.json"
    psha="$(sha256sum "$planfile" | cut -d' ' -f1)"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/started.txt"
    run_stage run node "$HP/bundle/harness/campaign-runner.cjs" --plan "$planfile" --plan-sha256 "$psha" --execute-r0 true ;;
  collect)
    started="$(cat "$OUT/started.txt")"
    printf '{"os":"%s","nodeVersion":"%s","taskId":"%s"}\n' "$(uname -sr)" "$(node -v)" "${CT_TASK_ID:-}" > "$OUT/runner.json"
    run_stage collect python3 -I "$ROOT/scripts/collect_run_record.py" --request "$REQ" --case-results "$OUT/plan/run/case-results.json" --cases-dir "$OUT/plan/run/cases" --ledger-dir "$OUT/plan/ledgers" \
      --gate-status "$OUT/final-gates/gate-status.json" --workflow "$ROOT/workflow.json" --runner-json "$OUT/runner.json" --started-utc "$started" --ended-utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --out "$OUT/run-record.json" ;;
  *) blocked "unknown stage $STAGE" ;;
esac

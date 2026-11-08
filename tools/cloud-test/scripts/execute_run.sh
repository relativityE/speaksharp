#!/usr/bin/env bash
# Stage runner for the explicitly selected Claude or GitHub execution environment.
# GitHub evidence-free cases need no privileged producer. Evidence-required cases
# use the fixed same-job parent; its service credentials never reach admission/drivers.
# This script does not dispatch a workflow or grant operational authorization.
# Stages: install-tools, build-plan, stimulus-preflight, build-plan-with-receipt, gate-and-validate, reserve (nightly), manual-reserve, run,
# collect, manual-settle.
# Credential discipline: each stage runs under `env -i` and receives ONLY the names config credentials.runEnvironment.stages allows for it (names are
# copied from the caller's environment, never printed). The build-plan child gets the publishable key only; its parent resolver receives the
# reviewed project origin as an argument. Passwords reach the selected-role run stage only.
# Every failure is a hard failure (BLOCKED_SETUP, exit 78). Nothing is ignored, retried or swallowed.
set -euo pipefail
STAGE="${1:-}"
blocked() { echo "BLOCKED_SETUP: $*" >&2; exit 78; }
# Internal second half of the elevated run stage (see below), entered only through sudo. Sam 1794066566/1794066358 corrections: taking
# ownership of the run-owned trees must stop the stage when it fails, and returning it must be reported (and fail the stage) when it fails.
if [ "$STAGE" = run-as-root ]; then
  [ "$(id -u)" = 0 ] && [ "$#" -eq 4 ] || blocked "run-as-root is internal to the elevated run stage"
  envfile="$2"; owner="$3"; pin="$4"
  [ -f "$envfile" ] && [ ! -L "$envfile" ] || blocked "elevated run environment missing"
  . "$envfile"; rm -f "$envfile"
  # Sam 1794066886: a privileged recursive ownership change accepts only canonical roots: absolute, no trailing slash, an existing
  # directory whose realpath is itself (so no component, including the last, is a symlink).
  canonical_dir() { case "$1" in /*/|/) return 1 ;; /*) ;; *) return 1 ;; esac; [ -d "$1" ] && [ ! -L "$1" ] && [ "$(realpath "$1")" = "$1" ]; }
  [ -n "${CT_OUT:-}" ] && canonical_dir "$CT_OUT" || blocked "CT_OUT must be a canonical directory with no symlink component"
  trees=("$CT_OUT")
  case "$pin" in /*) ;; *) blocked "private run inputs must be a canonical directory with no symlink component" ;; esac
  if [ -e "$pin" ] || [ -L "$pin" ]; then
    canonical_dir "$pin" || blocked "private run inputs must be a canonical directory with no symlink component"
    trees+=("$pin")
  fi
  give_back() { chown -R "$owner" "${trees[@]}" || { echo "BLOCKED_SETUP: run outputs could not be returned to the job user" >&2; return 1; }; }
  trap 'give_back; exit 143' TERM
  trap 'give_back; exit 130' INT
  if ! chown -R 0:0 "${trees[@]}"; then
    echo "BLOCKED_SETUP: run-owned trees could not be taken for the root run stage; the stage did not run" >&2
    give_back || exit 78
    exit 78
  fi
  rc=0; bash "$0" run || rc=$?
  if ! give_back; then [ "$rc" -ne 0 ] || rc=78; fi
  exit "$rc"
fi
case "$STAGE" in
  install-tools|build-plan|stimulus-preflight|build-plan-with-receipt|gate-and-validate|reserve|manual-reserve|run|collect|settle|manual-settle) ;;
  *) blocked "unknown stage $STAGE" ;;
esac
# PO 2026-11-06 ("relax the rules ... working release first"): on the ephemeral GitHub-hosted runner the guarded browser lane
# (root-owned browser copy, setpriv to uid 65534 at every launch) needs root, which the job user has through passwordless sudo.
# Only the run stage is elevated, only when the workflow asks for it. Its environment moves through a 0600 file that is deleted as soon
# as it is loaded, and ownership of the run outputs returns to the job user on any exit, so collect/timing/settle can read them.
if [ "$STAGE" = run ] && [ "${CT_RUN_STAGE_AS_ROOT:-}" = 1 ] && [ "$(id -u)" != 0 ]; then
  [ -n "${CT_OUT:-}" ] && [ -d "$CT_OUT" ] || blocked "CT_OUT is required to elevate the run stage"
  envfile="$(mktemp "${RUNNER_TEMP:-/tmp}/run-stage-env.XXXXXX")"; chmod 600 "$envfile"
  export -p > "$envfile"
  # R10 run 42386714252 (A7 "identity receipt unavailable"): the harness's private-state checks (identity-core assertPrivateDir/File,
  # campaign-runner privateDir, with-authenticated-evidence privateJson, producer directories) require the run's own private outputs to be
  # owned by the process that reads them. They were created by the job user in earlier stages, so the root run stage first takes ownership
  # of exactly those run-owned trees ($CT_OUT and the private run inputs) in run-as-root above, and returns both to the job user after the
  # stage or on INT/TERM; a failed take stops the stage, a failed return is reported and fails it.
  private_inputs="${CT_PRIVATE_INPUT_DIR:-${RUNNER_TEMP:-/nonexistent}/run-inputs}"
  exec sudo -n bash "$0" run-as-root "$envfile" "$(id -u):$(id -g)" "$private_inputs"
fi
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
  for n in CT_OUT CT_REQUEST CT_REQUEST_SHA256 CT_CONFIG CT_PRIOR_STATE CT_HISTORY_INDEX CT_COUNTERS CT_APPROVAL CT_GAP_LEDGER CT_RECEIPTS_ROOT CT_RESERVATIONS CT_OFFLINE_CHECKS CT_OFFLINE_PROOF CT_RETAINED_GATE_MANIFEST CT_STATE_REPO CT_STATE_JOURNAL_RESERVE CT_STATE_JOURNAL_SETTLE CT_ACCOUNTING_BOOTSTRAP CT_PERIOD_SCOPE CT_CHECKOUT CT_FACTS_FILE CT_LIVE_ACCOUNTS_FILE CT_LIVE_ACCOUNTS_SHA256 CT_ACCOUNT_BINDINGS_FILE CT_PRIVATE_INPUT_DIR CT_PREREQUISITE_RECEIPT CT_TASK_ID CT_SOURCE_REFERENCE CT_ENV_ID CT_MEDIA_PARENT CT_CHROME CT_BROWSER_RECEIPT CT_SETUP_MODE CT_SOURCE_SHA CT_EXECUTION_RUN_ID CT_EXISTING_PDFJS_DIR CT_EXISTING_DEPENDENCY_ROOT PLAYWRIGHT_BROWSERS_PATH HTTPS_PROXY HTTP_PROXY NO_PROXY SSL_CERT_FILE NODE_EXTRA_CA_CERTS; do
    [ -z "${!n:-}" ] || e+=("$n=${!n}")
  done
  for n in CT_EVIDENCE_SCOPE_FILE CT_EVIDENCE_SCOPE_SHA256 CT_RESERVATION_BINDING_FILE CT_RESERVATION_BINDING_SHA256; do
    [ -z "${!n:-}" ] || e+=("$n=${!n}")
  done
  if [[ "$ROUTE" == github-* ]]; then
    for n in GITHUB_ACTIONS GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_JOB GITHUB_SHA; do
      [ -n "${!n:-}" ] || blocked "actual GitHub job field $n missing"
      e+=("$n=${!n}")
    done
  fi
  if [ "$stage" = run ] && [ "$ROUTE" = github-producer ] && [ "$1" = node ] && [ "$2" = "$HP/bundle/harness/with-authenticated-evidence.cjs" ] && [ "$3" = --scope ] && [ "$4" = "$OUT/plan/producer-scope.json" ] && [ "$5" = --scope-sha256 ] && [ "$7" = --plan ] && [ "$8" = "$OUT/plan/cfg/campaign-plan.json" ] && [ "$9" = --plan-sha256 ] && { [ "$#" -eq 10 ] || { [ "$#" -eq 14 ] && [ "${11}" = --admission-receipt ] && [ "${12}" = "$OUT/plan/run/admission/admission-receipt.json" ] && [ "${13}" = --admission-receipt-sha256 ]; }; }; then
    for n in SUPABASE_URL POSTHOG_PROJECT_ID POSTHOG_API_HOST; do
      [ -z "${!n:-}" ] || e+=("$n=${!n}")
    done
    [ -z "$ss_broker_service_role" ] || e+=("SUPABASE_SERVICE_ROLE_KEY=$ss_broker_service_role")
    [ -z "$ss_broker_telemetry_key" ] || e+=("POSTHOG_PERSONAL_API_KEY=$ss_broker_telemetry_key")
    # Shell builtins keep privileged values out of an external env command's argv.
    local t0 rc=0; t0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    (
      for n in $(compgen -e); do export -n "$n"; done
      export "${e[@]}"
      exec "$@"
    ) || rc=$?
    # Content-free stage timing (Bezos M2 / run 42142985744): stage, start and end UTC, exit code; never a value, path or argument.
    # Scope (Sam 1793931423.224679): the WRAPPED command only. A refusal raised before it (stage-environment checks, BLOCKED_SETUP)
    # leaves no row, and steps outside this script are not traced; the timing table states this (init_run_inputs.TRACE_SCOPE).
    [ -z "${OUT:-}" ] || [ ! -d "${OUT:-}" ] || printf '%s\t%s\t%s\t%s\n' "$stage" "$t0" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" >> "$OUT/stage-trace.tsv"
    return "$rc"
  fi
  local t0 rc=0; t0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  env -i "${e[@]}" "$@" || rc=$?
  [ -z "${OUT:-}" ] || [ ! -d "${OUT:-}" ] || printf '%s\t%s\t%s\t%s\n' "$stage" "$t0" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" >> "$OUT/stage-trace.tsv"
  return "$rc"
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
  if [ -n "${CT_RETAINED_GATE_MANIFEST:-}" ]; then
    [ -n "${CT_OFFLINE_CHECKS:-}" ] && [ -f "$CT_OFFLINE_CHECKS" ] || blocked "CT_OFFLINE_CHECKS is required for the retained-input receiver"
    [ -n "${CT_OFFLINE_PROOF:-}" ] && [ -f "$CT_OFFLINE_PROOF" ] || blocked "CT_OFFLINE_PROOF is required for the retained-input receiver"
    if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ]; then
      local recurring
      # D2(a): the approval and receipt root are required; reservations come from the authenticated journal snapshot (gate-and-validate), so
      # neither the legacy reservations file nor the history index is required on this route.
      for recurring in CT_APPROVAL CT_RECEIPTS_ROOT; do
        [ -n "${!recurring:-}" ] && [ -e "${!recurring}" ] || blocked "$recurring is required for retained-input recurring gates"
      done
    fi
    return
  fi
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
  # The run's one execution deadline (init step output; Sam 1794071539): plan, guard policy, admission and producer scope all bind it.
  [ -n "${CT_EXECUTION_DEADLINE:-}" ] || blocked "CT_EXECUTION_DEADLINE (the run's one execution deadline) is required"
  python3 -I "$ROOT/scripts/run_env.py" --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" \
    --reconciliation "$OUT/reconciliation.json" --execution-deadline "$CT_EXECUTION_DEADLINE" --out "$OUT/plan-env.txt" \
    ${CT_RESERVATION_BINDING_FILE:+--reservation-binding "$CT_RESERVATION_BINDING_FILE" --reservation-binding-sha256 "${CT_RESERVATION_BINDING_SHA256:-}" --execution-run-id "${CT_EXECUTION_RUN_ID:-}" --source-sha "${CT_SOURCE_SHA:-}"} >/dev/null
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
        [ -n "${CT_BROWSER_RECEIPT:-}" ] && [ -f "$CT_BROWSER_RECEIPT" ] || blocked "this run's installed-browser discovery receipt is required"
        CHROME="$(run_stage install-tools python3 -I "$ROOT/scripts/install_browser.py" --config "$CFG" \
          --received-installed-receipt "$CT_BROWSER_RECEIPT" --baselines "$ROOT/config/browser-baselines.v1.json" --environment github-hosted \
          --source-sha "${CT_SOURCE_SHA:-}" --run-id "${CT_EXECUTION_RUN_ID:-}" --receipt "$OUT/browser-identity.json")" || blocked "installed-browser receipt revalidation failed"
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
    RES_IN="${CT_RESERVATIONS:-}"
    priority="$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)"
    occurrence_args=()
    if [ -n "${CT_RETAINED_GATE_MANIFEST:-}" ] && \
       [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$CT_RETAINED_GATE_MANIFEST" schema)" = speaksharp.cloud-test.aggregate-receiver.v2-occurrence ]; then
      retained="$OUT/retained-source"
      # Verify the immutable historical half before it is allowed to influence current release verification. The retained receipt does not
      # admit a request or a PASS result; the full receiver below still requires this occurrence's authenticated reserve and runtime evidence.
      run_stage gate-and-validate python3 -I "$ROOT/scripts/aggregate_receiver.py" --manifest "$CT_RETAINED_GATE_MANIFEST" \
        --config "$CFG" --retained-out-dir "$retained"
      # A manual occurrence cannot prove the served release before the genuine A0-A6 admission qualification.  Retain the immutable
      # historical half and pure plan acceptance here; the run stage completes A7 once, then G2/G7, before any case is dispatched.
      CAT=()
      if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" sampleMode)" = full ]; then
        CAT=("$ROOT/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" modes.full.assertionCatalog.file)")
        [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" coverageMode)" != partial ] || CAT+=(--selected-full)
      fi
      run_stage gate-and-validate node "$ROOT/tests/node/plan-acceptance.cjs" "$HP" "$OUT/plan/cfg/campaign-plan.json" ${CAT[@]+"${CAT[@]}"}
      ( umask 077; printf '%s %s %s\n' "$(sha256sum "$CT_RETAINED_GATE_MANIFEST" | cut -d' ' -f1)" \
          "$(sha256sum "$OUT/plan/cfg/campaign-plan.json" | cut -d' ' -f1)" "$CT_REQUEST_SHA256" > "$OUT/manual-release-gates.deferred" )
      echo "retained history and plan accepted; current release gates require the genuine admission identity"
      exit 0
    elif [ "$priority" = nightly-regression ]; then
      # G11 reads the verified state-ref journal the run's reservation is appended to (RETURN 1793572741.370569), not a file ledger;
      # both gate routes below consume this one snapshot (Sam 1793589877.215059)
      run_stage gate-and-validate python3 -I "$ROOT/scripts/reservations.py" journal-snapshot --out "$OUT/journal-snapshot.json"
      RES_IN="$OUT/journal-snapshot.json"
    fi
    if [ -n "${CT_RETAINED_GATE_MANIFEST:-}" ]; then
      accepted="$OUT/retained-gate-inputs"
      # #1772 Code finding 4446324167: a recurring run's request/campaign binding and reconciliation are its occurrence envelope, derived
      # from the verified journal snapshot and the admitted checkpoint; the retained manifest pins only the historical components.
      run_stage gate-and-validate python3 -I "$ROOT/scripts/aggregate_receiver.py" --manifest "$CT_RETAINED_GATE_MANIFEST" \
        --request "$REQ" --config "$CFG" --out-dir "$accepted" ${occurrence_args[@]+"${occurrence_args[@]}"}
      cmp -s "$accepted/reconciliation.json" "$OUT/reconciliation.json" || blocked "retained receiver and builder do not share the same accepted rollup"
      # Only inputs actually present are forwarded (unset-safe under set -u); a nightly run's are required above. The history index is
      # optional: on the verified journal-snapshot route G11 admits the snapshot without it.
      retained_args=()
      [ -n "${CT_PRIOR_STATE:-}" ] && retained_args+=(--prior-state "$CT_PRIOR_STATE")
      [ -n "${RES_IN:-}" ] && retained_args+=(--reservations "$RES_IN")
      [ -n "${CT_APPROVAL:-}" ] && retained_args+=(--approval "$CT_APPROVAL")
      [ -n "${CT_RECEIPTS_ROOT:-}" ] && retained_args+=(--receipts-root "$CT_RECEIPTS_ROOT")
      [ -n "${CT_HISTORY_INDEX:-}" ] && [ -e "$CT_HISTORY_INDEX" ] && retained_args+=(--history-index "$CT_HISTORY_INDEX")
      run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py" --request "$REQ" --config "$CFG" \
        --workflow "$ROOT/workflow.json" --accepted-input-dir "$accepted" --receiver-receipt "$accepted/receiver-receipt.json" \
        --receiver-manifest "$CT_RETAINED_GATE_MANIFEST" ${retained_args[@]+"${retained_args[@]}"} ${occurrence_args[@]+"${occurrence_args[@]}"} \
        --offline-checks "$CT_OFFLINE_CHECKS" --offline-proof "$CT_OFFLINE_PROOF" \
        --stimulus-receipt "$OUT/stimulus-preflight-receipt.json" --stage final --out-dir "$OUT/final-gates" \
        --repo "${CT_CHECKOUT:-$REPO}" --enforce-go --require-secret-free
      [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$OUT/final-gates/gate-status.json" decision)" = GO ] || blocked "retained aggregate gates are not GO"
    else
      run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py" --config "$CFG" --ledger "$CT_GAP_LEDGER" --history-index "$CT_HISTORY_INDEX" --counters "$CT_COUNTERS" --receipts-root "$CT_RECEIPTS_ROOT" --reservations "${RES_IN:-$CT_RESERVATIONS}" \
        ${CT_APPROVAL:+--approval "$CT_APPROVAL"} ${CT_PRIOR_STATE:+--prior-state "$CT_PRIOR_STATE"} --request "$REQ" --out-dir "$OUT/final-gates" --stage final --stimulus-receipt "$OUT/stimulus-preflight-receipt.json" \
        ${CT_OFFLINE_CHECKS:+--offline-checks "$CT_OFFLINE_CHECKS"} ${CT_OFFLINE_PROOF:+--offline-proof "$CT_OFFLINE_PROOF"} \
        --repo "${CT_CHECKOUT:-$REPO}" --enforce-go --require-secret-free
    fi
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
    run_stage reserve python3 -I "$ROOT/scripts/reservations.py" journal-reserve --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" --execution-run-id "$execution_run_id" --attempt "$attempt" \
      --approval "$CT_APPROVAL" --repo "${CT_CHECKOUT:-$REPO}" --journal "$OUT/reserve-journal" --out "$OUT/reserve-receipt.json"
    # the verified journal right after the reserve: the request reader record execution provenance (I4') checks
    run_stage reserve python3 -I "$ROOT/scripts/reservations.py" journal-snapshot --out "$OUT/journal-reserved.json" ;;
  manual-reserve)
    [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" != nightly-regression ] || blocked "manual reservation refuses nightly requests"
    for n in CT_STATE_REPO CT_STATE_JOURNAL_RESERVE CT_ACCOUNTING_BOOTSTRAP CT_PERIOD_SCOPE; do [ -n "${!n:-}" ] || blocked "$n is required"; done
    execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
    [[ "$execution_run_id" =~ ^[0-9]+$ ]] || blocked "manual reservation requires the execution run id"
    # The CLI checks reviewed activation before reading these inputs. Once activated, this private repository is only a transport workspace;
    # the accepted root and whole remote chain remain authoritative.
    run_stage manual-reserve python3 -I "$ROOT/scripts/manual_reservation.py" reserve --repo "$CT_STATE_REPO" --journal "$CT_STATE_JOURNAL_RESERVE" \
      --out "$OUT/manual-reserve-receipt.json" --request "$REQ" --admitted-sha256 "$CT_REQUEST_SHA256" --run-id "$execution_run_id" \
      --bootstrap "$CT_ACCOUNTING_BOOTSTRAP" --scope "$CT_PERIOD_SCOPE" ;;
  run)
    if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ]; then
      require_runtime_inputs
      execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
      attempt="${GITHUB_RUN_ATTEMPT:-1}"
      [[ "$execution_run_id" =~ ^[0-9]+$ ]] && [ "$attempt" = 1 ] || blocked "run requires exact execution run and strict attempt 1"
      run_stage reserve python3 -I "$ROOT/scripts/reservations.py" journal-require --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" \
        --execution-run-id "$execution_run_id" --attempt "$attempt"
    fi
    planfile="$OUT/plan/cfg/campaign-plan.json"
    build_receipt="$OUT/plan/cfg/build-plan-consumption.json"
    [ -f "$build_receipt" ] || blocked "retained build-time plan identity is missing"
    psha="$(python3 -I "$ROOT/scripts/cfg_get.py" "$build_receipt" planSha256)" || blocked "retained build-time plan identity cannot be read"
    actual_psha="$(sha256sum "$planfile" | cut -d' ' -f1)"
    [ "$psha" = "$actual_psha" ] || blocked "campaign plan changed after the build-time identity was retained"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/started.txt"
    reuse_args=()
    if [ -n "${CT_RETAINED_GATE_MANIFEST:-}" ] && \
       [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$CT_RETAINED_GATE_MANIFEST" schema)" = speaksharp.cloud-test.aggregate-receiver.v2-occurrence ]; then
      require_runtime_inputs
      marker="$OUT/manual-release-gates.deferred"
      expected_marker="$(sha256sum "$CT_RETAINED_GATE_MANIFEST" | cut -d' ' -f1) $actual_psha $CT_REQUEST_SHA256"
      [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(cat "$marker")" = "$expected_marker" ] || blocked "manual pre-admission gate receipt missing or changed"
      admission_dir="$OUT/plan/run/admission"
      admission_file="$admission_dir/admission-receipt.json"
      admission_config="$(python3 -I "$ROOT/scripts/cfg_get.py" "$planfile" admissionConfigFile)" || blocked "campaign admission config cannot be read"
      # R10 run 42318728005 (A6 S12 ENOENT; Sam 1794012265.884079): in the elevated run stage, create-only prepare the plan's own approved
      # private-media parent, which media-private.cjs requires to already exist root-owned 0711. Before admission; never modifies a node.
      if [ "$(id -u)" = 0 ]; then
        media_parent="$(python3 -I "$ROOT/scripts/cfg_get.py" "$admission_config" privateMediaParent)" || blocked "admission privateMediaParent cannot be read"
        python3 -I "$ROOT/scripts/prepare_media_parent.py" --parent "$media_parent" --expected "${CT_MEDIA_PARENT:-/var/tmp/ss-media-cloud-test}" \
          || blocked "approved private media parent could not be prepared"
      fi
      run_stage run node "$HP/bundle/harness/admission.cjs" --bundle "$HP/bundle" --config "$admission_config" --out "$admission_dir" --execute-r0 true
      [ -f "$admission_file" ] && [ ! -L "$admission_file" ] || blocked "genuine admission receipt unavailable"
      admission_sha="$(sha256sum "$admission_file" | cut -d' ' -f1)"
      identity_ledger="$(python3 -I "$ROOT/scripts/cfg_get.py" "$planfile" identityLedger)"
      if [ -n "${CT_PREREQUISITE_RECEIPT:-}" ]; then
        [ -f "$CT_PREREQUISITE_RECEIPT" ] && [ ! -L "$CT_PREREQUISITE_RECEIPT" ] || blocked "prerequisite preflight receipt missing"
        campaign_ledger="$(python3 -I "$ROOT/scripts/cfg_get.py" "$planfile" campaignLedger)"
        # The charge helper receives no account credentials, provider keys, or
        # run-stage environment; only the content-free receipt and admitted ledger.
        env -i PATH="$PATH" HOME="${HOME:-/tmp}" node "$ROOT/scripts/prerequisite_preflight.cjs" charge \
          --receipt "$CT_PREREQUISITE_RECEIPT" --ledger "$campaign_ledger"
      fi
      retained="$OUT/retained-runtime"
      run_stage gate-and-validate python3 -I "$ROOT/scripts/aggregate_receiver.py" --manifest "$CT_RETAINED_GATE_MANIFEST" \
        --config "$CFG" --retained-out-dir "$retained"
      run_stage gate-and-validate python3 -I "$ROOT/scripts/verify_release.py" --request "$REQ" \
        --ledger "$retained/gap-ledger.json" --config "$CFG" --receipts-root "$CT_RECEIPTS_ROOT" \
        --repo "${CT_CHECKOUT:-$REPO}" --current-identity-ledger "$identity_ledger" --out "$OUT/release-verification.json"
      run_stage gate-and-validate python3 -I "$ROOT/scripts/reservations.py" journal-snapshot --out "$OUT/journal-snapshot.json"
      RES_IN="$OUT/journal-snapshot.json"
      accepted="$OUT/retained-gate-inputs"
      run_stage gate-and-validate python3 -I "$ROOT/scripts/aggregate_receiver.py" --manifest "$CT_RETAINED_GATE_MANIFEST" \
        --request "$REQ" --config "$CFG" --out-dir "$accepted" --journal-snapshot "$RES_IN" \
        --occurrence-reconciliation "$OUT/reconciliation.json" --occurrence-release-verification "$OUT/release-verification.json"
      cmp -s "$accepted/reconciliation.json" "$OUT/reconciliation.json" || blocked "retained receiver and builder do not share the same accepted rollup"
      # Sam RETURN 1794116817: the plan's reservation binding is recomputed from the receiver-authenticated events, never trusted as written.
      run_stage gate-and-validate python3 -I "$ROOT/scripts/reservation_runtime_check.py" check-plan --plan "$planfile" --plan-sha256 "$psha" \
        --journal-snapshot "$RES_IN" --reconciliation "$OUT/reconciliation.json" --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" \
        --source-sha "${CT_SOURCE_SHA:-}" --run-id "${GITHUB_RUN_ID:-}" --attempt "${GITHUB_RUN_ATTEMPT:-}" --repo "$REPO"
      retained_args=()
      [ -n "${CT_PRIOR_STATE:-}" ] && retained_args+=(--prior-state "$CT_PRIOR_STATE")
      [ -n "${CT_APPROVAL:-}" ] && retained_args+=(--approval "$CT_APPROVAL")
      [ -n "${CT_RECEIPTS_ROOT:-}" ] && retained_args+=(--receipts-root "$CT_RECEIPTS_ROOT")
      [ -n "${CT_HISTORY_INDEX:-}" ] && [ -e "$CT_HISTORY_INDEX" ] && retained_args+=(--history-index "$CT_HISTORY_INDEX")
      run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py" --request "$REQ" --config "$CFG" \
        --workflow "$ROOT/workflow.json" --accepted-input-dir "$accepted" --receiver-receipt "$accepted/receiver-receipt.json" \
        --receiver-manifest "$CT_RETAINED_GATE_MANIFEST" ${retained_args[@]+"${retained_args[@]}"} \
        --journal-snapshot "$RES_IN" --reservations "$RES_IN" --occurrence-reconciliation "$OUT/reconciliation.json" \
        --occurrence-release-verification "$OUT/release-verification.json" --offline-checks "$CT_OFFLINE_CHECKS" \
        --offline-proof "$CT_OFFLINE_PROOF" --stimulus-receipt "$OUT/stimulus-preflight-receipt.json" --stage final \
        --out-dir "$OUT/final-gates" --repo "${CT_CHECKOUT:-$REPO}" --enforce-go --require-secret-free
      [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$OUT/final-gates/gate-status.json" decision)" = GO ] || blocked "retained aggregate gates are not GO"
      CAT=()
      if [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" sampleMode)" = full ]; then
        CAT=("$ROOT/$(python3 -I "$ROOT/scripts/cfg_get.py" "$CFG" modes.full.assertionCatalog.file)")
        [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" coverageMode)" != partial ] || CAT+=(--selected-full)
      fi
      run_stage gate-and-validate node "$ROOT/tests/node/plan-acceptance.cjs" "$HP" "$planfile" ${CAT[@]+"${CAT[@]}"}
      reuse_args=(--admission-receipt "$admission_file" --admission-receipt-sha256 "$admission_sha")
    fi
    # One more read through the approved path immediately before the campaign: same head, this run's reserve still the open last event.
    run_stage gate-and-validate python3 -I "$ROOT/scripts/reservation_runtime_check.py" pre-start --plan "$planfile" --plan-sha256 "$psha" \
      --request-sha256 "$CT_REQUEST_SHA256" --run-id "${GITHUB_RUN_ID:-}" --attempt "${GITHUB_RUN_ATTEMPT:-}"
    if [ "$ROUTE" = github-producer ]; then
      scopefile="$OUT/plan/producer-scope.json"
      [ -f "$scopefile" ] || blocked "prepared bound producer scope missing"
      ssha="$(sha256sum "$scopefile" | cut -d' ' -f1)"
      run_stage run node "$HP/bundle/harness/with-authenticated-evidence.cjs" --scope "$scopefile" --scope-sha256 "$ssha" --plan "$planfile" --plan-sha256 "$psha" ${reuse_args[@]+"${reuse_args[@]}"}
    else
      run_stage run node "$HP/bundle/harness/campaign-runner.cjs" --plan "$planfile" --plan-sha256 "$psha" --execute-r0 true ${reuse_args[@]+"${reuse_args[@]}"}
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
  manual-settle)
    [ -f "$OUT/run-record.json" ] || blocked "a completed collector run record is required before settle"
    [ -n "${CT_STATE_JOURNAL_SETTLE:-}" ] || blocked "CT_STATE_JOURNAL_SETTLE is required"
    execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
    campaign_id="$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" runId)"
    run_stage manual-settle python3 -I "$ROOT/scripts/manual_reservation.py" settle --repo "$CT_STATE_REPO" --journal "$CT_STATE_JOURNAL_SETTLE" \
      --out "$OUT/manual-settle-receipt.json" --campaign-id "$campaign_id" --run-id "$execution_run_id" \
      --record "$OUT/run-record.json" --scope "$CT_PERIOD_SCOPE" ;;
  settle)
    # the nightly reservation closes on the same journal from the collector's run record (unmeasured dimensions settle at their reserved caps)
    [ "$(python3 -I "$ROOT/scripts/cfg_get.py" "$REQ" priority)" = nightly-regression ] || blocked "settle is for nightly-regression runs"
    execution_run_id="${GITHUB_RUN_ID:-${CT_EXECUTION_RUN_ID:-}}"
    attempt="${GITHUB_RUN_ATTEMPT:-1}"
    [[ "$execution_run_id" =~ ^[0-9]+$ ]] && [ "$attempt" = 1 ] || blocked "settle requires exact execution run and strict attempt 1"
    run_stage settle python3 -I "$ROOT/scripts/reservations.py" journal-settle --request "$REQ" --request-sha256 "$CT_REQUEST_SHA256" --execution-run-id "$execution_run_id" \
      --attempt "$attempt" --approval "$CT_APPROVAL" --repo "${CT_CHECKOUT:-$REPO}" --record "$OUT/run-record.json" --journal "$OUT/settle-journal" --out "$OUT/settle-receipt.json" ;;
  *) blocked "unknown stage $STAGE" ;;
esac

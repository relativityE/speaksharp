#!/usr/bin/env bash
# =============================================================================
# v4 Gate 2 + Gate 3 one-shot runner — LOCAL, REAL-GPU machine, human-run.
# =============================================================================
# The unattended equivalent is .github/workflows/v4-benchmark-gpu.yml (self-hosted
# GPU runner). Use THIS script for a one-off local run on a machine with a real GPU.
#
# It does NOT handle secrets. You (the human) export the 4 values below in your own
# shell; they come from your secret store. Agents never see them. NEVER commit them.
#   export PRO_TEST_EMAIL='...'              # dedicated Pro test account
#   export PRO_TEST_PASSWORD='...'
#   export VITE_SUPABASE_URL='https://<project>.supabase.co'   # public project URL
#   export VITE_SUPABASE_ANON_KEY='...'      # public anon key
#
# Then, from the repo root:   bash scripts/run-v4-gates.sh
#
# Requires: real GPU + WebGPU (chrome://gpu shows "Hardware accelerated"), Node 20+,
# pnpm, and `pnpm install` already run. v4 = base_q4 + distil_q4 only (no tiny).
# =============================================================================
set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO"
BASE_URL="${BASE_URL:-http://localhost:5174}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$(mktemp -d -t v4-gates-XXXX)}"
TS="$(date +%Y%m%d-%H%M%S)"
echo "▶ repo: $REPO ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))  evidence: $EVIDENCE_DIR"

# ---- Guard required creds ---------------------------------------------------
missing=0
for k in PRO_TEST_EMAIL PRO_TEST_PASSWORD VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  [ -z "${!k:-}" ] && { echo "✖ missing required env: $k"; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "Export the 4 values (see header) then re-run. Aborting."; exit 1; }
export SUPABASE_URL="${SUPABASE_URL:-$VITE_SUPABASE_URL}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$VITE_SUPABASE_ANON_KEY}"
export VITE_USE_LIVE_DB=true VITE_SKIP_MSW=true VITE_AUTH_MODE=real VITE_USE_MOCK_AUTH=false

# ---- Playwright Chromium ----------------------------------------------------
echo "▶ ensuring Playwright Chromium..."
pnpm exec playwright install chromium >/dev/null 2>&1 || pnpm exec playwright install chromium

# ---- Start the DEV app on 5174 (dev mode = v4 test overrides honored) --------
echo "▶ starting pnpm dev:real on $BASE_URL ..."
pnpm dev:real > "$EVIDENCE_DIR/v4-vite-$TS.log" 2>&1 &
VITE_PID=$!
trap 'echo "▶ stopping dev server ($VITE_PID)"; kill "$VITE_PID" 2>/dev/null || true' EXIT
pnpm exec wait-on --timeout 120000 "$BASE_URL"
echo "✓ app is up."

# ---- GATE 3 — WebGPU benchmark (writes floors to tests/STT_BENCHMARKS.json) ---
run_bench () {  # $1=variant $2=device $3=extraFlags
  echo ""; echo "════ GATE 3: V4_VARIANT=$1 V4_DEVICE=$2 ════"
  V4_VARIANT="$1" V4_DEVICE="$2" BASE_URL="$BASE_URL" \
    pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts \
      --config=playwright.live.config.ts --project=live-stt-chromium --reporter=list $3 \
    || echo "⚠ benchmark $1|$2 returned non-zero (inspect output above)"
}
run_bench base_q4   webgpu --headed
run_bench distil_q4 webgpu --headed

echo ""; echo "════ GATE 3 floors (vs v2-base 93.89%) ════"
node -e "const f=require('./tests/STT_BENCHMARKS.json').engines.Private.v4.floors||{}; for(const k of ['base_q4|webgpu','distil_q4|webgpu']){const a=(f[k]||{}).expectedAccuracy; console.log('  '+k.padEnd(16), a==null?'NULL (not run)':(a+'%  '+(a>=93.89?'✅ ≥93.89':'❌ <93.89')));}"

# ---- GATE 2 — flag-ON app-path proof on real WebGPU --------------------------
echo ""; echo "════ GATE 2: v4 app-path proof (real WebGPU, headed) ════"
G2_OUT="$EVIDENCE_DIR/v4-gate2-real-gpu-$TS.json"
STT_AUTH=existing STT_MODES=private STT_FIXTURES=h1_6 \
STT_PRIVATE_ENGINE=transformers-js-v4 STT_V4_VARIANT=base_q4 STT_V4_DEVICE=webgpu \
STT_INJECT_MIC_AUDIO=true STT_POST_PLAYBACK_WAIT_MS=15000 STT_FIRST_TEXT_TIMEOUT_MS=45000 \
HEADLESS=false STT_CORPUS_OUT="$G2_OUT" BASE_URL="$BASE_URL" \
  node scripts/manual-stt-corpus-proof.mjs || echo "⚠ Gate 2 proof returned non-zero (inspect above)"

echo ""; echo "════ GATE 2 verdict ════"
node -e "const j=require('$G2_OUT'); const r=(j.results||[])[0]||{}; console.log(JSON.stringify({pass:j.pass, blockers:j.blockers, privateProvider:r.privateProvider, privateRuntimePath:r.privateRuntimePath, journeyPass:r.journeyPass, sessionPersisted:r.sessionPersisted, detailVisible:r.detailVisible},null,2));" 2>/dev/null || echo "  (no evidence file at $G2_OUT)"

echo ""
echo "================================================================"
echo "DONE. Gate 3 floors → tests/STT_BENCHMARKS.json (git diff shows them)."
echo "      Gate 2 proof  → $G2_OUT"
echo "NEXT: commit the floor numbers via PR; post results + ✅/❌ vs 93.89% to the board."
echo "================================================================"

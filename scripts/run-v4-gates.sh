#!/usr/bin/env bash
# =============================================================================
# v4 Gate 2 + Gate 3 one-shot runner — LOCAL, REAL-GPU machine.
# =============================================================================
# The unattended equivalent is .github/workflows/v4-benchmark-gpu.yml (self-hosted
# GPU runner). Use THIS for a one-off local run on a machine with a real GPU.
#
# CREDS: NO manual export needed. This loads the Pro login + Supabase keys from the
# local gitignored dotenv files (.env / .env.local / frontend/.env.test — the same
# files the app + harness already read via dotenv). Exported shell values still win,
# so you CAN override by exporting, but you don't have to. On a fresh machine with no
# such files, it aborts and tells you which creds are missing.
#
# Run from anywhere in the repo:   bash scripts/run-v4-gates.sh
# Requires: real GPU + WebGPU (chrome://gpu = "Hardware accelerated"), Node 20+, pnpm,
# and `pnpm install` already run. v4 = base_q4 + distil_q4 only (no tiny).
# =============================================================================
set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO"
BASE_URL="${BASE_URL:-http://localhost:5174}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$(mktemp -d -t v4-gates-XXXX)}"
TS="$(date +%Y%m%d-%H%M%S)"
echo "▶ repo: $REPO ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))  evidence: $EVIDENCE_DIR"

# ---- Load creds from local dotenv files (no manual export) -------------------
# REAL creds live in .env / .env.local. The MOCK profile (.env.test + frontend/.env.test Supabase,
# VITE_USE_MOCK_AUTH=true) must NEVER supply Supabase or real auth breaks ("Invalid API key").
# Pro login (E2E_PRO_*) lives ONLY in frontend/.env.test. Already-exported shell values win.
# Emits KEY<TAB>VALUE so values with spaces/quotes survive intact.
while IFS=$'\t' read -r k v; do [ -n "${k:-}" ] && export "$k=$v"; done < <(node -e '
  const fs=require("fs"), d=require("dotenv");
  const read=p=>{ try { return d.parse(fs.readFileSync(p)); } catch { return {}; } };
  const root=read(".env"), local=read(".env.local"), fe=read("frontend/.env"), fl=read("frontend/.env.local"), ft=read("frontend/.env.test");
  const isMock=s=>/mock|example|placeholder|localhost|changeme/i.test(s||"");
  const first=(...v)=>v.find(Boolean)||"";                 // Pro creds: first non-empty
  const realSupa=(...v)=>v.find(x=>x && !isMock(x))||"";   // Supabase: first non-empty, non-mock
  const out={
    PRO_TEST_EMAIL: first(process.env.PRO_TEST_EMAIL, process.env.E2E_PRO_EMAIL, ft.E2E_PRO_EMAIL, ft.PRO_TEST_EMAIL, local.PRO_TEST_EMAIL, root.PRO_TEST_EMAIL),
    PRO_TEST_PASSWORD: first(process.env.PRO_TEST_PASSWORD, process.env.E2E_PRO_PASSWORD, ft.E2E_PRO_PASSWORD, ft.PRO_TEST_PASSWORD, local.PRO_TEST_PASSWORD, root.PRO_TEST_PASSWORD),
    // Supabase: REAL files only — explicitly EXCLUDING .env.test / frontend/.env.test (mock).
    VITE_SUPABASE_URL: realSupa(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_URL, local.VITE_SUPABASE_URL, root.VITE_SUPABASE_URL, fl.VITE_SUPABASE_URL, fe.VITE_SUPABASE_URL),
    VITE_SUPABASE_ANON_KEY: realSupa(process.env.VITE_SUPABASE_ANON_KEY, process.env.SUPABASE_ANON_KEY, local.VITE_SUPABASE_ANON_KEY, root.VITE_SUPABASE_ANON_KEY, fl.VITE_SUPABASE_ANON_KEY, fe.VITE_SUPABASE_ANON_KEY),
  };
  for (const [k,val] of Object.entries(out)) if (val) process.stdout.write(k+"\t"+val+"\n");
')

missing=0
for k in PRO_TEST_EMAIL PRO_TEST_PASSWORD VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  [ -z "${!k:-}" ] && { echo "✖ missing cred: $k (not in shell, .env, .env.local, or frontend/.env.test)"; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "Add the missing creds to a local .env file (or export them), then re-run. Aborting."; exit 1; }
export SUPABASE_URL="${SUPABASE_URL:-$VITE_SUPABASE_URL}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$VITE_SUPABASE_ANON_KEY}"
export VITE_USE_LIVE_DB=true VITE_SKIP_MSW=true VITE_AUTH_MODE=real VITE_USE_MOCK_AUTH=false
echo "✓ creds resolved (PRO_TEST_EMAIL + Supabase present) — no manual export needed."

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

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
# CRITICAL: own port 5174. Vite does NOT set strictPort, so if a STALE dev server is already on 5174
# (e.g. a leftover from an earlier manual attempt), our new server silently drifts to 5175 and the test
# would hit the stale server — which may carry a wrong/old Supabase key → "Invalid API key" even though
# our creds are correct. Free the port first so we bind it cleanly.
PORT="${BASE_URL##*:}"
STALE="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$STALE" ]; then
  echo "▶ freeing stale listener(s) on :$PORT → $STALE"
  kill $STALE 2>/dev/null || true; sleep 2
  STALE="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$STALE" ] && { echo "✖ could not free :$PORT (pids: $STALE). Stop them and re-run. Aborting."; exit 1; }
fi
echo "▶ starting pnpm dev:real on $BASE_URL ..."
pnpm dev:real > "$EVIDENCE_DIR/v4-vite-$TS.log" 2>&1 &
VITE_PID=$!
trap 'echo "▶ stopping dev server ($VITE_PID)"; kill "$VITE_PID" 2>/dev/null || true' EXIT
pnpm exec wait-on --timeout 120000 "$BASE_URL"
# Guard: our wrapper must still be alive (if it died, :5174 is someone else's stale server).
kill -0 "$VITE_PID" 2>/dev/null || { echo "✖ our dev server exited — :$PORT may be a stale server. Aborting."; exit 1; }
# Guard: the server on :5174 should be a descendant of OUR wrapper, not a pre-existing process.
if command -v lsof >/dev/null 2>&1; then
  OWNER="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  echo "✓ app is up on :$PORT (listener pids: ${OWNER:-unknown})."
else
  echo "✓ app is up on :$PORT."
fi

# ---- GATE 3 — browser app-path benchmarks (write floors to tests/STT_BENCHMARKS.json) ---
# ALL THREE are the SAME app-path harness (login → record → fake-audio playback → stop →
# saveCandidate). Running v2-base through the SAME path as v4 is the controlled cross-check:
# if the app path were uniformly wrong it would hit v2-base too. Compare each to the Dev
# clean-ceiling anchor (see /private/tmp/DEV_CLEAN_CEILINGS.md): v2-base 100%, v4-base 98.85%,
# v4-distil 98.85% (Node one-shot, model-only).
echo ""; echo "════ GATE 3: v2-base (TransformersJS CPU/WASM) app-path reference ════"
BASE_URL="$BASE_URL" \
  pnpm exec playwright test tests/live/benchmark-cpu.live.spec.ts \
    --config=playwright.live.config.ts --project=live-stt-chromium --reporter=list --headed \
  || echo "⚠ v2-base (cpu) benchmark returned non-zero (inspect output above)"

run_bench () {  # $1=variant $2=device $3=extraFlags
  echo ""; echo "════ GATE 3: V4_VARIANT=$1 V4_DEVICE=$2 ════"
  V4_VARIANT="$1" V4_DEVICE="$2" BASE_URL="$BASE_URL" \
    pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts \
      --config=playwright.live.config.ts --project=live-stt-chromium --reporter=list $3 \
    || echo "⚠ benchmark $1|$2 returned non-zero (inspect output above)"
}
run_bench base_q4   webgpu --headed
run_bench distil_q4 webgpu --headed

echo ""; echo "════ DEV↔TEST SANITY CHECK — browser app-path vs Dev clean ceilings ════"
node -e '
const b=require("./tests/STT_BENCHMARKS.json").engines.Private;
const f=b.v4.floors||{};
const dev={"v2-base":100.0,"v4-base":98.85,"v4-distil":98.85};   // Dev Node one-shot ceilings (model-only)
const got={"v2-base":(b.cpu||{}).expectedAccuracy,"v4-base":(f["base_q4|webgpu"]||{}).expectedAccuracy,"v4-distil":(f["distil_q4|webgpu"]||{}).expectedAccuracy};
const fmt=x=>x==null?"NULL(not run)":x+"%";
console.log("  config       Dev-ceiling   Test-browser(app-path)   delta(pp)");
for(const k of ["v2-base","v4-base","v4-distil"]){const d=dev[k],t=got[k];const dl=(t==null)?"—":(t-d).toFixed(2);console.log("  "+k.padEnd(12),String(d+"%").padEnd(13),fmt(t).padEnd(24),dl);}
const v2=got["v2-base"];
if(v2!=null){
  console.log("\n  A/B bar = v2-base measured THIS run ("+v2+"%) — the retired 93.89% (tiny.en/Node) is NOT the bar.");
  for(const k of ["v4-base","v4-distil"]){const t=got[k];if(t!=null)console.log("  "+k+": "+t+"%  "+(t>=v2?"✅ ≥ v2-base":"❌ < v2-base"));}
}
console.log("\n  Interpretation: large NEGATIVE delta for v4 but ~0 for v2-base ⇒ v4-specific app-path bug.");
console.log("  Large negative delta for BOTH ⇒ general app-path bug. ~0 for both ⇒ no harness damage.");
'

# ---- GATE 2 — flag-ON app-path proof on real WebGPU --------------------------
echo ""; echo "════ GATE 2: v4 app-path proof (real WebGPU, headed) ════"
G2_OUT="$EVIDENCE_DIR/v4-gate2-real-gpu-$TS.json"
STT_AUTH=existing STT_MODES=private STT_FIXTURES=h1_6 \
STT_PRIVATE_ENGINE=transformers-js-v4 STT_V4_VARIANT=base_q4 STT_V4_DEVICE=webgpu \
STT_USE_FAKE_AUDIO_CAPTURE=true STT_FAKE_AUDIO_FILE="$REPO/tests/fixtures/stt-isomorphic/audio/h1_6.wav" \
STT_POST_PLAYBACK_WAIT_MS=15000 STT_FIRST_TEXT_TIMEOUT_MS=45000 \
HEADLESS=false STT_CORPUS_OUT="$G2_OUT" BASE_URL="$BASE_URL" \
  node scripts/manual-stt-corpus-proof.mjs || echo "⚠ Gate 2 proof returned non-zero (inspect above)"

echo ""; echo "════ GATE 2 verdict ════"
node -e "const j=require('$G2_OUT'); const r=(j.results||[])[0]||{}; console.log(JSON.stringify({pass:j.pass, blockers:j.blockers, privateProvider:r.privateProvider, privateRuntimePath:r.privateRuntimePath, journeyPass:r.journeyPass, sessionPersisted:r.sessionPersisted, detailVisible:r.detailVisible},null,2));" 2>/dev/null || echo "  (no evidence file at $G2_OUT)"

echo ""
echo "================================================================"
echo "DONE. Gate 3 floors → tests/STT_BENCHMARKS.json (git diff shows them)."
echo "      Gate 2 proof  → $G2_OUT"
echo "NEXT: commit the floor numbers via PR; post the SANITY-CHECK table (v2-base/v4-base/v4-distil"
echo "      browser app-path vs Dev clean ceilings) + ✅/❌ vs v2-base to the board."
echo "================================================================"

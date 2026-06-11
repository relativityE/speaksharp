# v4 WebGPU proof — turnkey runbook (TWO separate gates)

## Test Agent state reset — supersedes old v4 assumptions

Before running anything, acknowledge this reset:

- v4 is hidden/off-flag/experimental. Beta/paid spine remains Private v2-base default + v2-tiny fallback.
- Keep **Gate A** and **Gate B** separate. Gate A proves WebGPU value via `dev_harness`; Gate B proves real PostHog targeting via `posthog_flag`.
- Do **not** infer selection source from `reason`. `reason=webgpu_available_v4_flag` can occur for both real PostHog selection and forceAuto on a real GPU. Use `selectionSource`.
- URL/localStorage overrides are not beta/prod proof and must be ignored outside dev/test harness mode. The real forceAuto localStorage key is `speaksharp.v4.forceAuto`; old `v4ForceAuto` localStorage tests are insufficient.
- Headless CI can prove control-plane safety, no-bypass behavior, no-WebGPU fallback, and telemetry cleanliness. It cannot prove real WebGPU WER/RTF.
- Official Gate B targeting must be operator-controlled: Product/Test sets `isInternalTester=true` on the disposable PostHog person, or Product explicitly authorizes a temporary single-user condition on flag `709644`.
- Route back to Dev only for wrong `selectionSource`, production URL/localStorage bypass, unsafe telemetry, flag-on/no-WebGPU forcing broken v4, or v4 failure after valid WebGPU/audio setup.

**Why this exists:** the v4 decode + app-path + flag/telemetry contracts are unit-proven, but two
things can only be confirmed on a real GPU machine + real PostHog. They are **different questions**
and must be closed as **two independent gates** (do not conflate them):

- **Gate A — WebGPU VALUE.** "Is v4 worth anything technically?" Does base_q4 actually run on real
  WebGPU and produce useful WER/RTF? Needs a GPU. **Needs NOTHING from PostHog.** Selection via the
  dev/test `forceAuto` shim is fine here — but the artifact must label it `selectionSource=dev_harness`.
- **Gate B — PostHog OPERATIONAL targeting.** "Can we safely target v4 operationally?" Does the real
  production flag select v4 for a targeted tester (and stay off for everyone else)? Uses the real
  flag, no overrides; artifact must show `selectionSource=posthog_flag`.

Neither gate blocks beta while v4 stays hidden/off-flag. **Both** are required before v4 is exposed to users.

**Candidate SHA:** `dev/v4-integration@f69a2658` (adds honest `selectionSource` on the runtime decision).
**Who runs it:** a human (or Test) on a real **WebGPU-capable** browser/machine. Not headless CI.

## ⚠️ The resolver quirk you MUST know (why `reason` alone is not enough)
On a real GPU `webgpuAvailable===true`, so the resolver returns `runtime:'webgpu',
reason:'webgpu_available_v4_flag'` **whether v4 came from the real flag OR from `forceAuto`**
(`privateRuntimePath.ts`: `if (webgpuAvailable || forceAuto)`). So `reason=webgpu_available_v4_flag`
proves **WebGPU was used**, NOT that the flag selected it. The honest selection-source signal is the
new `selectionSource` field on the decision (`__PRIVATE_STT_RUNTIME_DEBUG__.selectionSource`):
`dev_harness` when forceAuto-only drove it, `posthog_flag` when the real flag did, `default` on v2.
`selectionSource` is REQUIRED on every decision (never inferred from `reason`). Locked by
`privateV4FlagOperationalProof.test.ts` Case F1 (dev/test forceAuto → `dev_harness`) and Case F2
(production ignores the real `speaksharp.v4.forceAuto` localStorage key → v2-base, `default`).

## Pre-req (one-time)
- A machine whose Chrome reports WebGPU: open `chrome://gpu` → "WebGPU: Hardware accelerated".
  The harness launches `channel:'chrome'` (real Chrome) with WebGPU **enabled** unless you set
  `DISABLE_WEBGPU` — so just run `HEADLESS=false` and do NOT set `DISABLE_WEBGPU`.
- `VITE_SUPABASE_URL` + anon key (already in local dotenv). Gate A needs no Pro creds; Gate B needs a targeted user.

---

# GATE A — WebGPU VALUE proof (run this NOW)
Selection allowed: **dev/test `forceAuto`** (label it honestly). Goal: prove v4 runs on real WebGPU + WER/RTF.

```bash
# shell 1 — app on :5174 (required, or the run is INVALID_SETUP):
git checkout dev/v4-integration && pnpm install
VITE_USE_LIVE_DB=true VITE_AUTH_MODE=real pnpm dev:real

# shell 2 — NON-headless so WebGPU is real; fresh auth (Private is not Pro-gated); forceAuto selects v4:
HEADLESS=false \
STT_AUTH=fresh STT_MODES=private STT_FIXTURES=washington_01 \
STT_USE_FAKE_AUDIO_CAPTURE=true \
STT_FAKE_AUDIO_FILE="$PWD/tests/fixtures/stt-isomorphic/audio/washington_01.wav" \
STT_V4_FORCE_AUTO=1 STT_V4_DEVICE=webgpu \
node scripts/manual-stt-corpus-proof.mjs
```

**PASS (Gate A):**
- worker `loaded` message `device == 'webgpu'` (the REAL onnxruntime backend — check this FIRST)
- `privateRuntimePath.runtime == 'webgpu'`, `.webgpuAvailable == true`, **`.selectionSource == 'dev_harness'`**
- `privateProvider == 'transformers-js-v4'`, `fallbackOccurred == false`
- non-empty transcript, `wer`/`accuracyPct` captured (the **v4 quality number**), RTF captured
- save/history/detail pass

**INVALID (re-run, do NOT conclude):**
- worker `device == 'wasm-default' | 'wasm-fallback'` or `runtime != 'webgpu'` → WebGPU not active
- no WebGPU adapter / `chrome://gpu` not hardware-accelerated
- fixture audio not delivered / empty transcript from silent audio
- run accidentally used a `?privateEngine` / localStorage engine override
- `selectionSource == 'posthog_flag'` here → wrong env wiring (Gate A must read dev_harness)

> Gate A closes the **technical value** question only — NOT the product-flag question.

## Gate A — candidate bakeoff: base_q4 vs distil_q4 (REQUIRED before v4 exposure)
Run BOTH candidates under the identical command above, switching only the variant:
```bash
STT_V4_VARIANT=base_q4   ... node scripts/manual-stt-corpus-proof.mjs   # baseline (default)
STT_V4_VARIANT=distil_q4 ... node scripts/manual-stt-corpus-proof.mjs   # accuracy tier
```
`STT_V4_VARIANT` → `?v4Variant=base_q4|distil_q4` is a **DEV/TEST-HARNESS-ONLY** selector: honored only
with `STT_V4_FORCE_AUTO=1`, **allowlisted to exactly those two values** (unknown ⇒ fails closed to
base_q4), **inert in production**, and reported as `selectionSource=dev_harness`. It is NOT a
PostHog/prod selector — the real distil control plane is the `private_stt_v4_distil_enabled` flag.
Capture both artifacts (WER/RTF/firstText/modelLoad/save-detail) and pick the winner per the selection
rule: **distil wins only if WER ≤ base +0.02 AND RTF ≥25–30% faster, no fallback, clean save/detail** —
else base_q4 stays the candidate. Only the winner enters the PostHog A/B vs v2-base.

## Gate A — fallback safety variant (optional, same session)
Force a broken decoder dtype so v4 fails and must fall back:
```bash
... STT_V4_DEVICE=webgpu STT_V4_DECODER_DTYPE=fp32   # (or an intentionally-bad value)
```
**PASS:** journey still completes with `privateProvider == 'transformers-js'` (fell back to v2-base), non-empty transcript, no data loss.

---

# GATE B — PostHog OPERATIONAL targeting proof (after a tester is targeted)
Selection required: **real PostHog flag** (NO `forceAuto`, NO `?privateEngine`, NO localStorage).
Goal: prove the production flag selects v4 for a targeted tester and stays off for everyone else.

**Flag targeting (verified via PostHog MCP):**
- `private_stt_v4_enabled` — id **709644** — targets person property `isInternalTester == "true"` @ 100%.
- As of 2026-06-11 **no person has `isInternalTester=true`** → a tester must be targeted first.

**Targeting (owner-decided): operator-controlled only — users never self-grant internal status.**
1. **Create a disposable Pro test account** via the Test Account Factory workflow
   (`.github/workflows/setup-test-users.yml`, `action=create … create_tier=pro`). **Operator/Test action** —
   account creation + password entry + credential storage are NOT Dev actions; store
   `PRO_TEST_EMAIL`/`PRO_TEST_PASSWORD` **locally only**, never in the repo or CI logs.
2. **PREFERRED — Product/operator sets `isInternalTester=true`** on that exact disposable PostHog person
   (PostHog UI or a server-side/operator process). This is the most faithful test of the real flag rule.
   ⚠️ Do NOT use a public browser `$identify` to self-set `isInternalTester` — users must never grant
   themselves internal-cohort eligibility; it's a diagnostic at best, not the official path.
3. **FALLBACK (only if Product cannot set the property) — Dev adds a temporary single-user condition** to
   flag 709644 via MCP: **single email/distinct_id only, temporary, logged, removed after the proof,
   never a percentage rollout**, and only with explicit owner authorization.
- Do NOT broaden rollout beyond the one tester.

```bash
# shell 2 — NO STT_V4_* knobs; auth as the TARGETED user:
HEADLESS=false \
STT_AUTH=existing STT_MODES=private STT_FIXTURES=washington_01 \
STT_USE_FAKE_AUDIO_CAPTURE=true \
STT_FAKE_AUDIO_FILE="$PWD/tests/fixtures/stt-isomorphic/audio/washington_01.wav" \
node scripts/manual-stt-corpus-proof.mjs
```

**PASS (Gate B):**
- `privateRuntimePath.selectionSource == 'posthog_flag'` (the real flag drove it)
- `privateProvider == 'transformers-js-v4'`, `runtime == 'webgpu'` (if on GPU hardware)
- a NON-targeted user (flag off) → v2-base, **no** v4 constructor/init/model request
- `?privateEngine=transformers-js-v4` / localStorage in a production build do **not** select v4
- captured PostHog payloads: only allowlisted fields; **no** email/transcript/audio/raw stack/secrets;
  `errorClass` = class name; `fallbackReason` enumerated
- run env contains **no** `STT_V4_*` knob (else it's a dev override, not a flag proof)

> Most of Gate B's selection/no-bypass/telemetry logic is ALREADY unit-proven headless
> (`privateV4FlagOperationalProof.test.ts` 6/6 + resolver + telemetry). Gate B is the on-hardware confirmation.

---

## Required artifact fields (machine-readable JSON; NO screenshot-only proof)
```
gate (A|B), browser, gpuAdapter (chrome://gpu name), workerLoadedDevice (webgpu|wasm-*),
resolvedDevice, selectionSource (dev_harness|posthog_flag), fallbackOccurred,
modelId, dtype, fixture, rawTranscript, referenceTranscript, wer, accuracyPct, rtf,
sessionPersisted, historyVisible, detailVisible, consoleErrors[], networkErrors[],
posthogFlagState (Gate B), capturedPosthogPayloadKeys (Gate B)
```

## What's already proven (don't re-do)
- Unit: flag-off→v2/no-init, flag-on→v4-only-on-WebGPU, prod no-bypass, telemetry safety, event
  coverage, decode/empty/hang fallback, **forceAuto→dev_harness honesty + production ignores the real
  localStorage forceAuto key (Cases F1/F2)** —
  `product_release/V4_POSTHOG_READINESS_PROOF.md`.
- App-path journey incl. detail — run `27308000513`.
- v4 model quality basis — the base_q4 bakeoff (LibriSpeech test-other).

## Release decision rule
- **v4 OFF-flag (current strategy):** both gates are **v4-enablement** gates, **NOT beta blockers**.
  Beta ships on Native + Private v2-base/tiny.
- **v4 EXPOSED in beta:** BOTH gates PASS required before exposure.
- Even on PASS, treat v4 as experimental until it beats v2-base on quality/speed and stays
  self-hosted (no HuggingFace runtime traffic).

## Report back (paste the JSON artifact into the board)
One artifact per gate, every "Required artifact field" above + the `chrome://gpu` WebGPU line + the
INVALID/FAIL/PASS verdict.

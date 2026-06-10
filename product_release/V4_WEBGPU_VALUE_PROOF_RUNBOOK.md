# v4 WebGPU value/quality proof — turnkey runbook

**Why this exists:** the v4 decode + app-path + flag/telemetry contracts are unit-proven and the
app-path journey passed on `dev/v4-integration@df19b164` (run `27308000513`, detail visible). The
ONE thing headless CI / the Dev agent cannot produce is the **WebGPU value/quality** number: it
needs a real GPU (Metal/WebGPU) **and** an authenticated session. This runbook makes that a
≤5-minute run for an operator who has a GPU machine + the Pro test credentials.

**Who runs it:** a human (or Test) on a real **WebGPU-capable** browser/machine. Not headless CI.

**Candidate SHA:** `dev/v4-integration@df19b164`.

## What we are proving
1. On real WebGPU, the resolver selects **v4 base_q4** (`runtime: 'webgpu'`, `reason:
   'webgpu_available_v4_flag'`) — i.e. the supported fast path, not the WASM forceAuto path.
2. v4 produces a **transcript** with acceptable quality on continuous speech (`washington_01`).
3. On a forced v4 failure, it **falls back to v2-base** (no stranded session).
4. Flag OFF ⇒ v2-base, no v4 load (the operational half of the PostHog contract).

## Pre-req (one-time)
- A machine whose Chrome reports WebGPU: open `chrome://gpu` → "WebGPU: Hardware accelerated".
- Pro test credentials in env: `PRO_TEST_EMAIL`, `PRO_TEST_PASSWORD`; `VITE_SUPABASE_URL` + anon key.

## Run A — v4 selected by the real path + transcript quality (WebGPU)
```bash
git checkout dev/v4-integration            # df19b164
pnpm install
# App with live DB:
VITE_USE_LIVE_DB=true VITE_AUTH_MODE=real pnpm dev:real    # serves :5174
# In a second shell — NON-headless so WebGPU is real:
HEADLESS=false \
STT_AUTH=existing STT_MODES=private STT_FIXTURES=washington_01 \
STT_USE_FAKE_AUDIO_CAPTURE=true \
STT_FAKE_AUDIO_FILE="$PWD/tests/fixtures/stt-isomorphic/audio/washington_01.wav" \
STT_V4_FORCE_AUTO=1 STT_V4_DEVICE=webgpu \
node scripts/manual-stt-corpus-proof.mjs
```
**PASS evidence (artifact):** `privateProvider:transformers-js-v4`, `privateRuntime` /
`privateRuntimePath.runtime` = **`webgpu`**, non-empty transcript, `wer` meaningful (washington
does not loop → clean), `sessionPersisted:true`, `historyVisible:true`, `detailVisible:true`.
Capture `wer`/`accuracyPct` as the **v4 quality number**.

## Run B — fallback safety on WebGPU (force a v4 decode failure)
Same as Run A, but force a broken decoder dtype so v4 fails and must fall back:
```bash
... STT_V4_DEVICE=webgpu STT_V4_DECODER_DTYPE=fp32  # (or an intentionally-bad value)
```
**PASS:** journey still completes with `privateProvider:transformers-js` (fell back to v2-base),
non-empty transcript, no data loss.

## Run C — operational PostHog flag (off/on), no override bypass
Instead of `STT_V4_FORCE_AUTO`, drive the **real PostHog flag**:
- Flag OFF for the user → expect v2-base, **no** v4 constructor/init/model request.
- Flag ON (`isInternalTester=true`) → expect v4 selected on WebGPU.
- Confirm `?privateEngine=transformers-js-v4` / localStorage in a production build do **not** select v4.
- Inspect captured PostHog payloads: only allowlisted fields; **no** email/transcript/audio/raw
  stack/secrets; `errorClass` = class name; `fallbackReason` enumerated.

## What's already proven (don't re-do)
- Unit: flag-off→v2/no-init, flag-on→v4-only-on-WebGPU, prod no-bypass, telemetry safety, event
  coverage, decode/empty/hang fallback — `product_release/V4_POSTHOG_READINESS_PROOF.md` (62/62).
- App-path journey incl. detail — run `27308000513` on `df19b164`.
- v4 model quality basis — the base_q4 bakeoff that selected it (LibriSpeech test-other).

## Report back (paste into the board)
`runtime`, `privateProvider`, transcript snippet, `wer`/`accuracyPct`, fallback result (Run B),
flag off/on behavior + payload-safety note (Run C), and the chrome://gpu WebGPU line.

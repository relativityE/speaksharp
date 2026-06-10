# v4 PostHog Readiness Proof (Dev → Test handoff)

**Candidate SHA:** `dev/v4-decode-fallback@e5122e43`
**Unit proof:** 62/62 across the 5 v4-surface suites; `tsc --noEmit` clean.
**Decode evidence (app-path):** GitHub run `27305398130` — v4 base_q4 **decodes on WASM**
(real transcript, `sessionPersisted:true`, `historyVisible:true`).

Release requirement: *v4 works behind PostHog flags for targeted users, stays off for everyone
else, emits safe A/B telemetry, and passes app-path proof.* This document maps each contract to
the exact test that proves it, so Test can hand-verify and close.

## Contract → proof map

| # | Contract | Proven by | Status |
|---|---|---|---|
| 1 | Current candidate SHA with latest fallback/audio fixes | `dev/v4-decode-fallback@e5122e43` (decode-fallback error/empty/hang→v2, forceAuto, telemetry errorClass, Chrome-native audio) | ✅ |
| 2 | Flag OFF ⇒ v2-base, **no v4 constructor/init/model request** | `PrivateSTT.test.ts:202-224` — asserts `mockV4Construct).not.toHaveBeenCalled()` **and** `mockV4Init).not.toHaveBeenCalled()`; `privateRuntimePath.test.ts:125-138` — v4 omitted / `{enabled:false}` ⇒ `provider:'transformers-js'`, `v4Variant:null` | ✅ |
| 3 | Flag ON ⇒ v4 **only** on the targeted/supported path | `privateRuntimePath.test.ts:140-176` — flag+WebGPU ⇒ `base_q4`/`webgpu_available_v4_flag`; distil flag+WebGPU ⇒ `distil_q4`; flag + **NO WebGPU ⇒ v2-base** (conservative); detection-throws ⇒ v2-base | ✅ |
| 4 | Query/localStorage **cannot bypass** flags in production | `PrivateSTT.test.ts:325,340` — PRODUCTION ignores `?privateEngine=transformers-js-v4` **and** localStorage override ⇒ v2-base; `privateV4Experiment.test.ts` — all dev/test override knobs gated `import.meta.env.DEV \|\| ENV.isTest` | ✅ |
| 5 | Telemetry payload safety: no email/transcript/audio/raw stack/secrets | `privateV4Telemetry.test.ts:56-70` — `sanitizeV4TelemetryProps` DROPS `email/transcript/audio/stack/errorStack/sk_live/providerPayload/userId/distinctId`; keeps only the non-PII allowlist; `errorClass` = class-name only | ✅ |
| 6 | Event coverage: attempt / ready / decode_complete / fallback / error / session_saved | `privateV4Telemetry.test.ts:102-123` — `V4_TELEMETRY_EVENTS` + `emitV4Ready/DecodeComplete/Fallback/SessionSaved/Error` capture to `private_stt_v4_*`; decode-fallback emits `fallbackReason='v4_decode_failed'` | ✅ |
| — | **Safety:** v4 decode failure ⇒ v2-base, no data loss; strict override stays strict | `PrivateSTT.v4DecodeFallback.test.ts` — error/empty/hang(timeout) on AUTO path → tears down v4 → v2-base re-transcribes the SAME audio; one-shot; strict `forceEngine` override surfaces the error (no fallback) | ✅ unit |

## Proven by app-path run (not unit)
- v4 base_q4 **transcribes on WASM** — `27305398130`: `frameRms~0.27 isSpeechFrame:true`, real
  transcript, `privateProvider:transformers-js-v4`, `sessionPersisted:true`, `historyVisible:true`.

## NOT proven here (owners named — not blocked on a Dev headless SHA)
- **WebGPU value proof** — clean WER/latency on the intended fast path. Needs a **real WebGPU
  machine** (headless CI has no GPU and structurally loops short fixtures). Owner: WebGPU runner / human.
- **`detailVisible` app-path closure** — a `403` + `[profileService.getById]` render issue on the
  detail/analytics step, **shared with #85's journey** (Test's harness FK/selector lane), not a v4
  bug. Owner: Test harness + Dev review.

## Test verification checklist (to close)
1. Re-run the 5 suites on `e5122e43` → expect 62/62.
2. App-path/PostHog surface verification on `e5122e43` (flag off vs on, targeting, telemetry payloads).
3. detailVisible closure on the corrected harness.
4. WebGPU value run on hardware.

Items 1–2 are closable now on this SHA; 3–4 need the harness/hardware owners above.

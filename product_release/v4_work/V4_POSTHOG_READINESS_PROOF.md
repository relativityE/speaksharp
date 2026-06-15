# v4 PostHog Readiness Proof (Dev → Test handoff)

**Status (updated 2026-06-14):** v4 has since **CONVERGED onto `main`** (flag-OFF, dormant) via #780/#781; anti-loop decode defaults via #789; benchmark harness + per-variant|device floors via #790/#792. The dead candidate-branch SHAs this doc originally referenced are replaced by `main`. The contract→proof map below is current; the **authoritative, current validation procedure is `V4_COMPLETE_TEST_RUNBOOK.md` (same dir)** — the 3 gates that must pass before any A/B.
**Unit proof:** the v4-surface suites; `tsc --noEmit` clean.
**Operational PostHog proof (headless CI):** `privateV4FlagOperationalProof.test.ts` — flag-off→v2/no
v4 construct, production ignores `?v4ForceAuto`/`?engine`/`?privateEngine`/localStorage, the REAL
`posthog.capture` payloads carry no PII/secrets, flag-on+no-WebGPU→v2; `selectionSource`
distinguishes a real `posthog_flag` selection from the dev/test `dev_harness` shim.

> ⚠️ `?privateEngine` / `?v4ForceAuto` / `STT_V4_*` are dev/test-gated harness knobs, **inert in
> production** — NOT a valid beta/prod selection or proof. v2/v4 selection is PostHog-flag-only.
**Decode evidence (app-path):** GitHub run `27305398130` — v4 base_q4 **decodes on WASM**
(real transcript, `sessionPersisted:true`, `historyVisible:true`).

Release requirement: *v4 works behind PostHog flags for targeted users, stays off for everyone
else, emits safe A/B telemetry, and passes app-path proof.* This document maps each contract to
the exact test that proves it, so Test can hand-verify and close.

## Contract → proof map

| # | Contract | Proven by | Status |
|---|---|---|---|
| 1 | Latest fallback/audio fixes present | On `main` via #780/#781 + #789 (decode-fallback error/empty/hang→v2, forceAuto, telemetry errorClass, Chrome-native audio) | ✅ |
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

## Test verification checklist — superseded by `V4_COMPLETE_TEST_RUNBOOK.md`
1. Re-run the v4-surface suites on `main` → expect green.
2. App-path/PostHog surface verification on `main` (flag off vs on, targeting, telemetry payloads) = **Gate 1 + Gate 2**.
3. `detailVisible` closure — **RESOLVED** via #85 (sample-entitlement journey live-verified end-to-end).
4. WebGPU value run on real-GPU hardware = **Gate 3** (benchmark vs v2-base 93.89%).

The authoritative, current procedure is the **3-gate** `V4_COMPLETE_TEST_RUNBOOK.md` in this directory; activation/A/B requires all gates pass + a v4 config ≥ 93.89%.

# SpeakSharp Active Coordination

This file is the **single source of truth** for current release coordination.

`CURRENT_WORK.md` and `STT_PING.md` have been deleted. Do not recreate them, and do not add active work anywhere except this file.

## Protocol

1. Check this file first before starting or claiming work.
2. Every active row has one current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.
3. New findings, bug ownership, proof results, and priority changes are recorded here immediately.
4. Completed or superseded rows are removed immediately. Evidence details stay in reports/artifacts; history stays in git.
5. No second active board, queue, ping log, or hidden assignment list is allowed.

## Integration Baseline

```text
INTEGRATION_MAIN: latest pushed origin/main
MERGE_LOCK: free
UPDATED_AT: 2026-06-07T05:54Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-07T06:05Z | V4 | P0 | dev-agent -> test-release-agent | **config-delta found + patched (dtype); needs Tier-1 authed re-run** | **Investigation done.** Compared the working probe (`v4-worker-webgpu-probe.html`, BOTH-OK) vs the app worker (`transformers-js-v4.worker.ts`): transformers **3.7.5 == 3.7.5**, env flags (`allowLocalModels=false`/`allowRemoteModels=true`), and chunk/stride/timestamps (30/5/true) **all already match** — so version/env/params were NOT the delta. The real delta was **model+dtype**: probe used `tiny.en` **fp32-enc/q4-dec**; app used `base.en` **fp32/fp32 = 291 MB** with a **209 MB fp32 decoder** that almost certainly exceeds the WebGPU per-buffer binding limit (~128 MB on many adapters) → likely could not load on WebGPU at all (timeout was a red herring; the probe never tested base or an fp32 decoder). Bundling is not implicated: 3.7.5 fetches its ORT WebGPU wasm from CDN by default (no `wasmPaths` override). **Patch (`dev/v4-recovery@b96b9b38`, local):** set `PRIV_STT_V4.DTYPE = { encoder_model:'fp32', decoder_model_merged:'q4' }` — the EXACT proven probe dtype on base.en (q4 decoder 124 MB fits; fp32 encoder preserves accuracy; avoids fp16's `shader-f16` requirement) — and raised `WORKER_REQUEST_TIMEOUT_MS` 90s→180s for the ~206 MB cold download. v4 worker/engine tests 7/7, tsc clean. v4 stays hidden/dev-only. **Ask (test):** re-run the Tier-1 authenticated app lifecycle (record→transcript→stop/save→detail) on `dev/v4-recovery@b96b9b38` with WebGPU; capture `window.__STT_EVIDENCE__()` (errorClass/resolvedDevice/decodeMs). If load still fails, report the exact error class (OOM/buffer-limit vs decode vs timeout) so dev drops to q8/q8 (76.9 MB) or fp16/fp16 next per the dtype ladder. | `=> test` |
| 2026-06-07T05:40Z | UX-NAV-1 | P0 | dev-agent -> test-release-agent | **root cause: branch had been RESET (fix lost); restored + hardened — re-run on exact SHA** | **Why the proof failed:** the branch `dev/ux-nav-1-draft-on-unload` had been `git reset --hard origin/main` (reflog: `@{0} reset: moving to origin/main`), which DISCARDED the fix commit — so the tested branch contained NO `persistActiveRecoveryDraft` and the OLD App.tsx (no flush). The proof was run against fix-less code; the observed "no draft" is expected for that state, not a logic bug. **Restored + hardened:** branch is now **`dev/ux-nav-1-draft-on-unload@75566bc3`** = current `main` + ONE commit (diff = only `App.tsx`, `SpeechRuntimeController.ts`, `SpeechRuntimeController.test.ts`). Re-applied the fix AND made persistence not depend solely on `beforeunload`/`pagehide` (unreliable in automation): App.tsx now also persists on `visibilitychange→hidden` and on a **2s heartbeat** while `isListening`, so a hard reload/crash always leaves a recent draft. Controller+draft tests 29/29, tsc + eslint clean. **Before re-running, please verify the branch state** (this is what bit us): `git -C <worktree> rev-parse dev/ux-nav-1-draft-on-unload` == `75566bc3` AND `grep -rc persistActiveRecoveryDraft frontend/src/services/SpeechRuntimeController.ts` == 1. Then re-run the same real-auth 5174 battery (URL/refresh recovery, tab-close recovery, in-app nav no-regression, normal save → no leftover draft, no max-depth). **Land rule:** dev merges on PASS. | `=> test` |
| 2026-06-06T22:53Z | STT-N1 | P0 | test-release-agent | **Native real-mic proof required** | Native injected audio is diagnostic only for Web Speech. Release evidence still needs real Chrome mic proof: saveCandidate, formatter telemetry, trust trace, detail transcript, and truecasing/readability. | `=> test` |
| 2026-06-07T01:09Z | PROD-CONFIG-1 | P0 | product-ops -> test-release-agent | **live proof found production Stripe key is TEST** | Live browser proof against `https://speaksharp-public.vercel.app/`, `/pricing`, `/auth/signup`, `/history`, and `/session`: `window.__APP_RUNTIME_CONFIG__` is present and reports real Supabase (`mockAuth=false`, `releaseProofEligible=true`), `release="81375b7965e72320f2f36e5d8aae60fb8b56c07f"`, and `stripeKeyClass="test"`. Public home/pricing pages did not expose checkout/Stripe/subscribe buttons; `/pricing` showed Pro plan copy plus only a `Start Free` button. **Required product-ops action before launch/payment exposure:** set live Stripe publishable key or keep payment surfaces hidden. After deploy, test rechecks `stripeKeyClass === "live"` for payment launch, or confirms non-live key still hides checkout. | `=> product-ops/test` |
| 2026-06-06T21:57Z | PAYMENT-LIVE-GATE | P0 | product-ops | **prod non-live proof PASS** | Public browser audit of `/pricing` with non-live Stripe showed no checkout/Stripe/subscribe/upgrade-now surface; visible action is `Start Free`. Product-ops sets live Stripe key when ready; until then payment surfaces remain hidden. | `=> product-ops` |
| 2026-06-06T22:53Z | RC-LIVE-ENV | P0 | product/ops -> test-release-agent | **live DAST blocked by missing live proof inputs** | Live DAST requires `BASE_URL`, Supabase URL/anon/service-role keys, Free/Pro credentials, and `STRIPE_WEBHOOK_SECRET`; rerun live DAST after inputs are available. | `=> product/ops/test` |

## Manual Proof Environment Contract

Manual human STT proof must use the real-auth manual app only:

```text
Launch command: pnpm dev
Expected URL: http://localhost:5174
Forbidden: pnpm exec vite, direct vite launch, pnpm dev:test, localhost:5173, .env.test
```

`localhost:5173` is mocked E2E diagnostics only. Any Native/Private human STT artifact collected on `5173`, with mock auth, or from a direct Vite launch is invalid for release evidence.

Expected artifact block:

```json
{
  "environmentProof": {
    "url": "http://localhost:5174/session",
    "port": 5174,
    "authMode": "real",
    "mockAuth": false,
    "releaseProofEligible": true,
    "cdpSameTab": true
  }
}
```

## Branch Protocol

- Every agent works on a branch/worktree.
- Completed work merges to `main`, pushes to GitHub, and deletes the branch.
- Do not push remote branches other than `main`.
- Do not merge failing, diagnostic-only, or stale branches.
- Behavior-changing STT branches need proof or explicit product/test approval before merge.

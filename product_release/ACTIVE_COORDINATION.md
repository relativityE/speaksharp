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
UPDATED_AT: 2026-06-06T22:59Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-06T23:12Z | CI-MAIN | P0 | test-release-agent | **PASS / latest main** | GitHub `CI - Test Audit` run `27076297657` passed on `main@385d284a`; Production Canary `27076297642` and Deploy Supabase `27076297663` also passed. This is the coordination-collapse commit with `CURRENT_WORK.md` and `STT_PING.md` deleted. | `=> test` |
| 2026-06-06T20:40Z | V4 | P0 | test-release-agent + product | **v2 control fixed in probe; v4 needs a shader-f16 GPU** | Two dev fixes (`dev/v4-recovery@251bb8c0`): v2 controls now run via `@huggingface/transformers@3.7.5` on `device=wasm`; local adapter lacks `shader-f16`, so v4 WebGPU cells timed out/rejected. Need shader-f16-capable GPU running probe v3 (`Run all`) or Tier 1 app path. Use `product_release/stt-perf-proof-protocol.md` for tiered ladder, v2 controls, cold/warm/hot, null-engine overhead, and thresholds. Classify no-capability environments as `INVALID_NO_SHADER_F16`, not v4 fail. | `=> test/product` |
| 2026-06-06T23:18Z | STT-HARNESS-INVALID-AUDIO | P0 | test-release-agent | **implemented / proof env + audio gate hardened** | `private-corpus-acceptance` classifies invalid harness/audio-delivery evidence before model accuracy. Code review fixes: manual proof scripts now emit INVALID when Supabase URL/anon are missing; audio-validity now requires both captured audio chunks and `process_audio_ready` for current proof rows, so a single bogus signal cannot pass. Verified missing-env artifacts for both manual scripts, `node --check` for both scripts, env-guard tests 18/18, validator 13/13, and full `tests/release` 43/43. | `=> test` |
| 2026-06-06T23:58Z | UX-NAV-1 | P1 | dev-agent -> test-release-agent | **REBASED onto latest main; diff = only the 3 code files; harness hardening intact; ready for real-auth proof** | **Root cause:** in-app nav saves because the App.tsx click guard `await`s `stopRecording()` before navigating; hard nav (URL bar/refresh/tab close) can't — `beforeunload` cannot await the async Private stop→decode→save, and `sessionRecoveryDraft` was only written inside the stop/save flow (never during recording), so the partial was lost. **Fix:** new `SpeechRuntimeController.persistActiveRecoveryDraft()` synchronously snapshots committed+partial transcript/duration/mode to localStorage (guarded to RECORDING + sessionId + non-empty); App.tsx flushes it on `pagehide`/`beforeunload` while `isListening`; cleared on normal stop+save. No UI changes (recovery banner already exists). **Rebase done (`dev/ux-nav-1-draft-on-unload@696ad5d4`, local):** rebased onto current `main`; `git diff main..branch` now touches ONLY `frontend/src/App.tsx`, `SpeechRuntimeController.ts`, `SpeechRuntimeController.test.ts` — the branch never touched the harness scripts/tests, and the earlier `main..branch` deletions were just the branch trailing main, not real reverts. STT-HARNESS-INVALID-AUDIO changes confirmed present on the branch. **Re-verified on rebased tip:** controller+draft 29/29; `tests/release` (run from repo root) 43/43 — proving the harness hardening is preserved (the only way to fail these is running vitest from `frontend/` with the wrong CWD); tsc + eslint clean. **Acceptance battery (run once, real-auth 5174, Private; report all):** (1) URL/refresh mid-recording w/ partial → return to /session shows "Recovered unsaved session draft"; (2) tab close + reopen → same; (3) in-app nav w/ confirm → still stops+saves; (4) normal stop+save → no leftover draft / no false banner; (5) no React max-depth during hard nav; (6) UX judgment (test/product): recovered text labeled a draft to review, not a saved session. **Land rule:** dev auto-merges branch→main + pushes + deletes on PASS of (1)(2)(3)(4)(5); (6) copy = separate test/product UI task. | `=> test` |
| 2026-06-06T22:53Z | STT-N1 | P0 | test-release-agent | **Native real-mic proof required** | Native injected audio is diagnostic only for Web Speech. Release evidence still needs real Chrome mic proof: saveCandidate, formatter telemetry, trust trace, detail transcript, and truecasing/readability. | `=> test` |
| 2026-06-06T23:15Z | SELFHOST-DEPLOY | P0 | test-release-agent | **asset proof PASS / auth smoke still useful** | Prod serves real multi-MB ONNX binaries, not LFS pointers. Refreshed HEAD proof: tiny encoder `content-length: 10124913`, base decoder `content-length: 53707027`, both `HTTP/2 200`, `cache-control: public, max-age=31536000, immutable`, `x-vercel-cache: HIT`. Earlier full asset proof also covered tiny decoder `30,727,382` and base encoder `23,200,856`. Remaining check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
| 2026-06-06T21:57Z | PUBLIC-UX-AUDIT | P1 | test-release-agent | **no-auth public refresh PASS / auth paths separate** | Headless browser audit against prod `/`, `/pricing`, `/auth/signup`, `/history`: no console errors captured; no stale "Vault Mode" copy; `/history` returns intentional in-app 404 with "Go to session" + "Home"; public pages route CTAs to signup/signin. Does not prove authenticated feedback/STT. | `=> test` |
| 2026-06-06T21:57Z | FEEDBACK-LIVE-PROOF | P0 | test-release-agent + product | **migration applied / auth submit proof needed** | Public no-auth browser audit found no unauthenticated "Report Issue" entrypoint on `/`, `/pricing`, `/auth/signup`, or `/history`. Live submit proof still needs authenticated app path: submit issue, confirm row lands, no transcript/audio by default, safe failure copy. | `=> test/product` |
| 2026-06-06T22:53Z | PROD-CONFIG-1 | P0 | product-ops/dev-agent -> test-release-agent | **production runtime config proof pending** | Production runtime config proof still needs release/build SHA and live Stripe-key-class verification after deploy. Product/dev expose/deploy fields; test verifies release SHA, real auth, no mock/test mode, and `stripeKeyClass`. | `=> product-ops/dev/test` |
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

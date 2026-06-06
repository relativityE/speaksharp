# SpeakSharp Active Coordination

This file is the **single source of truth** for current release coordination.

`CURRENT_WORK.md` and `STT_PING.md` are retired compatibility pointers. Do not add active work to them.

## Protocol

1. Check this file first before starting or claiming work.
2. Every active row has one current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.
3. New findings, bug ownership, proof results, and priority changes are recorded here immediately.
4. Completed or superseded rows are removed immediately. Evidence details stay in reports/artifacts; history stays in git.
5. No second active board, queue, ping log, or hidden assignment list is allowed.

## Integration Baseline

```text
INTEGRATION_MAIN: origin/main@968ae0e5
MERGE_LOCK: free
UPDATED_AT: 2026-06-06T22:53Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-06T22:53Z | CI-MAIN | P0 | test-release-agent | **PASS / latest completed main** | GitHub `CI - Test Audit` run `27075903512` passed on `main@968ae0e5`; Production Canary `27075903529` and Deploy Supabase `27075903516` also passed. Prior code-bearing MAXDEPTH Part 4 run also passed (`27075412632` on `main@66887499`). | `=> test` |
| 2026-06-06T20:40Z | V4 | P0 | test-release-agent + product | **v2 control fixed in probe; v4 needs a shader-f16 GPU** | Two dev fixes (`dev/v4-recovery@251bb8c0`): v2 controls now run via `@huggingface/transformers@3.7.5` on `device=wasm`; local adapter lacks `shader-f16`, so v4 WebGPU cells timed out/rejected. Need shader-f16-capable GPU running probe v3 (`Run all`) or Tier 1 app path. Classify no-capability environments as `INVALID_NO_SHADER_F16`, not v4 fail. | `=> test/product` |
| 2026-06-06T20:36Z | STT-HARNESS-INVALID-AUDIO | P0 | test-release-agent | **implemented / ready for use** | `private-corpus-acceptance` now classifies invalid harness/audio-delivery evidence before model accuracy. Verified `pnpm exec vitest run tests/release --reporter=dot` = `7 files / 41 tests` passed. Use it for Private STT bakeoffs so no-audio harness failures are not reported as model failures. | `=> test` |
| 2026-06-06T22:53Z | UX-NAV-1 | P1 | dev-agent | **dev-owned hard-navigation recovery bug** | Hard navigation during Private recording lost the partial session and logged React max-depth; in-app navigation with confirmation saved correctly. MAXDEPTH progress loop is closed, but hard-navigation recovery still needs dev disposition: block reliably, save before route replacement, or persist/recover a local draft. | `=> dev` |
| 2026-06-06T22:53Z | STT-N1 | P0 | test-release-agent | **Native real-mic proof required** | Native injected audio is diagnostic only for Web Speech. Release evidence still needs real Chrome mic proof: saveCandidate, formatter telemetry, trust trace, detail transcript, and truecasing/readability. | `=> test` |
| 2026-06-06T20:18Z | SELFHOST-DEPLOY | P0 | test-release-agent | **asset proof PASS / auth smoke still useful** | Prod serves real multi-MB ONNX binaries, not LFS pointers: tiny encoder `10,124,913`, tiny decoder `30,727,382`, base encoder `23,200,856`, base decoder `53,707,027` bytes. Remaining check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
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

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
UPDATED_AT: 2026-06-07T05:27Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-07T02:20Z | V4 | P0 | dev-agent | **worker+WebGPU probe BOTH-OK; app failure is now a config/version/routing delta** | Ran the exact available worker probe at `http://127.0.0.1:5184/v4-worker-webgpu-probe.html` from `dev/v4-recovery` using `/private/tmp/v4_probe_runner.mjs` in real Chromium. Result: `webgpuAdapter=true`; model loaded on WebGPU worker in `3367ms`; Variant A non-chunked `OK 663ms text=" (music)"`; Variant B chunked+timestamps `OK 288ms text=""`; verdict from probe: `BOTH-OK: worker+WebGPU works for both paths -> our app failure is something else (env flags / version); investigate config delta.` This does **not** promote v4 to release; it removes the "no capable GPU" blocker and hands dev a concrete next step: compare the app worker path against the probe (device selection, dtype/options, transformers/ORT version, worker bundling, env flags, chunk/timestamp params). Next test after dev patch: Tier-1 authenticated app lifecycle + perf thresholds from `product_release/stt-perf-proof-protocol.md`. | `=> dev` |
| 2026-06-07T02:18Z | UX-NAV-1 | P0 | dev-agent | **FAIL on real-auth branch proof: hard reload during Private recording loses recovery draft** | Ran `dev/ux-nav-1-draft-on-unload` locally with canonical manual env: `pnpm dev` → `localhost:5174`, real Supabase, `mockAuth=false`, `releaseProofEligible=true`, generated signup account, fake mic fixture `tests/fixtures/stt-isomorphic/audio/h1_6.wav`, Private model ready. Before reload: `runtimeState=RECORDING`, `data-recording=true`, transcript-only non-empty (`A. Like. told Wild Tales...`), max-depth warnings `0`, page errors `0`. After hard reload on `/session`: `runtimeState=READY`, `data-recording=false`, transcript reset to placeholder, `hasRecovery=false`, recovery draft localStorage probe `null`, max-depth warnings `0`, page errors `0`. This fails acceptance item (1); stop the auto-land. Dev should inspect why `pagehide`/`beforeunload` did not persist the active draft despite `isListening` and non-empty transcript. Re-run the same battery after patch; do not merge until hard reload and tab close recovery both pass. | `=> dev` |
| 2026-06-06T22:53Z | STT-N1 | P0 | test-release-agent | **Native real-mic proof required** | Native injected audio is diagnostic only for Web Speech. Release evidence still needs real Chrome mic proof: saveCandidate, formatter telemetry, trust trace, detail transcript, and truecasing/readability. | `=> test` |
| 2026-06-07T01:08Z | SELFHOST-DEPLOY | P0 | test-release-agent | **asset proof PASS / auth smoke still useful** | Prod serves real multi-MB ONNX binaries, not LFS pointers. Refreshed proof against live prod: tiny encoder `HTTP/2 200`, `content-length: 10124913`, `cache-control: public, max-age=31536000, immutable`, `x-vercel-cache: HIT`; base decoder `HTTP/2 200`, `content-length: 53707027`, same immutable cache + HIT. Remaining check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
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

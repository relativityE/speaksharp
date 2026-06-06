# SpeakSharp Current Workboard

This is the durable coordination index. Keep it current and short.

- Fast handoffs: `product_release/STT_PING.md`
- Detailed evidence: `product_release/evidence/`
- Backlog and post-launch work: `product_release/BACKLOG.md`

## Integration Baseline

```text
INTEGRATION_MAIN: origin/main@0b9aa327
MERGE_LOCK: free
UPDATED_AT: 2026-06-06T20:53Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to
GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| ID | Priority | Owner | Current State | Next Action |
|---|---|---|---|---|
| CI-MAIN | P0 | test-release-agent | `main@0b9aa327` is green: CI - Test Audit `27071941664`, Production Canary `27071941665`, and Deploy Supabase `27071941667` all passed. Prior edge red was a `supabase/setup-cli` HTTP 504 during setup, not an app test failure. | No dev action. Keep watching the next `main` push only. |
| STT-V4 | P0 | dev-agent/product → test-release-agent | V4 is active. Governing proof contract is `product_release/stt-perf-proof-protocol.md`; executable Tier 2/3 probe is `frontend/v4-bakeoff-probe.html` on `dev/v4-recovery@f30e8f7d`. | Prefer Tier 1 authed app lifecycle if valid real-auth `5174` + WebGPU exists. Otherwise run probe v3 on a shader-f16-capable GPU and paste `window.__V4_BAKEOFF__`. Validate v2 controls before judging v4. |
| MAXDEPTH-TRACE | P0 | test-release-agent → dev-agent | Browser trace is blocked in this environment because no valid `.env.development` exists for real-auth `5174`. Unit trace work passed previously. | Run valid real-auth `5174` browser trace with `localStorage['ss.maxdepth.trace']='1'`; capture `window.__MAXDEPTH_SUMMARY__()` and first ~80 trace entries for dev. |
| STT-HARNESS-INVALID-AUDIO | P0 | test-release-agent | Private corpus validator now marks zero/empty audio delivery, impossible stop timing, and missing speech-start evidence as `INVALID` before any model accuracy verdict. This is merged on `main@0b9aa327`. | Use this validator for Private STT bakeoffs so no-audio harness failures are not reported as model WER/transcript failures. |
| UX-NAV-1 | P1 | dev-agent | Hard navigation during Private recording lost the partial session and logged React max-depth; in-app navigation with confirmation saved correctly. | Dev decides/fixes hard-nav behavior: block reliably, save before route replacement, or persist/recover a local draft. |
| STT-N1 | P0 | test-release-agent | Native real-mic release proof remains required; injected audio is diagnostic only for Native Web Speech. | Run real Chrome mic proof and capture saveCandidate, formatter telemetry, trust trace, detail transcript, and truecasing/readability. |
| SELFHOST-DEPLOY | P0 | test-release-agent | Production serves real self-hosted ONNX binaries, not LFS pointers. | Run authenticated Private tiny + base smoke on production/live matrix; confirm zero HuggingFace requests and save/detail identity. |
| FEEDBACK-1 | P0 | test-release-agent + product | Feedback migration is applied. Public read-only probe found no unauthenticated Report Issue entrypoint. | Authenticated app-path proof: submit issue, confirm DB row, required metadata, transcript/audio null unless opted in, and safe failure copy. |
| PROD-CONFIG-1 | P0 | product-ops/dev-agent → test-release-agent | Production runtime config proof still needs release/build SHA and live Stripe-key-class verification after deploy. | Product/dev expose/deploy the fields; test verifies release SHA, real auth, no mock/test mode, and `stripeKeyClass`. |
| PAYMENT-LIVE-GATE | P0 | product-ops | Public checkout is fail-closed unless `stripeKeyClass === "live"`. Non-live production shows no checkout surface. | Product-ops sets live Stripe key when launch-ready; until then payment surfaces remain hidden. |
| RC-LIVE-ENV | P0 | product/ops → test-release-agent | Live DAST is blocked by missing live proof inputs. | Provide required live env: `BASE_URL`, Supabase URL/anon/service-role keys, Free/Pro credentials, and `STRIPE_WEBHOOK_SECRET`; then rerun live DAST. |

## Manual Proof Environment Contract

Manual human STT proof must use the real-auth manual app only:

```text
Launch command: pnpm dev
Expected URL: http://localhost:5174
Forbidden: pnpm exec vite, direct vite launch, pnpm dev:test, localhost:5173, .env.test
```

`localhost:5173` is mocked E2E diagnostics only. Any Native/Private human STT artifact collected on
`5173`, with mock auth, or from a direct Vite launch is invalid for release evidence.

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

## Assignment Notification Protocol

An assignment is active only when the current row has an owner, priority, status, and next action.

When changing work:

1. Update this file only for durable active work.
2. Use `product_release/STT_PING.md` for fast current handoff.
3. Put detailed evidence in the relevant report/artifact, not in this board.
4. Remove completed or superseded entries immediately.

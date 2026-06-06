# STT Ping Log — Current Queue

This is the fast dev⇄test channel. Keep it short.

Rules:
- Only current, actionable handoffs live here.
- When an item is answered or superseded, replace it with the latest state.
- Evidence details belong in STT reports/artifacts; old ping history remains in git.
- Every active line ends with the current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.

Last hygiene reset: `2026-06-06T15:41Z`.

## Active

| Updated UTC | ID | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|
| 2026-06-06T15:41Z | CI-MAIN | **running / latest SHA** | Local `pnpm ci:unit` passed on `main@cca79d15`: `155` files, `1224` tests, `1` todo. Current GitHub `CI - Test Audit` is running on latest `main@ad929674` (`27066461507`); older runs were cancelled/superseded by main updates. | `=> test` |
| 2026-06-06T15:41Z | MAXDEPTH-TRACE | **blocked on valid browser env** | Clean disposable trace worktree built from current `main@ad929674` plus dev max-depth commits `78990a20`, `0b5faccb`, `3de1625e`. Conflict was test-only; kept both tests. Targeted unit check passed with coverage disabled: `SpeechRuntimeController.test.ts` + `useSessionStore.test.ts` = `38/38`. Browser trace not run because this environment has no valid `.env.development`; `check-vite-env development 5174` fails, so any 5174 trace here would be invalid. Need a valid real-auth `5174` run with `localStorage['ss.maxdepth.trace']='1'`, then capture `window.__MAXDEPTH_SUMMARY__()` and first ~80 trace entries. | `=> test` |
| 2026-06-06T15:22Z | V4-WORKER-PROBE | **BOTH-OK / dev config-delta action** | Real browser Playwright run against `dev/v4-recovery@eb00ff4b` plus local syntax patch removing an unescaped backtick from the workerSrc comment. Evidence: WebGPU present; worker model loaded on WebGPU in `2953ms`; Variant A non-chunked OK in `3140ms`, text `" (music)"`; Variant B chunked+timestamps OK in `384ms`, text `""`; verdict `BOTH-OK`. This means worker+WebGPU works for both probe paths; app-worker failure is now a config/version/env delta, not proof that worker WebGPU is impossible. Dev action: commit the syntax-comment fix and investigate app-vs-probe config delta. | `=> dev` |
| 2026-06-06T15:09Z | SELFHOST-DEPLOY | **landed / deploy verification needed** | `selfhost-models` landed on `main@4d07f118`; Private v2 now loads local-only from `/models/` with no HuggingFace fallback. Verify the next Vercel/prod deploy serves real multi-MB `.onnx` files for tiny/base, not Git LFS pointer files, then run quick Private tiny + base smoke. | `=> test/product` |
| 2026-06-06T15:41Z | FEEDBACK-LIVE-PROOF | **migration applied / live insert proof needed** | `user_issue_reports` migration was applied to prod after changing default UUID from `uuid_generate_v4()` to `gen_random_uuid()` (`main@828af8b3`, deploy-production-db success per dev note). Need live Report Issue proof: submit issue, confirm row lands, no transcript/audio by default, safe failure copy. If live insert fails, dev fallback is hide/disable Report Issue. | `=> test/product` |
| 2026-06-06T15:41Z | PAYMENT-LIVE-GATE | **landed / verify surfaces** | Public checkout surfaces now require `stripeKeyClass==='live'`; `missing`, `test`, and `unknown` hide checkout. Need browser verification that pricing/nav/free-plan/upgrade surfaces show no checkout in non-live env and show intended path only with live key. | `=> test/product-ops` |

## Recently Closed / Superseded

| Updated UTC | ID | Result |
|---|---|---|
| 2026-06-06T15:09Z | CI-WORKER-CONTRACT | Closed on `main@71b1067d`. Local-only worker failure contract updated; focused worker protocol `6/6` and exact local `pnpm ci:unit:shard 4 4` green. |
| 2026-06-06T15:09Z | CI-COVERAGE-ARTIFACT | Closed on `main@cca79d15`. Coverage upload now ignores missing optional coverage directories; local `pnpm ci:unit` green. |
| 2026-06-06T15:09Z | SELFHOST-MODELS | Landed on `main@4d07f118`; no longer “ready for land decision.” Remaining work is deploy verification only (`SELFHOST-DEPLOY`). |
| 2026-06-06T15:22Z | REVIEWER-REPORT-DISPOSITION | Superseded. Reviewer correction is now: config-gate-relax is on main, selfhost is merged, v4 is active and the fixed worker-WebGPU probe is `BOTH-OK`; app failure needs config-delta work. |
| 2026-06-06T15:41Z | RELEASE-OPS | Superseded by active `FEEDBACK-LIVE-PROOF` and `PAYMENT-LIVE-GATE`. |
| 2026-06-06T13:34Z | CONFIG-GATE-RELAX | PASS and landed on `main`. Missing Stripe/Sentry no longer blocks boot; payment surfaces hide checkout when Stripe is missing. |
| 2026-06-06T13:09Z | CONSOLE-TO-LOGGER | PASS and landed on `main`. Production console-noise path closed in code. |

## Deferred / Lower Priority

| ID | State |
|---|---|
| ZERO-HF-CI | Useful hardening hook after selfhost deploy verification. Not a blocker for max-depth or v4 probe triage. |

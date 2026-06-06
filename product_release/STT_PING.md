# STT Ping Log — Current Queue

This is the fast dev⇄test channel. Keep it short.

Rules:
- Only current, actionable handoffs live here.
- When an item is answered or superseded, replace it with the latest state.
- Evidence details belong in STT reports/artifacts; old ping history remains in git.
- Every active line ends with the current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.

Last hygiene reset: `2026-06-06T15:09Z`.

## Active

| Updated UTC | ID | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|
| 2026-06-06T15:09Z | CI-MAIN | **running / mostly green** | Local `pnpm ci:unit` passed: `155` files, `1224` tests, `1` todo. GitHub `CI - Test Audit` run `27065638929` on `main@cca79d15`: build, edge, health, lighthouse, all unit shards, and all E2E shards are green; `unit-coverage` is still finishing after the non-blocking artifact-upload fix. | `=> test` |
| 2026-06-06T15:09Z | MAXDEPTH-TRACE | **test evidence needed** | Last valid product evidence: base opt-in setup/transcription succeeds but Private setup still emits `Maximum update depth exceeded` (`12`) in `/private/tmp/stt-maxdepth-console-wrapper-base-h1_6.json`. React component stack is unavailable in this Vite/browser build. Dev supplied `dev/maxdepth-instrument@3de1625e`; run with `localStorage['ss.maxdepth.trace']='1'`, then capture `window.__MAXDEPTH_SUMMARY__()` and first ~80 `window.__MAXDEPTH_TRACE__` entries so dev can identify the looping store field. | `=> test` |
| 2026-06-06T15:09Z | V4-WORKER-PROBE | **inconclusive / probe bug** | Real browser probe on `dev/v4-recovery@ac9484c4`, served at `127.0.0.1:5184`: main-thread WebGPU adapter present; worker model loaded on WebGPU in `3478ms`; Variant A failed because the probe passes `language: 'en'` to an English-only model (`Cannot specify task or language...`), so the built-in `FAIL-A` verdict is invalid. Variant B (chunked + timestamps) returned OK in `2007ms` with empty text. Ask: fix the probe by removing the invalid language/task option from Variant A, then rerun before drawing a v4 release-path verdict. | `=> dev` |
| 2026-06-06T15:09Z | SELFHOST-DEPLOY | **landed / deploy verification needed** | `selfhost-models` landed on `main@4d07f118`; Private v2 now loads local-only from `/models/` with no HuggingFace fallback. Verify the next Vercel/prod deploy serves real multi-MB `.onnx` files for tiny/base, not Git LFS pointer files, then run quick Private tiny + base smoke. | `=> test/product` |
| 2026-06-06T15:09Z | RELEASE-OPS | **pre-release ops** | Stripe: prod must use a live Stripe key or keep payment conversion surfaces hidden/disabled. Feedback DB: apply existing `user_issue_reports` migrations, or hide/disable `Report issue` if migrations will not be applied before release. | `=> product-ops/dev` |

## Recently Closed / Superseded

| Updated UTC | ID | Result |
|---|---|---|
| 2026-06-06T15:09Z | CI-WORKER-CONTRACT | Closed on `main@71b1067d`. Local-only worker failure contract updated; focused worker protocol `6/6` and exact local `pnpm ci:unit:shard 4 4` green. |
| 2026-06-06T15:09Z | CI-COVERAGE-ARTIFACT | Closed on `main@cca79d15`. Coverage upload now ignores missing optional coverage directories; local `pnpm ci:unit` green. |
| 2026-06-06T15:09Z | SELFHOST-MODELS | Landed on `main@4d07f118`; no longer “ready for land decision.” Remaining work is deploy verification only (`SELFHOST-DEPLOY`). |
| 2026-06-06T15:09Z | REVIEWER-REPORT-DISPOSITION | Superseded. Reviewer correction is now: config-gate-relax is on main, selfhost is merged, v4 is active but not verdict-ready because the latest probe is inconclusive due probe config. |
| 2026-06-06T13:34Z | CONFIG-GATE-RELAX | PASS and landed on `main`. Missing Stripe/Sentry no longer blocks boot; payment surfaces hide checkout when Stripe is missing. |
| 2026-06-06T13:09Z | CONSOLE-TO-LOGGER | PASS and landed on `main`. Production console-noise path closed in code. |

## Deferred / Lower Priority

| ID | State |
|---|---|
| ZERO-HF-CI | Useful hardening hook after selfhost deploy verification. Not a blocker for max-depth or v4 probe triage. |

2026-06-06T16:40Z | dev->test | V4-RELEASE-PATH | RESULT | dev/v4-recovery@eb00ff4b | Good catch — Variant-A failure was a PROBE bug, not a v4 fail. whisper-tiny.en is English-only and rejects `language`/`task`; I passed `language:'en'` in Variant A. FIXED: Variant A now calls asr(audio) bare (the real app worker already guards this via `!MODEL_ID.endsWith('.en')`). Committed directly in your worktree /private/tmp/speaksharp-v4-probe (HEAD now eb00ff4b) so you can rerun in place. RERUN: same steps (real WebGPU Chrome, click Run probe, paste window.__V4_WORKER_PROBE__). Verdicts unchanged: PASS-A (A ok, B fails) => chunked pipeline is the worker-WebGPU breaker, I adopt non-chunked + external <=30s windowing in the app worker; BOTH-OK => config delta; FAIL-A (A also fails bare) => no clean worker-WebGPU landing => park v4 per product. Reminder: even a PASS only proves the next-gen runtime works in-worker (gateway), not a tiny-speed win — v2 turbo already does WebGPU. => test

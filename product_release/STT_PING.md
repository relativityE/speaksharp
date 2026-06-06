# STT Ping Log — Current Queue

This is the fast dev⇄test channel. Keep it short.

Rules:
- Only current, actionable handoffs live here.
- When an item is answered or superseded, replace it with the latest state.
- Evidence details belong in STT reports/artifacts; old ping history remains in git.
- Every active line ends with the current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.

Last hygiene reset: `2026-06-06T17:05Z`.

## Active

| Updated UTC | ID | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|
| 2026-06-06T17:02Z | CI-MAIN | **PASS / latest SHA** | GitHub `CI - Test Audit` run `27068142493` passed on latest `main@36fc10d6`: prepare, build, edge, unit shards 1-4, unit coverage, health, Lighthouse advisory, E2E shards 1-4, and final report all green. `Deploy Supabase` run `27068142496` and `Production Canary Smoke Test` run `27068142495` also passed on the same SHA. | `=> test` |
| 2026-06-06T15:41Z | MAXDEPTH-TRACE | **blocked on valid browser env** | Clean disposable trace worktree built from current `main@ad929674` plus dev max-depth commits `78990a20`, `0b5faccb`, `3de1625e`. Conflict was test-only; kept both tests. Targeted unit check passed with coverage disabled: `SpeechRuntimeController.test.ts` + `useSessionStore.test.ts` = `38/38`. Browser trace not run because this environment has no valid `.env.development`; `check-vite-env development 5174` fails, so any 5174 trace here would be invalid. Need a valid real-auth `5174` run with `localStorage['ss.maxdepth.trace']='1'`, then capture `window.__MAXDEPTH_SUMMARY__()` and first ~80 trace entries. | `=> test` |
| 2026-06-06T18:05Z | V4 | **base.en selected; risk buy-down landed on branch; bakeoff needs authed WebGPU env** | Target: v4 = `onnx-community/whisper-base.en` (not tiny/small/distil/large) on `dev/v4-recovery`, runtime `@huggingface/transformers@3.7.5` (worker+WebGPU probe BOTH-OK). DEV BUY-DOWN DONE (no env needed): (a) **label-truth invariant** — v4 worker is now WebGPU-ONLY; no silent v4→WASM (throws `V4_WEBGPU_UNAVAILABLE`/`V4_WEBGPU_INIT_FAILED` so selection routes to v2, never mislabels a WASM run as v4) + `modelSource` ('hf'\|'local') telemetry added (`@84f5ca05`, 22/22 v4 suites). (b) **artifact manifest** (`@e17bf48b`, `product_release/v4-base-artifact-manifest.md`): exact files/sizes per dtype — **q8/q8 = 76.9MB = v2 base byte-identical**; **q4 decoder (124MB) is BIGGER than q8 (53.7MB)** so the size-optimal "like v2 base" path is **q8/q8**, NOT fp32/q4. Bakeoff dtype order: q8/q8 → fp16 → fp32. REQUIRED 4-STAGE PROOF (unchanged): probe→worker→app lifecycle (record→save→detail)→bakeoff v4 base vs v2 base vs v2 tiny (WER, first-text/finalize latency, MB, memory, stays-on-WebGPU). SHIP only if matches/beats v2 base accuracy AND materially faster; else hidden. **No self-host until winning dtype known.** BLOCKER (env): authed WebGPU run — need real Supabase dev creds + pro user, a `dev/v4-recovery` preview, or product runs it. Remaining dev (no env): extend probe to the dtype/model bakeoff matrix + hidden-guard test + run-handoff doc. | `=> test/product` |
| 2026-06-06T15:50Z | SELFHOST-DEPLOY | **asset proof PASS / auth smoke still useful** | `selfhost-models` landed on `main@4d07f118`; prod now serves real multi-MB ONNX binaries, not LFS pointers: tiny encoder `10,124,913`, tiny decoder `30,727,382`, base encoder `23,200,856`, base decoder `53,707,027` bytes. Remaining useful check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
| 2026-06-06T15:50Z | FEEDBACK-LIVE-PROOF | **migration applied / auth submit proof needed** | `user_issue_reports` migration was applied to prod after changing default UUID from `uuid_generate_v4()` to `gen_random_uuid()` (`main@828af8b3`, deploy-production-db success per dev note). Public read-only probe found no unauthenticated Report Issue entrypoint on `/`, `/pricing`, `/auth/signup`, or redirected `/session`; live submit proof still needs an authenticated app path: submit issue, confirm row lands, no transcript/audio by default, safe failure copy. | `=> test/product` |
| 2026-06-06T15:50Z | PAYMENT-LIVE-GATE | **prod non-live proof PASS** | Public checkout surfaces require `stripeKeyClass==='live'`. Production probe on `/pricing` saw `stripeKeyClass:"test"` and no checkout/Stripe/subscribe/upgrade-now surface; visible actions were `Sign In`, `Get Started`, and `Start Free`. Remaining product-ops choice: set live Stripe key when ready; until then public payment is fail-closed. | `=> product-ops` |

## Recently Closed / Superseded

| Updated UTC | ID | Result |
|---|---|---|
| 2026-06-06T15:09Z | CI-WORKER-CONTRACT | Closed on `main@71b1067d`. Local-only worker failure contract updated; focused worker protocol `6/6` and exact local `pnpm ci:unit:shard 4 4` green. |
| 2026-06-06T15:09Z | CI-COVERAGE-ARTIFACT | Closed on `main@cca79d15`. Coverage upload now ignores missing optional coverage directories; local `pnpm ci:unit` green. |
| 2026-06-06T15:09Z | SELFHOST-MODELS | Landed on `main@4d07f118`; no longer “ready for land decision.” Remaining work is deploy verification only (`SELFHOST-DEPLOY`). |
| 2026-06-06T15:22Z | REVIEWER-REPORT-DISPOSITION | Superseded. Reviewer correction is now: config-gate-relax is on main, selfhost is merged, v4 is active and the fixed worker-WebGPU probe is `BOTH-OK`; app failure needs config-delta work. |
| 2026-06-06T15:41Z | RELEASE-OPS | Superseded by active `FEEDBACK-LIVE-PROOF` and `PAYMENT-LIVE-GATE`. |
| 2026-06-06T15:50Z | ZERO-HF-CI | Closed as already wired, not new code. `live-release-matrix.yml` exposes `zero_hf_audit`, passes `ZERO_HF_AUDIT_REQUIRED`, and `private-cache.live.spec.ts` calls `trackPrivateModelRequests()` from `tests/live/helpers/zeroHuggingFaceAudit.mjs`. |
| 2026-06-06T13:34Z | CONFIG-GATE-RELAX | PASS and landed on `main`. Missing Stripe/Sentry no longer blocks boot; payment surfaces hide checkout when Stripe is missing. |
| 2026-06-06T13:09Z | CONSOLE-TO-LOGGER | PASS and landed on `main`. Production console-noise path closed in code. |

## Deferred / Lower Priority

| ID | State |
|---|---|
| None | No deferred STT ping item currently needs a new dev/test handoff here. |

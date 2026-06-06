# STT Ping Log — Current Queue

This is the fast dev⇄test channel. Keep it short.

Rules:
- Only current, actionable handoffs live here.
- When an item is answered or superseded, replace it with the latest state.
- Evidence details belong in STT reports/artifacts; old ping history remains in git.
- Every active line ends with the current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.

Last hygiene reset: `2026-06-06T20:18Z`.

## Active

| Updated UTC | ID | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|
| 2026-06-06T20:53Z | CI-MAIN | **PASS / latest pushed main** | GitHub `CI - Test Audit` run `27071941664` passed on `main@0b9aa327`: prepare, unit coverage, edge, build, unit shards 1-4, health, Lighthouse advisory, E2E shards 1-4, and report all green. Production Canary `27071941665` and Deploy Supabase `27071941667` also passed. Prior edge red was Supabase setup-cli HTTP 504 and was superseded. | `=> test` |
| 2026-06-06T15:41Z | MAXDEPTH-TRACE | **blocked on valid browser env** | Clean disposable trace worktree built from current `main@ad929674` plus dev max-depth commits `78990a20`, `0b5faccb`, `3de1625e`. Conflict was test-only; kept both tests. Targeted unit check passed with coverage disabled: `SpeechRuntimeController.test.ts` + `useSessionStore.test.ts` = `38/38`. Browser trace not run because this environment has no valid `.env.development`; `check-vite-env development 5174` fails, so any 5174 trace here would be invalid. Need a valid real-auth `5174` run with `localStorage['ss.maxdepth.trace']='1'`, then capture `window.__MAXDEPTH_SUMMARY__()` and first ~80 trace entries. | `=> test` |
| 2026-06-06T20:18Z | V4 | **perf protocol + probe v3 ready / test harness must align** | Performance proof contract lives at `product_release/stt-perf-proof-protocol.md`. Executable probe: `frontend/v4-bakeoff-probe.html` on `dev/v4-recovery@f30e8f7d`. It includes NULL harness-overhead control, multi-fixture support, cold/warm/hot RTF, per-cell `wallMs`, `modelSource`, adapter `shader-f16`, and bundled v2 comparator deps. Test should prefer Tier 1 authed app lifecycle when a valid real-auth `5174` + WebGPU env exists; while blocked, run Tier 2/3 probe v3 on a shader-f16-capable GPU and paste `window.__V4_BAKEOFF__`. Validate v2 controls before judging v4. Release spine unchanged: v2 tiny default + v2 base opt-in. | `=> test` |
| 2026-06-06T20:36Z | STT-HARNESS-INVALID-AUDIO | **implemented / ready for use** | `private-corpus-acceptance` now classifies invalid harness/audio-delivery evidence before model accuracy: explicit empty audio+no `process_audio_ready`, all-zero RMS/peak, impossible `stopFinalizationMs <= 0`, and speech fixtures with timeline proof but no `speech_start_detected`. This prevents `FAIL_NO_TRANSCRIPT`/WER verdicts when audio never reached the engine. Verified `pnpm exec vitest run tests/release --reporter=dot` = `7 files / 41 tests` passed. | `=> test` |
| 2026-06-06T20:18Z | SELFHOST-DEPLOY | **asset proof PASS / auth smoke still useful** | Prod serves real multi-MB ONNX binaries, not LFS pointers: tiny encoder `10,124,913`, tiny decoder `30,727,382`, base encoder `23,200,856`, base decoder `53,707,027` bytes. Remaining useful check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
| 2026-06-06T20:18Z | FEEDBACK-LIVE-PROOF | **migration applied / auth submit proof needed** | Public read-only probe found no unauthenticated Report Issue entrypoint on `/`, `/pricing`, `/auth/signup`, or redirected `/session`. Live submit proof still needs an authenticated app path: submit issue, confirm row lands, no transcript/audio by default, safe failure copy. | `=> test/product` |
| 2026-06-06T20:18Z | PAYMENT-LIVE-GATE | **prod non-live proof PASS** | Public checkout surfaces require `stripeKeyClass==='live'`. Production `/pricing` with non-live Stripe showed no checkout/Stripe/subscribe/upgrade-now surface; visible actions were `Sign In`, `Get Started`, and `Start Free`. Product-ops choice: set live Stripe key when ready; until then public payment is fail-closed. | `=> product-ops` |

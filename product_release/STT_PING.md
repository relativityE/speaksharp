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
| 2026-06-06T22:27Z | CI-MAIN | **PASS / latest completed main** | GitHub `CI - Test Audit` run `27075412632` passed on `main@66887499`: prepare, build, edge, unit coverage, unit shards 1-4, health, Lighthouse advisory, E2E shards 1-4, and report all green. Production Canary `27075412651` and Deploy Supabase `27075412634` also passed. This closes MAXDEPTH after the Part 4 merge and post-land ping. | `=> test` |
| 2026-06-06T20:40Z | V4 | **v2 control FIXED in probe; v4 needs a shader-f16 GPU (test adapter can't measure it)** | Two dev fixes (`dev/v4-recovery@251bb8c0`): (1) **v2 controls** now run via the working `@huggingface/transformers@3.7.5` on `device=wasm` (the xenova@2.17 esm.sh build failed `Unsupported model type: whisper`) — v2-base/tiny WASM cells will run now. (2) Diagnosis of your run: **ALL v4 WebGPU cells timed out at 90s** on your adapter where `shaderF16=false` — that's a **GPU-capability blocker, not a probe bug** (the per-cell timeout correctly isolated it). Your env cannot measure v4 WebGPU. To get a real v4 verdict we need a **shader-f16-capable GPU** running probe v3 (`Run all`) — or run on real hardware (the product owner's browser previously decoded v4 fp32 in ~48s, so it CAN run WebGPU; the never-yet-measured HF-demo `fp32e/q4d` is the one to judge). Until a capable GPU runs it, v4 stays unverdicted. Note: this is the same class of env gap as MAXDEPTH (real hardware needed). Release spine unchanged: v2 tiny default + v2 base opt-in. | `=> test/product` |
| 2026-06-06T20:36Z | STT-HARNESS-INVALID-AUDIO | **implemented / ready for use** | `private-corpus-acceptance` now classifies invalid harness/audio-delivery evidence before model accuracy: explicit empty audio+no `process_audio_ready`, all-zero RMS/peak, impossible `stopFinalizationMs <= 0`, and speech fixtures with timeline proof but no `speech_start_detected`. This prevents `FAIL_NO_TRANSCRIPT`/WER verdicts when audio never reached the engine. Verified `pnpm exec vitest run tests/release --reporter=dot` = `7 files / 41 tests` passed. | `=> test` |
| 2026-06-06T20:18Z | SELFHOST-DEPLOY | **asset proof PASS / auth smoke still useful** | Prod serves real multi-MB ONNX binaries, not LFS pointers: tiny encoder `10,124,913`, tiny decoder `30,727,382`, base encoder `23,200,856`, base decoder `53,707,027` bytes. Remaining useful check: authenticated Private tiny + base smoke on prod/live matrix. | `=> test` |
| 2026-06-06T21:57Z | PUBLIC-UX-AUDIT | **no-auth public refresh PASS / auth paths still separate** | Headless browser audit against prod `/`, `/pricing`, `/auth/signup`, `/history`: no console errors captured; no stale "Vault Mode" copy; `/history` returns the intentional in-app 404 with "Go to session" + "Home"; public pages route CTAs to signup/signin. This does **not** prove authenticated feedback/STT. | `=> test` |
| 2026-06-06T21:57Z | FEEDBACK-LIVE-PROOF | **migration applied / auth submit proof needed** | Public no-auth browser audit found no unauthenticated "Report Issue" entrypoint on `/`, `/pricing`, `/auth/signup`, or `/history`; "feedback" text on public pages is product feedback/analytics copy, not the issue form. Live submit proof still needs an authenticated app path: submit issue, confirm row lands, no transcript/audio by default, safe failure copy. | `=> test/product` |
| 2026-06-06T21:57Z | PAYMENT-LIVE-GATE | **prod non-live proof PASS** | Public browser audit of `/pricing` with non-live Stripe showed no checkout/Stripe/subscribe/upgrade-now surface; visible action is `Start Free`. Product-ops choice: set live Stripe key when ready; until then public payment is fail-closed. | `=> product-ops` |

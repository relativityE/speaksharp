**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.1
**Last Updated:** 2026-06-22

# Release Backlog

> Backlog, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This file tracks known issues, tech debt, and deferred cleanup that should not interrupt active P0/P1 release stabilization unless explicitly promoted.

## Backlog / Active Coordination Contract

`product_release/BACKLOG.md` is the exhaustive inventory of everything known that needs a decision, fix, proof, or explicit deferral for SpeakSharp. It includes release blockers, hygiene items, post-beta cleanup, product-ops decisions, and historical findings that still matter.

`/private/tmp/ACTIVE_COORDINATION.md` is only the current working subset of this backlog: active items plus the next self-assigned pull-forward task. It must not become a second backlog or a historical ping log.

Operating cycle:

1. Pull the highest-priority incomplete backlog item into `/private/tmp/ACTIVE_COORDINATION.md`.
2. Claim one owner and one verifier.
3. Complete and verify the item through active coordination.
4. Mark the backlog row completed/closed, with evidence.
5. Remove the item from active coordination.
6. Pull the next incomplete backlog item forward.

Runtime validation rule:

- If a handoff affects browser behavior, STT engines, auth, storage, payments, network guarantees, or user-facing copy, runtime/browser evidence is required for closure. Compile, build, typecheck, and unit tests are guardrails; they do not close runtime claims by themselves.
- Build-only evidence can close build-hygiene tasks only, and must not be reused as proof that a user-facing runtime path works.

No backlog item is deleted unless it has completed through active coordination and the backlog records that closure.

## Triage Rules

| Priority | Meaning | Release Handling |
|---|---|---|
| P0 | Blocks tester release or risks billing/privacy/data integrity. | Fix before share. |
| P1 | Should fix before broader release or if it blocks validation. | Fix after active P0s are stable. |
| P2 | Workflow, maintainability, polish, or velocity debt. | Schedule after release gates are green. |

## Release Bloat / Dead-Weight Inventory (2026-06-08)

Inventory-only pass from test-release-agent on `dev/native-simplify@62cd31b5`, based on fresh `origin/main@f9204d53` (`origin/main...HEAD = 0 1`, clean worktree). Detailed artifacts: `/private/tmp/release-bloat-inventory-2026-06-08.md` and reconciled test/dev synthesis `/private/tmp/TEST_2ND_PASS_SYNTHESIS_2026-06-08.md`.

Checks run during the pass: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm build` PASS, focused release/STT guards PASS `60/60`, Native formatter parked-code tests PASS `35/35`, payment/analytics/pricing tests PASS `56/56`, and `pnpm rc:sast:secrets` PASS.

| Priority | ID | Finding | Evidence | Owner / next action |
|---|---|---|---|---|
| ✅ RESOLVED | BLOAT-TRACKED-ENV-SECRETS | **Misclassification, not a secret exposure** (owner ruling 2026-06-08). | Two things were conflated under "secrets": (1) the committed `.env.test`/`frontend/.env.test` entries were *named* like secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ASSEMBLYAI_API_KEY`, test passwords) but held **mock values**; a full-tree/full-history scan (`/private/tmp/DEV_SECRET_HISTORY_SCAN_2026-06-08.md`, 3231 commits / 30 branches / 10 tags) found **no real secret ever committed**. Repo hygiene done: tracked env files removed, root `.env.test.example` added, scan hardened, `pnpm rc:sast:secrets` PASS, `git ls-files` clean. (2) ~half the 36 GitHub **Secrets** are public config (URLs/IDs, anon/publishable keys, Sentry DSN, PostHog public key) **over-classified** as Secrets. | **No rotation, no history purge, no incident — we are not "fixing secrets."** Real provider secrets live only in GitHub and were never committed. The first over-classified public-config cutover is complete on `main@c010434d`: 8 GitHub Variables created, 52 workflow refs changed from `secrets.X` to `vars.X`, and post-merge CI/Canary/Deploy are green (`27153261348`, `27153261334`, `27153261357`). **Owner may delete those 8 now-duplicated old Secrets later as low-priority hygiene, not a beta blocker.** `SECRET_ROTATION_RUNBOOK.md` retained only as a hypothetical reference. |
| P0/P1 | BLOAT-AUDIO-FIXTURES | ✅ CLOSED on `main@c5a2a460`. | Original `tests/fixtures/jfk_16k.wav` and `tests/fixtures/test-audio.wav` were HTML documents per `file`; `tests/live/live-transcript.live.spec.ts` used `jfk_16k.wav` as fake mic audio. Test commit `dev/release-closure@7d8aa2bd`: replaced `jfk_16k.wav` from checked-in `jfk.flac`, replaced `test-audio.wav` from valid `test_speech_16k.wav`, added `tests/release/audio-fixture-integrity.test.ts`, and wrote classification artifact `/private/tmp/audio-fixture-evidence-classification-2026-06-08.md`; focused guard passes with coverage disabled. Test rerun artifact `/private/tmp/TEST_AUDIO_FIXTURE_AFFECTED_RERUN_2026-06-08.md`: repaired fixtures are valid RIFF/WAV, but `tests/live/live-transcript.live.spec.ts` was itself stale/invalid because it never called `page.goto(...)` before waiting for `transcript-container`; screenshot was blank white page. Commit `97dd03b4` retired that invalid spec rather than repairing it. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. Historical `live-transcript`/bad-fixture proofs remain INVALID unless independently backed by valid audio; other RIFF/WAVE STT fixture families are not invalidated. |
| P1 | BLOAT-FIX-RLS | ✅ CLOSED on `main@c5a2a460`. | Original `backend/supabase/functions/fix-rls/index.ts` had permissive `Access-Control-Allow-Origin: *`, created an unused service-role client, and returned “Use the Supabase Dashboard SQL Editor...” It was not deployed by `.github/workflows/deploy-supabase-migrations.yml`. Dev deleted it on `dev/release-closure@35157a72`; test verification found no file and no runtime/deploy/code references outside backlog text. GitHub `CI - Test Audit` run `27138824814` and Deploy Supabase run `27138824839` both PASS on `c5a2a460`. | Closed; keep deleted. |
| P1 | BLOAT-TURBO-ASSETS | ✅ CLOSED for beta on `main@c5a2a460` — full retirement landed and production runtime reproof passed. | Per product decision "delete + accept risk", retired (not quarantined) as one coherent change: 34 files, -1654/+41; ~57 MB assets removed (`tiny-q8g16.bin` 49 MB + turbo wasm/js ~6 MB) + 93 pkgs (`whisper-turbo`/`whisper-webgpu` + transitive). Removed: `WhisperTurboEngine.ts`, `WhisperEngineRegistry.ts`, PrivateSTT selection/promotion, sttProviderConfig entry, sw.js mapping, vite/vitest turbo config, predev/prebuild hooks, dup mocks, patch. Follow-up `9c5961e5` removed remaining inert turbo type/probe residue from `EngineType`, `PrivateSttProvider`, `PrivateSTT`, and `ModelManager`; `ce8cf752` purged remaining test/runtime labels. Supplemental guardrails: affected vitest 254/254; final full gate `/private/tmp/TEST_RELEASE_CLOSURE_FULL_GATE_2026-06-08.md` PASS; GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. Production reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` PASS: Private base reaches model-ready/transcribes, model/cache URLs contain no `whisper-turbo` or `tiny-q8g16`, and zero Hugging Face model requests. | Closed for beta. v4 remains hidden/off flag and post-beta; reopen only if a turbo asset/provider resurfaces in runtime/network/dist. |
| P3 | BLOAT-TURBO-LITERAL | ✅ CLOSED on `main@c5a2a460`. | Removed the inert `'whisper-turbo'` string residue left after BLOAT-TURBO-ASSETS: `EngineType`, `PrivateSttProvider`, `PrivateSTT` provider filtering/cache selection, `ModelManager` IndexedDB turbo probe, related `ModelManager` tests, test mock labels, `privateRuntimePath`, and STT negotiator residue. Verified by full local gate `/private/tmp/TEST_RELEASE_CLOSURE_FULL_GATE_2026-06-08.md` PASS and GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. |
| P1 | BLOAT-PRIVATE-FALLBACK | ✅ CLOSED for beta under the claim "no Hugging Face model weights." | Original `frontend/src/services/transcription/engines/TransformersJSEngine.ts` main-thread path hardcoded local `whisper-tiny.en`; on local load failure it enabled remote models and loaded `Xenova/whisper-tiny.en`. Dev fixed strict no-HF fallback on `dev/release-closure@b579c3a4`; targeted test `TransformersJSEngine.test.ts` passes 23/23 with no-HF assertions. Local browser/network proof `/private/tmp/TEST_PRIVATE_NO_HF_BROWSER_PROOF_2026-06-08.md` PASS on `localhost:5174`. Production reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` PASS on `https://speaksharp-public.vercel.app` release `c5a2a460`: seven `/models/whisper-base.en` requests from origin, zero Hugging Face requests, zero Hugging Face cache URLs, non-empty transcript. Nuance remains: ORT WASM runtime may come from jsDelivr, which is not HF and does not upload audio, but means the path is not fully same-origin runtime self-hosted. | Closed for beta if product claim is "no Hugging Face model weights." If product requires "all Private runtime/model assets are same-origin," add a post-beta/runtime-hardening follow-up to serve ORT WASM from origin. |
| P1 | BLOAT-PAYMENT-CTA | ✅ CLOSED for beta on production `main@c5a2a460`. | Core payment enablement is correctly `pk_live_` gated. Dev committed `dev/release-closure@d7cd305c`: `AnalyticsPage`, `AnalyticsDashboard`, and `SunsetModals` now render-gate upgrade CTAs on `arePaymentsEnabled()`. Focused unit/component tests passed in the handoff. Local browser proof `/private/tmp/TEST_PAYMENT_DISABLED_BROWSER_PROOF_2026-06-08.md` PASS. Production reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` PASS: `stripeKeyClass="test"`, checkout action count `0`, public pricing/home and authenticated analytics expose no checkout/upgrade controls. | Closed for beta while Stripe is non-live/hidden. Reopen for live-payment launch to verify `stripeKeyClass="live"` and live checkout/webhook. |
| P1 | BLOAT-CONFIG-REQUIRED-COPY | ✅ CLOSED on `main@c5a2a460`. | Boot now only requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, but `ConfigurationNeededPage` originally told users/testers `VITE_STRIPE_PUBLISHABLE_KEY` and `VITE_SENTRY_DSN` were required. Test-agent fixed the page/test on `dev/release-closure`: only Supabase URL/anon are listed as required; Stripe/Sentry are described as optional for startup, with payment surfaces hidden unless a live Stripe key is configured. Focused proof passed: `ConfigurationNeededPage`, runtime config, payment/analytics/upgrade surfaces `73/73`. Original mismatch proof `/private/tmp/TEST_VALIDATE_ENV_MISMATCH_2026-06-08.md`; fix proof `/private/tmp/TEST_VALIDATE_ENV_FIX_PROOF_2026-06-08.md` PASS; GitHub `CI - Test Audit` run `27138824814` PASS after `e793a5b3` and `c5a2a460`; production runtime reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` shows release `c5a2a460` with `authMode=real`, `mockAuth=false`, and `releaseProofEligible=true`. | Closed. |
| P1 | BLOAT-NATIVE-FROZEN-COPY | ✅ CLOSED for beta — scary “Engine Frozen” user-facing copy no longer ships. | Prior human proof observed `Speech recognition is taking a moment (Engine Frozen)` during successful Native recognition. Dev committed `dev/release-closure@d7cd305c`: Native heartbeat drift is logged but no longer surfaces the scary user-facing frozen warning; non-Native warning copy is calmer. Fresh unit proof `/private/tmp/TEST_NATIVE_ENGINE_FROZEN_UNIT_PROOF_2026-06-08.md` passes 3/3. Real Chrome/CDP freeform proof `/private/tmp/TEST_NATIVE_REAL_MIC_FREEFORM_RUNTIME_PROOF_2026-06-08.md` PASS: Native recording started/stopped/saved and artifact contains no `Engine Frozen` text. Production string proof `/private/tmp/TEST_PROD_ENGINE_FROZEN_STRING_PROOF_2026-06-08.md` PASS: current production main/STT bundles contain no `Engine Frozen`, `engine frozen`, `taking a moment`, or `Speech recognition is taking` strings. | Closed for beta. Do not use the freeform run for WER/formatter-quality claims because it had no fixed ground-truth script. Native punctuation/accuracy quality remains separate and only required if product copy makes quality claims. |
| P1 | BLOAT-STALE-COORD | ✅ CLOSED on `main@c5a2a460`. | `product_release/ACTIVE_COORDINATION.md` claimed to be the single source of truth, but active coordination moved to `/private/tmp/ACTIVE_COORDINATION.md`; repo file contained stale `origin/main@7cc9fed2`. Test-agent deleted the repo file on `dev/release-closure@98b37528` and reset `/private/tmp/ACTIVE_COORDINATION.md` to a small active subset of this backlog. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. Keep all future active coordination in `/private/tmp/ACTIVE_COORDINATION.md`. |
| P2 | BLOAT-VAULT-DOCS | ✅ CLOSED on `main@c5a2a460`. | `product_release/PRODUCT_FEATURES.operational.md` still paired Private with the legacy term; GitHub tester feedback template offered the same legacy mode label and privacy warning. App release guards block raw/stale terminology in user-facing `frontend/src`, so this was docs/tester-facing drift, not current UI copy. Test-agent cleaned active docs/templates on `dev/release-closure`. Historical evidence remains untouched. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. Future active docs/templates should use Browser/Native, Private, and Cloud naming. |
| P2 | BLOAT-5173-DOCS | ✅ CLOSED for release/manual docs on `main@c5a2a460`. | `_shared/cors.ts` fallback/comment, `stripe-checkout` local fallback, Supabase deploy workflow `ALLOWED_ORIGIN`, and `LAUNCH_ENV_CHECKLIST.md` pointed release/manual CORS guidance at 5173 while manual proof mode is 5174. Test-agent aligned those release/manual CORS surfaces to 5174 on `dev/release-closure`; intentionally diagnostic/test-mode 5173 references remain. Verification: stale-release-surface `rg` returned no hits; `deno check` passed for CORS + stripe-checkout; Deno tests passed 2 files / 7 steps. GitHub `CI - Test Audit` run `27138824814` and Deploy Supabase run `27138824839` both PASS on `c5a2a460`. | Closed for release/manual docs; diagnostic/test-mode `5173` remains valid for `pnpm dev:test`. |
| P2 | BLOAT-FAILURE-DUMP | ✅ CLOSED on `main@c5a2a460`. | `baseline_manifest.txt`, `consolidated_manifest.txt`, empty `e2e_errors_detailed.txt`, `unit-results.txt`, and `frontend/test_failures_v7.txt` were tracked generated outputs, not source/test/canonical evidence. Commit `dev/release-closure@ae532ee9` deleted those generated dumps and added ignore patterns. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. Keep generated dumps ignored and out of source. |
| P2 | BLOAT-LOCAL-OUTPUTS | ✅ CLOSED for current main worktree; local hygiene only. | Current inventory artifact: `/private/tmp/TEST_LOCAL_OUTPUTS_INVENTORY_2026-06-08.md` on `main@f9630e08`. `git clean -ndX` reports only ignored `artifacts/` and `node_modules/`; sizes are `76K` and `1.8G` respectively. No tracked build/test output directories are present; no `frontend/dist`, `frontend/dist-e2e`, `test-results`, `playwright-report`, or `lighthouse-results` directories are present in this worktree. | Closed as non-release issue. Optional disk cleanup: remove ignored `artifacts/`; keep or reinstall `node_modules/` as normal dependency cache. |
| P2 | BLOAT-EVIDENCE-REPORTS | ✅ CLOSED on `main@c5a2a460`. | `product_release/evidence` has 25 tracked files, ~460 KB total, including 4 historical `test_reports/` Markdown reports and dated proof JSONs from 2026-06-02/05. `.DS_Store` was observed as ignored local debris, not tracked repo weight. Test-agent added `product_release/evidence/README.md` on `dev/release-closure` to label this directory as an evidence archive, not current release truth; it directs current verdicts back to `BACKLOG.md` and `/private/tmp/ACTIVE_COORDINATION.md`, and warns that older reports may contain superseded conclusions. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed. Do not delete dated evidence casually; use the README/backlog to prevent stale interpretation. |
| P2 | BLOAT-FORMAT-TRANSCRIPT | ✅ CLOSED for beta — Gemini LLM path REMOVED, deterministic wired and merged. Original commit `dev/release-closure@8125a899`; closure batch merged to main. | Product call: "if in use, remove it." Removed (not flag-gated): `nativeGeminiFormatter` (+test), the `format-transcript` Supabase edge fn (index/test/deno.json), and its deploy lines (GEMINI_API_KEY sync kept — get-ai-suggestions still uses it). Wired `nativeDeterministicCleanup` (`normalizeNativeTranscript`, $0/instant/word-safe) through the SAME seam (word-preservation guard + telemetry + Private guard unchanged; same `registerNativeProductionFormatter(mode)` API). Proof: tsc clean; native cluster 74/74; `pnpm build` exit 0; grep-clean. Real Chrome/CDP freeform proof `/private/tmp/TEST_NATIVE_REAL_MIC_FREEFORM_RUNTIME_PROOF_2026-06-08.md` PASS: zero `/functions/v1/format-transcript` network calls, deterministic formatter telemetry `attempted=true`, `wordPreserving=true`, `fallbackToRaw=false`, `errorCode=null`. NeMo-ONNX = UNGUARANTEED post-beta candidate, not a plan. | Closed for beta if Native copy makes no punctuation-quality claim. If product wants Native formatter-quality claims, run a scripted ground-truth Chrome mic proof; the freeform run only proves runtime path. |
| P2 | BLOAT-SCRIPT-REACHABILITY | ✅ CLOSED for beta script pruning on `main@c5a2a460`. | Test-agent reachability disposition saved at `/private/tmp/TEST_SCRIPT_REACHABILITY_DISPOSITION_2026-06-08.md`. Several initial suspects are not bloat: `private-status-reducer.mjs` and `private-timing-reducer.mjs` are imported by release tests; `preinstall.sh`, `dev-init.sh`, `vm-recovery.sh`, `benchmark-filler-ceiling.mts`, and `generate-filler-audio.sh` are listed in `RC_TEST_INVENTORY.md`. Dev second pass deleted the five unreferenced `scripts/dev/private-*` research harnesses (buffer-replay, longform-endurance, onset-preroll, v2/v3/v4 Washington longform, v2-v4 node compare). GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed for beta. Broader script inventory can resume post-beta only if a concrete owner/use case is missing. |
| P2 | BLOAT-DEPS | ✅ CLOSED for beta dependency cleanup on `main@c5a2a460`. | Test-agent dependency disposition saved at `/private/tmp/TEST_DEPENDENCY_DISPOSITION_2026-06-08.md`. Confirmed in-use: `@xenova/transformers` for Private v2 and `@huggingface/transformers` for v4 off-flag. Dev second pass removed `compromise`, `@types/node-fetch`, `node-fetch`, `pdf-lib`, `pdf-parse`, `jose`, `baseline-browser-mapping` (direct manifest), `pdfjs-dist`, and the retired turbo package cluster; `@vitest/ui` was kept as dev-only/documented. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. | Closed for beta. Exhaustive depcheck can remain post-beta if desired, but no known beta-blocking unused dependency remains. |
| P2 | BLOAT-BUILD-WARNINGS | ✅ CLOSED for beta build hygiene on `main@c5a2a460`. | Test-agent build disposition saved at `/private/tmp/TEST_BUILD_WARNINGS_DISPOSITION_2026-06-08.md`. Current post-fix state: `validate-env` allows Supabase-only startup with optional Stripe/Sentry warnings; `pdfjs-dist` removal eliminated the empty `vendor-pdf` chunk; turbo retirement removed the turbo chunk. GitHub `CI - Test Audit` run `27138824814` PASS on `c5a2a460`. Remaining accepted warnings: stale Browserslist data, upstream `onnxruntime-web` eval warning, mixed static/dynamic imports preventing chunking, duplicate timestamped/non-timestamped ORT WASM assets, and >500 KB chunks (`main`, transformer bundles, `AnalyticsPage`). | Closed for beta as build-hygiene disposition. Do not use build success as proof for STT/payment/no-HF runtime behavior. Post-beta follow-ups: update Browserslist, investigate ORT WASM duplication carefully with runtime checks, and code-split large chunks if needed. |

## Current Product Release Readiness Posture (2026-06-03)

Reviewer/product framing is now explicit:

```text
Native and Private are the trust-building front door.
Cloud is the paid quality accelerator, not the first-impression crutch.
```

Reviewer/product framing update (2026-06-03):

```text
STT is infrastructure.
SpeakSharp is the coach.
```

This does not lower the STT bar. It clarifies why STT matters: the
transcript is the evidence layer that feeds coaching, score, analytics, and
user trust. Release work should therefore optimize the full feedback loop:

```text
Try -> Trust -> Improve -> Save -> Compare -> Upgrade
```

The product promise under review:

```text
Practice privately, get trustworthy feedback, improve one thing at a time.
```

The product should ship only if at least one non-Cloud path is trust-preserving.
Native and Private do not need to equal Cloud, but any visible path must avoid
embarrassing first-run behavior: blank panels, unstable trust labels, duplicate
or truncated transcript text, unreadable punctuation/casing, or overconfident
Score/Analytics from weak transcripts.

| STT | Business role | Product promise | Release requirement |
|---|---|---|---|
| Native | Free/Basic front door and conversion funnel | Zero-setup, browser-dependent quick start | Human Chrome mic proof must show fast visible feedback, no duplicate/erase on Stop, useful saved transcript, readable/caveated formatting, and save/history/detail pass. If it fails, de-emphasize Native instead of making it the first CTA. |
| Private | Strategic privacy/local differentiator | Runs in the browser without uploading audio for STT | Must preserve setup/download consent, show progress and trust states, keep cumulative visible transcript, and meet/beat the better of same-model/drop-in and Native human Chrome mic baseline. If slower, it must be honestly caveated as local/private, but caveats cannot excuse materially worse transcript quality. |
| Cloud | Pro quality accelerator | Best quality path for longer sessions, exports, AI coaching, and polished reports | Baseline only is the launch candidate. Cloud keyterms/prompt variants are backlog/custom-word experiments unless explicitly reopened. |
| Score/Analytics | Trust interpretation layer | Converts transcript/session signals into coaching and trends | Score must stay directional/confidence-gated when transcript quality is weak. Analytics must keep transcript-quality caveats prominent enough to distinguish speaking issues from STT capture issues. |

## Open Beta Closeout Findings (2026-06-05)

| Priority | ID | Finding | Status / evidence | Owner / next action |
|---|---|---|---|---|
| P0 | PROD-CONFIG-1 | ✅ CLOSED for beta/non-payment launch on `main@c5a2a460`; live-payment launch remains product-ops. | Production runtime reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` against `https://speaksharp-public.vercel.app/` and `/pricing` found `window.__APP_RUNTIME_CONFIG__` present with real Supabase auth (`authMode=real`, `mockAuth=false`, `releaseProofEligible=true`), release `c5a2a4600de3dc702115422a75600d2985695a66`, and `stripeKeyClass="test"`. Public home/pricing and authenticated analytics exposed no checkout/upgrade controls; checkout action count `0`. | Closed for beta while payments remain hidden. Product-ops must set live Stripe key and test live checkout/webhook before paid launch. |
| P1 | PRIVACY-OBS-1 | ✅ CLOSED for beta on production `main@4d84b46d`. | Production has Sentry `sendDefaultPii=false`, console breadcrumbs scrubbed, and PostHog `autocapture=false`, `capture_pageview=false`, `capture_performance=false`, `disable_session_recording=true`; SAST/Edge privacy tests passed. Current production bundle probe on `https://speaksharp-public.vercel.app/assets/main-D7WVK4dq-1780924913880.js` found the generic background-toast string `"Something went wrong in the background"` and no committed secret literals. The remaining `PGRST116` bundle hit is an internal profile-service "profile not found" branch, not a user-facing raw toast. | Closed for beta. Reopen only if a runtime proof shows transcript/audio payloads in Sentry/PostHog or raw backend errors in user-facing toasts. |
| P0 | FEEDBACK-1 | ✅ CLOSED for beta on production `main@c5a2a460`. | Earlier proof failed with `PGRST205` because `public.user_issue_reports` was absent. Current production reproof `/private/tmp/TEST_PROD_RUNTIME_REPROOF_C5A2A460_2026-06-08.md` on release `c5a2a4600de3dc702115422a75600d2985695a66` shows fresh signup, visible Report Issue, HTTP 201 insert to `user_issue_reports`, `includeTranscript=false`, `includeAudio=false`, and success text. | Closed for beta: keep Report Issue visible. Reopen only if a later release build regresses or product requires opt-in attachment variants before beta. |
| P0 | STT-EVIDENCE-1 | STT release evidence is partial. | Private STT-P6 base-vs-tiny evidence is complete: base helps guard rows but does not fix `conv_01` and is too slow as default. Native human mic proof is still pending. Cloud baseline smoke is complete; richer metrics are deferred behind Native/Private. | test-release-agent owns Native human proof and any Cloud richer metrics after Native/Private; product decides Private base opt-in vs tiny default. |

Current 24-hour gates:

| Gate | Owner | Pass condition |
|---|---|---|
| Native front-door proof | Test/release with human mic; dev only if artifact proves product bug | Clean/filler/realistic scripts captured with first visible text, visible-at-stop, post-stop final, `selectedForSave`, saved/history/detail, duplication flag, formatter telemetry, and readability. |
| Private trust proof | Test/release; dev fixes concrete boundaries | Setup consent honored; live text cumulative; Private Draft/Processing/Final states correct; no duplication/truncation in `saveCandidate`; short/medium scripts meet/beat the better of same-model/drop-in and Native human baseline. |
| Cloud baseline proof | Test/release; dev only for provider/request/tail bug | Current-head deployed smoke passed on run `26960691857`; richer tail/readability/WER metrics are deferred behind Native/Private. No default keyterms work. |
| Score/Analytics trust | Dev + test | Weak transcript quality lowers confidence/copy, not necessarily the numeric formula; Analytics exposes transcript-quality caveats as a guardrail inside the Speak Clearly/trust surfaces. |

Test/release validation standard from reviewer:

| Question | Evidence required before wider release |
|---|---|
| Can a new user understand the value quickly? | Homepage/signup/session screenshots and copy review: user can tell they are starting a speaking-coach practice, not choosing an STT benchmark. |
| Can they complete a short practice? | Browser journey proof: signup/login -> session -> record -> stop -> save -> history/detail. |
| Can they distinguish draft from final? | Native and Private proofs capture trust banners/states, `__SS_TRUST_TRACE__`, visible transcript before Stop, final transcript after Stop, and screenshots/video. |
| Does the score explain confidence? | Session score card and Analytics must show transcript-quality caveat/confidence when STT readability, filler recall, duplication, or truncation is weak. |
| Does Analytics tell them what to do next? | Each Analytics focus should answer a user question and end in a next-practice implication, not only raw charts. |
| Does mode copy set correct expectations? | Native = instant/browser-dependent; Private = local/privacy with setup and local processing; Cloud = paid quality accelerator. No mode should borrow another mode's trust copy. |

Current 48-hour wider-use gates:

| Gate | Exit criterion |
|---|---|
| Native visible | Three-script human Chrome mic proof passes or Native is de-emphasized/hidden behind caveat. |
| Private credible | Browser proof on guard rows plus medium/long script shows cumulative UX, final transcript completeness, and no worse-than-drop-in app behavior; punctuation/readability is either acceptable or clearly caveated. |
| Cloud paid path | Baseline long-form/tail/save/detail proof passes; keyterms remains backlog unless a future custom-word experiment proves no ordinary-word regression. |
| Score/Analytics | Transcript-quality caveats are visible enough that users understand when feedback reflects capture quality rather than speaking quality. |

## Product UX/UI Reviewer Packet — Journey, Trust, And Analytics Meaning (2026-06-03)

This section captures the review request that should guide the next product UX pass. It is not a separate release status file; it is the working backlog home for reviewer questions and resulting tasks.

## Reviewer Incident Packet — Manual Test Environment Mislaunch (2026-06-04)

### Executive Summary

Manual Native/Private STT proof was blocked before speech testing because the app was launched on the wrong local mode/port. The operator started a Vite server directly on `5173`, which is reserved for mocked E2E diagnostics (`pnpm dev:test`). The real manual-testing app must be launched only with `pnpm dev`, which delegates to `pnpm dev:real` and runs on `5174`.

The product guard correctly prevented a fake-auth runtime from looking like a valid manual-test app:

```text
Invalid local environment
Mode development must run on port 5174, but this app is on 5173.
Use pnpm dev for real manual testing on port 5174.
Use pnpm dev:test only for mocked E2E diagnostics on port 5173.
A real-looking app must never boot with fake credentials.
```

The guard behavior is good and should remain strict. The failure was process/tooling: the release agent bypassed the sanctioned launcher and wasted scarce human-mic testing time.

### What Happened

| Step | Expected | Actual | Impact |
|---|---|---|---|
| Launch manual STT proof | Run `pnpm dev` from repo root. App runs on `http://localhost:5174` with real auth. | A direct Vite command was used on `5173`, initially with `.env.test` in the sourced environment. | App booted in an invalid local environment and hit mock-auth/runtime guards. |
| Browser target | Chrome should open `http://localhost:5174/session` or `/auth/signup`. | Chrome was opened to `http://localhost:5173/session`. | User saw a broken/blocked app instead of the manual proof path. |
| Console monitoring | CDP should attach to the same real manual-test tab. | CDP initially attached to stale `5173`, not the user’s real `5174` tab. | Early console capture proved the wrong-mode failure but did not capture the active manual proof. |
| Human proof | Fresh signup -> Native mic -> Private mic. | Human proof was delayed by launch/auth confusion. | Lost tester time and trust in the test process. |

### Root Cause

The launch workflow allowed direct low-level commands (`pnpm exec vite`, manual env sourcing, arbitrary port selection) during release proof. That bypassed the repo’s own guardrails:

- `pnpm dev` / `pnpm dev:real` is the only valid manual-testing entry point.
- `pnpm dev:test` / port `5173` is for mocked E2E diagnostics only.
- `.env.test` must never be sourced for real human STT/manual signup testing.

### Severity

| Dimension | Rating | Reason |
|---|---|---|
| Product correctness | P0 process blocker | Blocks release proof before STT can be tested. |
| User-facing release risk | High if unguarded | A real-looking app with fake credentials would invalidate all STT evidence. |
| Current app behavior | Positive guard | The app blocked the invalid environment instead of silently proceeding. |
| Agent/process behavior | Failing | The sanctioned launcher was bypassed. |

### Prevention Rules

| Rule | Requirement |
|---|---|
| Manual proof launch | Use only `pnpm dev` from repo root. Never call `vite` directly for human/manual release proof. |
| Port contract | `5174` = real manual testing. `5173` = mocked E2E diagnostics. `4173` = preview/build checks. |
| Env contract | Real manual proof may load real `.env` / `.env.local`, but must not load `.env.test`. |
| Browser target | Manual proof opens only `http://localhost:5174/...`. |
| CDP target | Console capture must attach to the same `5174` tab before recording starts. |
| Evidence validity | Any artifact from `5173` is invalid for real human STT proof unless explicitly labeled mocked E2E diagnostic. |

### Requested Reviewer Recommendation

Please review whether the current guard and process are sufficient, or whether we should add stronger enforcement:

1. Should direct `vite` launches be blocked or loudly warned when they use release-proof routes?
2. Should `pnpm dev` automatically open `http://localhost:5174/auth/signup` for manual tester flows?
3. Should CDP/browser proof tooling refuse to proceed unless the active page URL is `localhost:5174` and the app reports real-auth mode?
4. Should release artifacts include a required `environmentProof` block: URL, port, mode, auth mode, and launch command?
5. Should `product_release/ACTIVE_COORDINATION.md` require every human proof row to state the launcher and port before recording begins?

### Acceptance Criteria

| Check | Pass Condition |
|---|---|
| Guard retained | `5173` real-manual attempt is blocked with clear copy. |
| Correct launch documented | `pnpm dev` on `5174` is listed in current work/proof instructions. |
| Proof metadata captured | Human STT evidence records `launchCommand=pnpm dev`, `url=http://localhost:5174`, and `authMode=real`. |
| CDP attached | Future proofs include a CDP log from the same `5174` tab or explicitly state why not. |
| No fake-auth artifacts | Any STT proof with mock auth or `5173` is rejected as release evidence. |

### Journey To Review

| Step | Current product intent | What the user should understand | Current evidence / observation | Reviewer question |
|---|---|---|---|---|
| Homepage | Convert a visitor from curiosity to a low-friction practice start. | SpeakSharp is a speaking coach, not just a transcript recorder. Free Browser practice starts quickly; Private and deeper coaching exist when trust/precision matters. | Local visual pass: hero says "Private Practice. Public Impact!"; CTAs are "Start Practice Session" and "See How Feedback Works"; feature cards cover instant practice, deeper coaching, and privacy. | Is the first viewport clear enough that a new visitor knows what they will do next, or should the hero show the actual session workflow more concretely? |
| Signup | Reduce friction while setting correct plan expectations. | Start free with Browser transcription; one short Private sample is available intentionally; Cloud is paid Early Access only. | Current branch changes signup copy to Browser-first and moves Private into a bounded sample. | Does the Browser-first + Private-sample distinction feel clear and fair, or does it create too much decision load before the user has practiced? |
| Session | Make the live practice surface feel active, trustworthy, and coaching-oriented. | The user should know: current STT mode, whether text is draft/final, whether local processing is happening, what the SpeakSharp Score means, and which 2-3 actions to try. | Code path: `SessionPage` renders `LiveRecordingCard`, `LiveTranscriptPanel`, `LiveCoachingScoreCard`, and `FillerWordsCard`. Score card explains structure, pace/fillers/pauses, clarity, audience impact, and transcript-quality confidence. Browser E2E currently passes 38/38 on covered journeys. | Is the right side score/coaching rail motivating without distracting while speaking? Are trust banners strong enough when Native/Private text is jumpy or delayed? |
| Save/history/detail | Confirm that a practice session became durable evidence. | Saved transcript, metrics, engine metadata, history row, detail transcript, PDF, and AI suggestions should align. | Code path: Analytics detail view exposes `data-session-detail-transcript`, engine metadata, stat cards, PDF export, and AI suggestions. Known STT human-proof reruns still gate Native/Private detail correctness. | After Stop, does the user have an obvious next action, and does the saved detail feel like a coherent report rather than a database record? |
| Analytics dashboard | Turn many tools into a small number of understandable coaching stories. | Pick one improvement goal: Speak Clearly, Sound Confident, or Track Progress. Custom remains available for advanced metric selection. | Code path: `AnalyticsDashboard` renders visible focus label, purpose, outcome, "Why these tools are here", selected stat cards, selected carousel tools, goals, history, comparison, and PDF actions. Component coverage checks the three primary stories and legacy focus migration. | Are the three focus names and descriptions self-explanatory enough, or should each focus get a tooltip/help affordance and example question? |
| Score/Analytics connection | Keep Score motivating but not overconfident. | SpeakSharp Score is directional; transcript quality affects score confidence; Analytics should help separate speaking quality from STT capture quality without making capture quality a top-level primary goal. | Score card has a transcript-quality caveat and hides precise score when confidence is low. Analytics folds transcript quality into Speak Clearly and the trust/caveat surfaces, with STT Engine Quality available as an analysis tool. | Is the transcript-quality caveat prominent enough when a transcript is weak, or should it surface automatically on low-confidence sessions instead of requiring user discovery? |

### Analytics Focus Definitions Shown To Users

| Focus | User question it should answer | Current user-facing meaning | Primary concern for review |
|---|---|---|
| Speak Clearly | "Did my point land?" | Emphasizes clarity, transcript trust, repetition/concision, and the saved detail surfaces that support AI suggestions. | Does it feel like help improving the message rather than a generic transcript-quality dashboard? |
| Sound Confident | "Was I easy to follow?" | Emphasizes pace, pauses, filler words, delivery control, and audience confidence. | Does it map cleanly to what users expect from sounding more composed? |
| Track Progress | "Am I getting better over time?" | Emphasizes trends, goals, history, comparisons, saved-session proof, and reports. | Does it feel motivating enough to bring users back? |
| Custom | "Which specific metric do I want to inspect?" | Lets users intentionally inspect specific tools outside the three primary goals. | Does custom selection preserve interpretation without competing with the main product narrative? |

### Open UX/Product Tasks From This Review

| Priority | Task | Why it matters | Owner / next proof |
|---|---|---|---|
| P0/P1 | Verify trust-state UX in real Private and Native sessions. | The product can have good final WER and still feel broken if text appears late, jumps, replaces prior text, or lacks a draft/final disclaimer. | Test/release proof with screenshots/video and `__SS_TRUST_TRACE__`; dev fixes only proven state-machine defects. |
| P1 | Keep transcript-quality caveats prominent in Native/Private reruns. | Automated score/analytics proof now verifies transcript-quality caveats and Analytics focus coverage, but human STT reruns still need to prove the warning appears when real transcripts are weak. | Test/release: rerun Native/Private after dev fixes and confirm score/Analytics caveats remain visible when quality is still low. |
| P1 | Review whether Analytics focus chooser needs tooltips or examples. | The focus model is intended to reduce metric soup; if names are unclear, users will not know which story to choose. | UX/reviewer pass; possible dev task: add compact help copy or hover/tooltips for each focus. |
| P2 | Review homepage "See How Feedback Works" path. | Homepage offers analytics preview, but unauthenticated `/analytics` redirects to sign-in, which may blunt the promise. | Product decision: either keep auth gate or add a non-auth demo/preview route. |
| P2 | Reassess visual density after STT bugs settle. | Session currently has recording controls, transcript, live score, and fillers; it must stay focused during speech. | Screenshot pass desktop/mobile after latest STT trust-state fixes. |

## Open Beta Closeout Gate Findings (2026-06-05)

| ID | Priority | Owner | Finding | Required action |
|---|---|---|---|---|
| RC-LH-1 | ✅ SUPERSEDED | @dev-agent | **Superseded by `gate=all` run `28235534502` (2026-06-26): Gate 1 Product PASS in CI.** _Historical:_ a local `rc:gate:1:product` run failed Lighthouse `NO_FCP` on `127.0.0.1:4173` (built test-mode app stayed on the loader). Not reproduced in the cloud gate. | Closed against the green cloud run; reopen only if Gate 1 fails on the final signoff SHA. |
| RC-LIVE-ENV | ✅ SUPERSEDED | product/ops | **Superseded by `gate=all` run `28235534502` (2026-06-26): Gate 3 DAST (live) PASS** with `BASE_URL` + Supabase + reviewer creds supplied; a before/after audit proved 0 `auth.users` drift. _Historical:_ a local `rc:dast:live` correctly stopped when live proof inputs were absent. | Closed; live DAST counts as release evidence on the green run. |
| RC-SCA-1 | ✅ SUPERSEDED | @dev-agent | **Superseded by `gate=all` run `28235534502` (2026-06-26): Gate 4 SCA PASS.** _Historical:_ an older `main@da09b2c6` SCA failed on a critical `vitest <4.1.0` advisory. | Closed against the green run; SCA exceptions tracked in `SCA_EXCEPTIONS.md`. |

## Current STT Ownership

Current ownership belongs only in `/private/tmp/ACTIVE_COORDINATION.md`.
The repo copy `product_release/ACTIVE_COORDINATION.md` has been deleted because there must be one active coordination source of truth.
Old proof chatter has been removed from active reports; use git history only for audit.
| **product** | Keep Cloud baseline only for launch; keep Private formatter local-only; decide whether Native raw-at-Stop plus async formatting is acceptable if quality improves. |

Coordination protocol: each agent should work in its own worktree or isolated
branch. Main is the integration baseline only. Branches may be tested before
merge; only final integration to `main` is serialized. Every branch must declare
base SHA, files touched, expected behavior, tests run, proof needed, and rollback
plan. Do not leave release fixes stranded on long-lived branches.

## Recently Closed

| Closed Date | Area | Result | Evidence |
|---|---|---|---|
| 2026-05-27 | Free baseline restoration | Closed locally. Runtime code, Edge Functions, migrations, workflows, tests, and launch docs now use `free` for the unpaid baseline while retaining `basic` only for future paid Basic compatibility. | Migration `20260527162000_restore_free_user_type.sql` restores `free`, preserves future paid Basic, and blocks paid Basic checkout with `paid_basic_future`. |
| 2026-05-15 | GitHub Actions maintenance | Closed. Artifact actions now run on Node 24-compatible versions. | Commit `1066ba6d` upgraded `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`; `CI - Test Audit` run `25944598514` passed without the prior Node 20 artifact annotation. |
| 2026-05-29 | STT onboarding and privacy copy | Superseded by current naming. Private setup and failure copy preserves privacy intent, avoids default fallback-to-other-mode language, and clarifies Cloud as a Pro feature. | Local focused Vitest: `LiveRecordingCard`, `StatusNotificationBar`, `TranscriptionService`, and `useSessionLifecycle` passed 40 tests. |
| 2026-05-29 | CORS origin parsing hardening | Closed locally. Shared Edge Function CORS now parses comma-separated `ALLOWED_ORIGIN` values and falls back to a single deterministic origin instead of a raw env string. | Local `deno check` and `_shared/cors.test.ts` passed. |
| 2026-05-29 | Stripe downgrade action naming | Closed locally. Webhook callers now send `downgrade_to_free`; the new migration preserves legacy `downgrade_to_basic` compatibility while writing the Free baseline. | Local `deno check` and `stripe-webhook/index.test.ts` passed. |
| 2026-05-30 | Session live coaching path | Closed. The non-live-coaching Session variant is obsolete; `SessionPage` always renders the live coaching rail and docs now treat live coaching as the current path. | Commit `127479bb`; local targeted Vitest 19/19, focused Playwright 20/20 and 12/12 passed. |
| 2026-05-30 | E2E auth/transcript harness alignment | Closed. E2E now seeds auth storage under the real Supabase project keys, rejects malformed fake sessions, and routes synthetic transcript events through the controller. | Commit `4747247b`; local focused Playwright 20/20 and auth/UI entitlement Vitest 28/28 passed. |
| 2026-06-03 | Session completion data integrity | Closed. A later rich-metrics update failure no longer downgrades an already completed transcript session to failed/unsaved. | Commit `66b340a4`; targeted Vitest `frontend/src/services/transcription/__tests__/SttSafeguards.test.ts` passed 11/11 and asserts `data-session-persisted="true"` after metrics update failure. |
| 2026-06-03 | Native explicit-Stop hard-stop guard (blocker #2) | Closed. Explicit Stop now freezes the Native transcript: a `stopRequested` flag set at the top of `onStop()` (before any await) and checked at the top of `onresult` drops the stopping cycle's trailing final AND any stray second recognition cycle (the post-Stop "Hey Dad" contamination); reset in `onStart()`. Internal stall-restarts use `recognition.stop()` directly so are unaffected. | Commit `2108851f` (`NativeBrowser.ts`); +3 regression tests, `NativeBrowser.test.ts` 42/42, `tsc --noEmit` clean. |
| 2026-06-03 | Native formatter model default (blocker #1, code) | Closed (code; latency proof pending). `FORMATTER_MODEL` default moved off the hung `gemini-3-flash-preview` to `gemini-3.5-flash`; env-overridable, 28s diagnostic timeout. Real <3s latency still needs a deployed-function human rerun. | Commit `d6bf8e44` (`format-transcript/index.ts`). |
| 2026-06-03 | Native trust-banner continuity (blocker #3) | Closed. Verified in code that Stop sets `isFinalizing=true` (freeze) before `isListening` flips false (STOPPING), so the finalizing banner takes over from the draft banner with no blank frame; Native/Cloud copy stays generic (never "locally"). Locked in with a rerender-sequence test (listening→drafting→finalizing→final). | Commit `d7796d43` (`LiveTranscriptPanel.component.test.tsx`); 23/23. |
| 2026-06-03 | Native detail transcript render hardening (#29/#4) | Closed (render-side). Detail view trim-guards the start-time `' '` placeholder (shows the "No transcript available" fallback instead of a blank panel) and exposes `data-session-detail-transcript` with the authoritative trimmed value so the next proof classifies a genuine save gap vs. a wrong-selector read. Full save+render trace confirmed the `complete_session` RPC persists `transcript`. | Commit `f4134f95` (`AnalyticsDashboard.tsx`); +2 tests, 18/18. |
| 2026-06-03 | Identity-bearing persisted-session marker (blocker #5) | Closed. `syncSessionPersisted` now also sets `data-session-persisted-id` (exact DB id) + `window.__SS_LAST_PERSISTED_SESSION__`, threaded through every success write and cleared on the next recording; registered in the e2e signal contract. Lets a proof read the id, open `/analytics/:id`, and verify `data-session-detail-transcript`. | Commit `4013f6f0` (`forensicAnchors.ts`, `SpeechRuntimeController.ts`, `signalContract.ts`); +4 unit tests. |
| 2026-06-03 | Dead SessionSidebar removal | Closed. `SessionSidebar.tsx` was unreferenced by production (no static/dynamic import, lazy route, or story) and carried a latent silent-save bug (`id: session_${Date.now()}` routed `saveSession` into the UPDATE branch against a phantom row). Deleted the component + its integration test. | Commit `8d57b6bf`; `tsc --noEmit` clean, integration + session component suites 113/113. |
| 2026-06-03 | Private detail/history journey root cause (#28) | Closed. The "stuck on Readying your experience" boundary was an **unbounded** `profileService.getById`: a hung fetch never settles, React Query's `retry` only fires on rejection, so `useUserProfile` stays `isLoading=true` and ProfileGuard wedges forever. Added `withFetchTimeout` (12s, injectable) so a hang→rejection→retry→actionable error screen. | Commit `69723f96` (`useUserProfile.ts`); +2 regression tests, `ProfileGuard` + `useUserProfile` suites green. |
| 2026-06-03 | Native formatter per-user cost guard (#35) | Closed. `consume_formatter_quota` was called with a degrade-open fallback but the RPC did not exist, so the guard never enforced anything. Added migration `20260603000000_formatter_daily_quota.sql` (`formatter_usage_daily` table + atomic SECURITY DEFINER RPC mirroring `consume_ai_suggestion_quota`) and env-overridable `FORMATTER_DAILY_LIMIT` (default 200). | Commit `28742394`; +3 Deno steps (exceeded→429, allowed→200, RPC-throws→degrade-open), Deno `index.test.ts` 19 steps pass. Also fixed a stale assertion expecting the retired `gemini-3-flash-preview`. |
| 2026-06-03 | Private STT Quality-Push Slice 1: timing telemetry | Closed (evidence surface). Added always-on `window.__PRIVATE_TIMING__` { timeToFirstProvisionalMs, timeToFirstFinalMs, finalizeDecodeMs, utteranceSeconds, peakBufferedSeconds, anchor } so proofs measure the real first-text/finalize bottleneck before any gate change. **Key finding:** the draft provisional is already emitted BEFORE local agreement (`PrivateWhisper` L1357-1472); `FIRST_TRANSCRIPT_LOCAL_AGREEMENT_ROUNDS=2` gates the first *committed* text, not the first visible draft — so a blind 2→1 would NOT lower `timeToFirstProvisionalMs` and would weaken committed stability vs. the streaming-Whisper LocalAgreement-2 standard. Registered in the e2e signal contract. | Commit `3b5d81ac`; pure `buildPrivateTimingSummary()` exported + unit-tested (PrivateWhisper suite 33/33; modes suite 146/146); `tsc` clean. Competitor research (Otter, Google Live Transcribe, Apple Voice Memos/SpeechAnalyzer, Descript, UFAL whisper_streaming) supports "show fast, correct quietly" + keep LocalAgreement-2 for committed text. |
| 2026-06-04 | Private setup/download consent | Closed by human proof. The Private proof stopped at `PRIVATE_SETUP_USER_ACTION_REQUIRED` with the visible `Set Up` button; the user clicked setup manually, the model initialized, and recording started. This replaces the earlier auto-click-contaminated evidence. | Artifact `/private/tmp/speaksharp-private-human-20260604-rerun.json[l]`; keep this explicit-consent behavior and do not auto-download. |
| 2026-06-03 | Mobile homepage hero CTA height | Closed. Product UX pass found the mobile hero CTAs rendered as 24-26px thin strips because `flex-1` was applied while the button stack was `flex-col`, causing the flex-basis to collapse the intended `h-14`. Changed hero CTAs to `w-full h-14` on mobile and `sm:flex-1` only in the row layout. | Visual proof: `/private/tmp/speaksharp-ux-review-mobile-home-cta-fixed.png`; computed hero CTA height now 56px. Focused landing tests passed 12/12 with 1 todo. |
| 2026-06-03 | Analytics zero-data proof isolation | Closed. The zero-data Analytics browser proof was contaminated by persisted seeded sessions because `setupE2EManifest` reused `__SS_E2E_SESSION_DB__` even when `emptySessions=true`. Empty-session proofs now force a hard empty session list so the empty-state UX is tested honestly. | Targeted empty-state Playwright 6/6 passed and focused Analytics browser suite 13/13 passed after the fix. |
| 2026-06-03 | Analytics custom-goal save resilience | Closed. Goal edits now remain locally saved even if remote Supabase goal sync fails, and the E2E Supabase mock implements the real `.from('user_goals').upsert(...).select().single()` contract. This prevents a scary background-failure toast from blocking a successful local goals update in the Analytics funnel. | Unit: `useGoals` + `AnalyticsDashboard` 24/24; `tsc --noEmit` clean; targeted custom-goals browser proof 6/6; broader funnel sweep 21/21. |
| 2026-06-03 | Custom filler-word browser proof contract | Closed. The custom filler-word browser proof failed because the E2E Supabase shim did not implement `user_filler_words` queries/inserts/deletes, so the app received a success-shaped mutation with no inserted row and could not display/manage the new custom word. The shim now mirrors the real table contract for add/remove flows. | Targeted custom-filler add/remove browser proof 6/6; full custom-filler browser file 7/7; combined primary/user-facing/errors/goals/custom-filler browser sweep 23/23. |
| 2026-06-03 | Startup diagnostic E2E bridge contract | Closed. The standalone startup diagnostic used bare `page` and loaded the test build without the centralized E2E manifest, correctly triggering the app guard `Mock auth is not available from the runtime app`. The diagnostic now installs `programmaticLoginWithRoutes` before exercising the canonical readiness path, so it validates boot readiness without weakening the runtime guard. | Isolated diagnostic rerun 6/6 passed; full `tests/e2e` browser sweep passed 38/38 after the fix. |
| 2026-06-04 | Session-to-Analytics coherence proof | Closed under automation. Session score, transcript-quality caveats, filler/readability signals, detail navigation, reload/export, and analytics outputs agree in targeted component/math and browser proofs. | Test-release branch merged; targeted Vitest 66/66, user-facing browser regression 9/9, analytics suite/truth 13/13. Human STT quality blockers still remain separate. |
| 2026-06-04 | Browser UX bug hunt | Closed under automation. Primary journeys, user features/history/detail, custom filler-word management, goal-setting analytics, and error states passed without a new reproducible automated UX bug. | Playwright subset 19/19. Known human-found STT issues remain active in the STT backlog. |
| 2026-06-04 | Cloud baseline local + deployed smoke proof | Closed for smoke. Baseline request/timing/provider contracts are verified, and current-head deployed app-path smoke passed. Full WER/tail/readability metrics are intentionally deferred behind Native/Private. | Cloud local stack 44/44. GitHub Actions run `26960691857` passed `1/1` against deployed Pro Cloud, with provider partial/final/terminated events, save, and analytics history. |

## Current Backlog

| Priority | Area | Issue | Impact | Recommended Action |
|---|---|---|---|---|
| P0 | Paid soft launch readiness | Reviewer moved the target from no-payment controlled beta to **paid soft launch**: real users may pay, but exposure stays limited and the product remains early-access/beta positioned. Current controlled-beta evidence is not enough to take money. Evidence/gate packet: `/private/tmp/TEST_PAID_SOFT_LAUNCH_READINESS_GATE_2026-06-08.md`; tracking matrix: `/private/tmp/PRODUCT_OPS_STRIPE_RUNTIME_CHECKLIST_2026-06-08.md`. Branch `paid-soft-launch-spine@26ccc1a1` implements the dev code spine: Stripe customer reuse, webhook customer-id persistence, Stripe billing portal endpoint, entitlement-truth checkout return copy, paid early-access/cancel/refund copy, and paid runtime proof wiring. Test-mode commercial-spine proof is now green: Deploy Supabase `27173632248` PASS on `6271d5b7`; Live Release Matrix `27173676657`, job `80218001042`, PASS with test-mode Checkout customer reuse, signed webhook entitlement/customer persistence, and Stripe billing portal creation; `CI - Test Audit` `27174779497` PASS on `26ccc1a1` (coverage, build, edge tests, unit shards, health check, Lighthouse advisory, E2E shards, report). | Taking payment raises the bar: billing, entitlement, cancellation/refunds/support, monitoring, and expectation-setting must work cleanly. The commercial spine is test-mode proven; the main remaining risk is live Stripe configuration and a final live-key proof with real payment/webhook/portal evidence. | Test verify/merge `paid-soft-launch-spine`, then track and close: Stripe activated under LLC; statement descriptor likely `SPEAKSHARP`; support email/contact set; `pk_live`, `sk_live`, live `whsec`, and live `price_...`; live checkout start/pay/return/plan visibility; webhook entitlement sync; paid features unlock only after entitlement; unpaid gating; Stripe billing portal for paid customer; refund/cancel policy visible; paid early-access copy without overclaiming; friendly failed/canceled payment copy; Sentry/PostHog/Supabase payment-failure visibility; checkout kill switch. Test: run production Paid Soft Launch Readiness Gate and return GO/NO-GO. |
| P1 | Private STT navigation resilience | Hard navigation/reload while Private is recording can lose the partial session and logs React `Maximum update depth exceeded`. In-app navigation with the confirmation accepted saves correctly, so this is specifically the hard-nav/unload path. Evidence: `/private/tmp/ux-private-navigation-interruption.json`; pass comparator `/private/tmp/ux-private-spa-navigation-accept-dialog.json`. | User can lose an active practice by typing a URL, reloading, browser back/forward, or any path that bypasses the SPA confirmation. That is a high-churn trust break even if normal in-app links are guarded. | @dev-agent: fix hard-nav/reload behavior by blocking reliably, saving/recovering a local draft, or preventing route replacement until Stop/save completes. Add a browser regression: start Private, verify partial text, hard-navigate/reload, and assert either recovered/saved evidence or an explicit block, with zero max-depth warnings. |
| P1 | Private STT state-machine resilience | Rapid Private Record/Stop recovers to `READY` with no zombie recording, but emits multiple React `Maximum update depth exceeded` console errors. Evidence: `/private/tmp/ux-private-rapid-start-stop.json`. | Even if the UI recovers in the test, render-loop warnings during mic control churn are exactly the class of instability that produced prior “mic click did nothing” user frustration. | @dev-agent: root-cause the start/stop cleanup/update dependency, then add a rapid-click regression that runs 5 short cycles with no max-depth warnings, no `Engine Frozen`/start-failure toast, and final `data-recording=false`. |
| P1 | Real-time Live Coaching Feedback guardrails | Live coaching is now the accepted Session path; remaining work is calibration/evidence, score persistence, and later layout refinement. | This is one of the highest-leverage UX improvements because it converts raw numbers into immediate practice behavior, but a poorly explained score could feel judgmental or arbitrary. | Complete the SpeakSharp Score v0.1 evidence work: score payload persistence plan, calibration set, and reviewer pass. Do not restore a no-coach Session variant. |
| P1 | Semantic AI Coaching proof | Product direction is now tracked in `PRODUCT_FEATURES.operational.md`; implementation proof still needs examples and tests that show coaching goes beyond pace/fillers into structure, vocabulary, audience impact, and next-practice drills. | Strongest near-term Pro retention lever after release evidence is clean. | Keep prompt categories explicit, add tests that assert semantic coaching instructions reach Gemini, and collect example outputs before broad launch. |
| P1 | Native STT claim evidence | Run a live human Native Browser STT pass before making any accuracy claim stronger than "instant, browser-dependent transcription." | Prevents overpromising the Free path and gives us evidence for onboarding copy, support notes, and competitor comparisons. | Use the planned human tester script with a known phrase, capture transcript/WER notes, browser/version, room condition, and whether the result supports or limits the claim. |
| P0 | Cloud baseline launch proof | Cloud baseline is the strongest paid quality path and should remain the launch default. | Without current app-level proof, we have strong provider/app signals but not a complete brag path with release-matrix fields. | Run Cloud baseline only unless product explicitly reopens variants; require live text, stop/save, history/detail, tail/readability, AI/PDF if in scope, and exact `__CLOUD_STT_TIMELINE__` fields before calling Cloud green. |
| P2 | Cloud AssemblyAI keyterms/prompt experiments | Keyterms and prompt variants are now request-valid, but keyterms improves filler recall while regressing h1_6 accuracy; prompt/u3-rt-pro changes cost. | Re-enabling unproven provider params by default can make transcript quality worse or product economics weaker. | Keep `streaming_ab_variants=baseline` as the workflow default. Revisit keyterms/prompt only as explicit experiments for custom-word boosting, with WER, filler recall, false insertions, close codes, tail, readability, and cost table. |
| P2/Post-launch | Live meeting overlay for Zoom / Google Meet / external calls | A lightweight overlay could bring SpeakSharp coaching into real meetings and presentation practice outside the app. | Valuable differentiated workflow, but not part of the current Native/Private/Cloud STT release gate and should not distract from parity, trust labels, save/detail, or formatter work. | Preserve as post-launch discovery: evaluate browser extension vs desktop overlay, permissions/privacy copy, supported platforms, STT mode choice, latency budget, transcript retention rules, and whether coaching appears during or after the call. |
| P0 | Private STT live timing and delayed finalization | Human Private tests showed little or no useful live transcript during speech; fuller text arrived long after Stop. | Private may eventually produce a decent final transcript, but the live transcription window feels broken and fails user expectations for a live STT mode. | Produce a timing trace with audio frame timestamps, decode start/end, model result, service callback, store update, UI visible text, and stop/final commit. Fix only boundaries proven by the trace. |
| P0 | Private STT app-vs-drop-in parity | Browser drop-in remains better than the app path on current evidence; app quality depends on rolling decode, gating, whole-utterance commit, and sanitizer behavior. | If the same browser/model/audio route performs better outside SpeakSharp, the app is degrading the engine and cannot be marketed as a high-quality Private STT path. | For h1_2, h1_6, h1_8, and a full 1-10 rerun, compare raw model output, post-filter output, visible UI transcript, selected save transcript, and detail transcript against the browser drop-in. |
| P1 | Native STT live-text regression proof | Latest human Native run reported no visible live text until Stop, while an earlier run showed live text and a strong Chrome final before app duplication. | Native may be viable as browser-dependent quick-start, but only if users see useful live progress instead of a stop-time dump. | Pull CDP/browser logs for Chrome `onresult`, service callback, controller/store update, and UI visible timestamps. Determine whether Chrome withheld interim text or SpeakSharp failed to render it. |
| P1 | Native STT punctuation/casing formatter | Native output still has weak punctuation/casing, including run-on sentences and odd capitalization such as `Starts Now`. | This is not the first launch blocker if Native is caveated, but it blocks any claim that Native produces polished transcripts. | **Shipped (raw-first async); proof + quality decision remain.** A trusted Gemini punctuation/casing restorer IS registered on the production Native path, word-preserving with raw fallback; proven functional in the 2026-06-03 real-mic run (`attempted=true, wordPreserving=true`). It no longer blocks Stop: `NativeBrowser.getTranscript()` returns RAW, and `nativeAsyncFormatter` formats in the BACKGROUND after save with a ~4s client budget, replacing the saved transcript only on a word-preserving change (`35d162b8`, `fcdd69d5`). Default model `gemini-2.5-flash-lite`. **Remaining (proof + product call, not "build"):** (1) real-mic proof that save/history/detail never wait and formatted readability improves; (2) decide raw-at-Stop readability sufficiency vs. an in-place local punctuation model (research done: small ONNX CNN-BiLSTM ~10–30MB removes the round-trip and would also unblock Private #32). Keep Native readability-caveated until the proof is green. |
| P1 | STT trust-label copy contract | Users must understand what text is provisional without being misled about where processing happens. | Wrong copy can break the Private privacy promise or falsely imply Native/Cloud are local. Glued labels also hurt accessibility and test extraction. | **Explicit copy rule:** Private may use local language only for real local states: `Listening locally…`, `Processing speech locally…`, `Finalizing local transcript…`; visible Private words remain labeled `Draft transcript` until final. Native and Cloud must never say `local/locally`; use `Draft transcript`, `Processing transcript…`, `Finalizing transcript…`, and `Final transcript`. Prior proof found a spacing/accessibility bug: `Draft transcriptText may change...`; current `main` includes spacing fix `cd4b677d` and clean scrape surface `data-transcript-text-only`. TEST should re-proof current `main`; DEV acts only if it still reproduces. |
| P1 | Private STT CPU speed via cross-origin isolation | Multi-threaded WASM (the only CPU speedup for no-WebGPU users, since cloud fallback is prohibited by the privacy promise) requires `crossOriginIsolated === true`, which needs COOP/COEP headers. `frontend/vite.config.mjs` removed those headers with the note "they block Stripe.js and other third-party resources", but the app no longer embeds Stripe.js — checkout is a server-created redirect (`window.location.href = data.checkoutUrl` in `PricingPage.tsx`/`AnalyticsPage.tsx`/`Navigation.tsx`) and there is no `@stripe/stripe-js`/`loadStripe`/Elements and no `stripe` npm dependency. The original blocker appears stale. The P3 WASM-threads change (`transformers-js.worker.ts`) already guards on `crossOriginIsolated` and is a safe no-op until isolation is enabled. | For no-WebGPU users (the WebGPU fix does nothing for them), single-threaded CPU Whisper is the slow 13–43s path. Re-enabling isolation would activate multi-threading and is likely the only in-product speedup available to them. | Investigate (do NOT flip blind): (1) confirm via git history why COOP/COEP were removed and whether it predates the redirect-checkout migration; (2) re-enable `COOP: same-origin` + `COEP: credentialless` (the lenient mode `serve-e2e.mjs` already uses) in dev/preview/prod vite config; (3) smoke-test every cross-origin third-party under isolation — Stripe redirect, Supabase, PostHog, Sentry, Gemini, fonts/images; (4) confirm `crossOriginIsolated === true` in the worker so P3 activates, then benchmark CPU decode before/after. Decision owner: confirm the Stripe constraint is truly obsolete before shipping. **Acceptance criteria (all must pass in a production-like build before enabling):** `crossOriginIsolated === true`; Supabase auth/data works; Sentry reports; PostHog captures; Stripe hosted-checkout redirect completes; model assets (`/models/...`) load; fonts/images load; the transcription worker logs `device: 'wasm-multithread'` with `threads > 1` (now emitted in the `loaded` telemetry); and CPU decode time improves materially vs single-thread baseline. If any third-party breaks under `COEP: credentialless`, do not ship isolation. |
| P1 | ❌ OBSOLETE — Private STT WebGPU turbo enablement UX | Superseded by BLOAT-TURBO-ASSETS: whisper-turbo (WebGPU) was retired in `dev/release-closure@2b928fd9`. There is no longer a turbo engine or model to enable; Private is CPU-only (`transformers-js`). | n/a — turbo removed. | Closed. If GPU acceleration is revisited post-beta it must target `transformers-js-v4` (WebGPU) via `webgpuSupport.ts`, not the retired turbo engine — track as a fresh item then. |
| P1 | Native first-session transcript responsiveness | A Free user's first Browser transcription session must show clear live progress or a useful recovery message if the browser hears speech but withholds transcript results. | A silent transcript panel during recording feels broken even if text appears after Stop; it damages the Free return loop and any Native accuracy claim. | Add a targeted live/harness test for long initial silence followed by speech, then harden Native recovery/status messaging so users are not left staring at an empty transcript. |
| P1 | Production environment safety evidence | Manual profile login and entitlement paths no longer use `devBypass` or `VITE_DEV_USER`; remaining production evidence must prove internal routes are disabled and the production build uses real auth/profile state. | A leaked preview or misconfigured production env could make admin behavior look wrong and undermine launch confidence even if source code is safe. | Before RC tag, verify Vercel production has `VITE_ENABLE_INTERNAL_ROUTES` absent or false and document that `devBypass`/`VITE_DEV_USER` no longer grant app access. |
| P1 | Manual auth/profile truth | Manual testing exposed that fake local auth could show `PRO dev@speaksharp.app` while backend usage and Cloud token calls rejected the session. Source and tests now reject malformed fake sessions and keep Cloud disabled without real Cloud entitlement. | Users should never think about credential state after login; profile, usage, entitlement policy, and UI controls must agree. | Re-test with real Free/sample/Pro credentials only, then close this as live evidence. Keep manual app paths real-auth only. |
| P1 | Morning manual STT bug ledger | The May 30 manual STT run exposed a broad set of launch bugs: auth pollution, Cloud gating copy, Native bulk transcript dump, transcript disappearance after stop, Private setup ambiguity, analytics permission failure, and post-session navigation gaps. | This is the highest-signal human tester evidence so far; losing any item would create repeat churn or invalid evidence. | Work from the May 30 bug ledger before declaring RC-ready: close P0/P1 auth/profile/STT persistence items first, then analytics narrative and UI polish. |
| P1 | Live database entitlement evidence | Local migrations restore the Free baseline, retire legacy trial-as-Pro behavior, and add a server-backed Private sample. | If production DB lags code, Free/sample/Pro entitlement behavior can drift from the product promise and create confusing access or revenue leakage. | Verify live `update_user_usage(INT, TEXT, UUID)` does not write `subscription_status = 'basic'`, `effective_subscription_tier` ignores legacy trial timestamps, Free/Basic tier configs are Browser-only, and unpaid Private is capped by `private_sample_*` fields. |
| P1 | SLO/SLC evidence before RC tag | Service-level evidence can go stale quickly as CI and endurance fixes land. | Calling a commit release-ready without fresh evidence on the same SHA weakens the RC signal and makes support claims harder to defend. | After latest CI/deploy/canary are green, dispatch Service-Level Evidence, archive the generated artifacts, update `QUALITY_METRICS.md`/service-level evidence pointers, then run RC gates on the same SHA. |
| P1 | Stripe live-key cutover | Current billing evidence is intentionally test-mode/sandbox. Test-mode proof passed on `paid-soft-launch-spine@6271d5b7` (`27173676657`): Stripe test price active, Checkout customer reuse, signed webhook entitlement/customer persistence, and billing portal URL. Normal branch CI passed on current branch head `paid-soft-launch-spine@26ccc1a1` (`27174779497`). Production Pro checkout still needs live key, live price, live webhook proof, and live billing-portal proof after `paid-soft-launch-spine` merges. | Paid soft launch cannot rely on test-mode Stripe evidence for actual charging, but the code path is proven before live keys. | After `paid-soft-launch-spine` is verified/merged and deploy is green, configure live Stripe env vars, run one controlled live Pro checkout/webhook/portal entitlement proof, verify `cs_live_...`, then cancel/refund as needed and record evidence in the paid-soft-launch ledger. |
| P1 | Stripe customer identity persistence | Implemented and test-mode proven on branch `paid-soft-launch-spine@26ccc1a1`: checkout reads `stripe_customer_id`, passes `customer` when available, falls back to `customer_email` only for first checkout, webhook passes `p_stripe_customer_id`, and migration stores it on paid activation/upgrade. | Closes the duplicate-customer/customer-portal dev gap once merged and deployed. | Test verify/merge branch, then repeat the proof with live Stripe configuration. |
| P1 | AI suggestions server-side quota | `get-ai-suggestions` caches per saved session but has no server-side per-user request ceiling. | Client-side throttles can be bypassed; a trial/pro user could script repeated Gemini calls and burn quota or cost. | Add a database-backed hourly/daily AI suggestion counter or equivalent API-gateway limit, return an explicit 429-style response, and include the limit in service-level/evidence docs. |
| P1 | Session save and draft recovery | Route-exit teardown now stops recording before destroying the session, but failed session completion still lacks a durable retry/draft recovery path. | Losing or nearly losing a long practice session is a high-churn event for Free and Pro users. | Design a persistent local draft/retry path for transcript/session completion failures; keep it separate from RC safety patches unless fresh testing shows active data loss. |
| P2 | Ergonomic information architecture review | Core pages are functional, but the product has not had a formal "can a first-time user find the next obvious thing?" pass across Session, Analytics, Pricing, Auth, and Home. | Confusing placement or hidden next actions can make an otherwise useful product feel harder than it is. | Run a page-by-page task map for recording, saving, reviewing, exporting, changing mode, seeing goals, and upgrading. Keep actions in expected locations and remove layout surprises. |
| P0 | Private sample entitlement #85 | Replaces the old 60-minute Private trial with one server-backed unpaid Private sample session capped at 5 minutes. | Private is the paid conversion wedge; client-only timers or stale trial copy could leak paid value or confuse first-time users. | Branch `test/private-sample-entitlement` implements DB-backed sample fields, one-session enforcement, sample copy, and updated tests/docs. Remaining closure requires Supabase apply/idempotency plus app-path proof on a real stack. |
| P2 | CI performance | Split setup actions into minimal paths: `setup-node-pnpm`, `setup-playwright`, `setup-supabase`, `setup-deno-edge`, and `setup-report`. | CI Audit can exceed the improved target when edge/report setup drags, slowing iteration without implying product failure. | Optimize after release correctness gates are green. |
| P2 | Workflow consolidation | Previously, `create-user.yml`, `query-users.yml`, and `setup-test-users.yml` split test-user administration across three workflows. | Some evidence could be mislabeled if admin-created accounts were confused with public signup/trial evidence. | Consolidated into `setup-test-users.yml` as `Test User Admin` with `setup`, `query`, and `create` actions. |
| P2 | RC/CI reporting performance | Final report aggregation and RC Gate 3 setup can take longer than the actual product test work. | Slows release feedback even when all product gates are green. | Include report-job minimization in the CI setup split: install only report dependencies and avoid unnecessary Playwright/Supabase setup for report-only work. |
| P2 | Session UI polish | Session page still has post-release polish opportunities around exact hierarchy density, mobile screenshots, and final visual tuning beyond the controlled-tester flow. | The page can be improved, but current controlled desktop tester gates are no longer blocked by Session layout/status. | Schedule after controlled-tester release. Keep any follow-up visual work separate from STT lifecycle changes and validate with screenshots. |
| P2 | Manual mic proof environment | Agent-run Chrome CDP evidence is not the same as a normal human speaking into a physical mic. | Public-launch claims should not overstate CDP proof as `manual-real-mic`. | Keep evidence labels explicit. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
| P2 | Manual validation tooling | During the Free/Pro live walkthrough, the Codex in-app browser became wedged on `/session`; navigation away and creating a clean tab timed out at `about:blank`. A later dedicated Chrome CDP session on port `9222` allowed Free and Pro UI operation, but it still needs clear evidence labeling because Chrome was launched with mic permission auto-allow and speech stimulus came from macOS `say`. | Tool choice can change the apparent STT result, and mislabeled evidence can create false confidence or false blockers. | Prefer the dedicated Chrome CDP session for agent-operated live UI checks. Label evidence as `Chrome CDP live UI`, include account source, media setup, and artifact paths. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
| P2/P3 | Security hygiene — CORS origin matching (before broad public launch) | `backend/supabase/functions/_shared/cors.ts` allows any origin **containing** `localhost`/`127.0.0.1` (substring `.includes`, line 38) and any origin ending in `speaksharp.ai` (`origin.endsWith("speaksharp.ai")`, line 66 — also matches a hostile attacker-owned domain like `evil-speaksharp.ai`). Confirmed real (independent main-branch review + dev verification 2026-06-17). | NOT a controlled-tester blocker: the function emits **no** `Access-Control-Allow-Credentials`, and auth-gated endpoints still require bearer credentials, so origin reflection alone cannot ride a user's session. Still prudent to tighten before broad public launch. | Tighten to **exact-host** matching: parse the Origin and allow `localhost`/`127.0.0.1` only as the exact host (any port); match `speaksharp.ai` as the exact host or a true dot-boundary subdomain (`*.speaksharp.ai`), not a suffix. Add a unit test that rejects `evil-speaksharp.ai` and `evil-localhost.com`. ~10-line change; do NOT insert into the immediate signoff path (new SHA → rerun all gates). |

## Current STT Backlog

Current source of truth:

```text
product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json
```

| Priority | Task | Engine | Current evidence | Owner |
|---|---|---|---|---|
| P0 | Fix Private content loss/substitution | Private | Human proof: 56.36% accuracy; expected `the main idea is that every transcript`, saved `the memory transcript`; saved 39/55 words. | @dev-agent |
| P0 | Fix Private first-visible draft/progress gating | Private | Chunks decoded every ~1.4-2.1s, but logs repeatedly showed `Holding first transcript until it has speech-like substance`; useful text appeared at Stop. | @dev-agent |
| P0 | Prove any Private Fix-A-v2/VAD/model candidate against release bar | Private | Product clarified that Fix-A-v2 is only an interim RMS patch, VAD is the intended flagged architecture path, and Private must compare against same-model/drop-in plus Native human baseline. | @dev-agent implements named candidate; test-release-agent reruns proof matrix |
| P0 | Re-proof #29 detail transcript fix | Native + Private | Dev merged cache-invalidation fix `72cabe45`; prior human artifacts predate the proof. | test-release-agent / Codex |
| P1 | Re-proof Native truecasing/readability | Native | Dev reports true-casing instruction shipped; prior artifact still had `Starts Now`. Verify current main before assigning more code. | test-release-agent / Codex |
| P1 | Re-proof trust-label spacing/accessibility | Native/Cloud + shared transcript panel | Dev merged spacing fix `cd4b677d` and `data-transcript-text-only` exists; latest Cloud smoke was pre-fix. Verify current main before assigning more code. | test-release-agent / Codex |
| P1 | Rerun Native real-mic proof on current main | Native | Browser-support matrix smoke now passes on `dev/release-closure@51bbf04e`: `/private/tmp/TEST_NATIVE_BROWSER_MATRIX_CURRENT_2026-06-08.md` and `/private/tmp/native-browser-matrix-current-51bbf04e.json` show Chromium has SpeechRecognition, Firefox lacks it and gets Private-routing compatibility copy, and WebKit exposes SpeechRecognition. In-app browser attempt `/private/tmp/TEST_IN_APP_BROWSER_NATIVE_MIC_UNSUPPORTED_2026-06-08.md` is INVALID for Native mic proof because that browser surface lacks both `navigator.mediaDevices.getUserMedia` and `SpeechRecognition`. Real Chrome/CDP freeform proof `/private/tmp/TEST_NATIVE_REAL_MIC_FREEFORM_RUNTIME_PROOF_2026-06-08.md` PASS for runtime health: Native started/stopped/saved, no scary "Engine Frozen" text, no `format-transcript` edge call, deterministic formatter ran with `fallbackToRaw=false`. Remaining if product wants quality scoring: scripted Chrome mic run with known target transcript and detail equality check. | test-release-agent / Codex |
| P1 | Rerun Private human proof on current main | Private | Must verify explicit setup remains, cumulative draft text, improved accuracy, filler recall, Fix-A-v2 behavior, and detail equality. | test-release-agent / Codex |
| P2 | Run richer Cloud baseline metrics proof | Cloud | Current-head deployed smoke passed (`26960691857`, `1/1`); collect full timeline, tail/readability, WER, and clean transcript-only evidence after Native/Private are less blocked. | test-release-agent / Codex |
| P2 | Keep stale deploy chunk recovery on radar | Whole app / STT funnel | Prior proof showed generic `Oops` for stale dynamic import chunk; not retested in current human proofs. | @dev-agent if still reproducible |
| P2 | Entitlement policy semantics split across writers (unify before broad rollout) | Private (STT policy) | **ACCEPTED RELEASE RISK if the safe subset lands or is explicitly tracked (release-owner 2026-06-17, Option A). NOT a release blocker.** `TranscriptionProvider.tsx:87` builds the controller policy from raw Pro tier (`isPro`); `useSessionLifecycle.ts:273/566` and the nested `useSpeechRecognition_prod.ts:113` differ on capability — all write the same singleton `speechRuntimeController`. For a free user with a valid private sample, the tier-only writers would compute `allowPrivate=false`. **Refuted as active revocation** (proven 2026-06-17): `SpeechRuntimeController.startRecording` overwrites the stored policy with the lifecycle's sample-aware policy at record time, the provider's resync re-fires only on profile-tier fields (not mode/record/sample state) + dedups, and the green `live-release-matrix` (run 27474247308) ran AFTER the divergence (#775) exercising `first-time-tester-private-trial` (free-sample records+saves Private) and the RC Gate-3 `stt-switching-contract` free-sample case. **Safe subset DONE on branch `refactor/policy-capability-param-naming`:** renamed `buildPolicyForUser(isProUser → hasPrivateSttAccess)` (no runtime change), added regression guards (`TranscriptionPolicy.test.ts` + `SpeechRuntimeController.test.ts`), and inline-commented the tier-only writers. **DEFERRED full unify (before broad rollout):** make every writer derive from one capability source (`isPro || hasPrivateSampleEntitlement`) — requires the provider to consume `useUsageLimit` (new data dependency + changed re-fire trigger), so it is NOT a release-window change. Do NOT "fix" by passing raw `isPro` everywhere (regresses the sample feature). Context: `/private/tmp/PRIVATE_SAMPLE_POLICY_DIVERGENCE_WRITEUP_2026-06-17.md`. | @dev-agent (full unify post-launch) |
| P2 (post-launch) | v4 accuracy benchmarking — sequenced, NOT a release blocker | Private (v2 + v4) | **DEFERRED post-launch (release-owner 2026-06-17, "correct + backlog"). Do NOT block readiness on this.** The v4 "Node clean-decode ceiling" (~98.85%) is **historical prose only** and **currently unreproducible in-repo**: the v4 Node harness `scripts/dev/private-v2-v4-node-compare.mts` was deleted in commit `f970c67a`, and `scripts/benchmark-whisper-ceiling.mts` is v2 tiny.en only. It is **NOT a release gate**. Reproducible current v4 facts now live in `tests/STT_BENCHMARKS.json` → `engines.Private.v4.reproducible_evidence` (WebGPU floors base_q4 83.91% / distil_q4 88.51%; Gate 2 app-path WER 0 on h1_6 with journey/persist/detail passed; Gate B/PostHog selection via `posthog_flag` + sessions saved). **Sequence:** (1) rebuild the v4 Node ceiling harness (`@huggingface/transformers`, base_q4/distil_q4, CPU device); (2) run Harvard fixtures for base_q4/distil_q4; (3) OPTIONAL apples-to-apples LibriSpeech calibration (`base.en` should reproduce ≈95.8%; a ~98.85% reading would indicate lenient scoring to fix); (4) ONLY THEN consider a customer-facing accuracy comparison. Context: `_measurement_framing` + `/private/tmp/STT_VENDOR_VS_MEASURED_OPTIONS.md`. | @dev-agent (post-launch) |

## May 30 Manual STT Live-Test Ledger

| Priority | Finding | Current Status | Follow-up |
|---|---|---|---|
| P0 | Fake `devBypass`/local auth showed `PRO dev@speaksharp.app` while backend calls rejected the token. | Fixed and committed: manual auth/profile paths no longer create or rescue fake Pro profiles; malformed stored sessions are ignored before backend requests. | Re-test with real Free/sample/Pro credentials only. Local auth regression tests passed 10/10 on May 30. |
| P0 | Cloud mode was selectable but start failed with "requires authentication" while the UI showed signed-in Pro. | Code path fixed/covered: Cloud entitlement is computed from real profile + Cloud entitlement only, the dropdown disables Cloud without `canUseCloudStt`, and manual fake auth no longer grants Cloud. | Re-test Cloud with a real Pro account that has `stripe_subscription_id` or `subscription_id`. Local Session/recording UI entitlement tests passed 18/18 on May 30. |
| P0 | Analytics displayed raw Supabase URL and `permission denied for table sessions`. | Fixed locally: session fetch errors and Analytics error UI now show sanitized recovery copy; new migration grants authenticated table privileges while RLS keeps owner isolation. | Deploy/verify migration in live DB. |
| P0 | Error boundary exposed `Cannot access 'privateModelStatus' before initialization`. | Fixed locally: initialization order corrected and app/global error boundaries no longer show raw exception messages. | Keep focused regression tests in quality lane. |
| P1 | Native transcript appeared as a bulk dump at stop, then visible transcript disappeared. | Partially fixed locally: transcript projection now preserves live partial text, promotes final text, clears stale partials, and capitalizes the first visible letter. | Add/collect live Chrome evidence for initial silence followed by speech. |
| P1 | First letter of transcript must be capitalized. | Fixed locally in speech-recognition utils, session store projection, and final transcript controller path. | Keep regression tests in quality lane. |
| P1 | Private setup CTA looked ambiguous and duplicate "setup needed" confused the mic area. | Known UX issue; Session layout is frozen per product direction for now. | Revisit only after current functional bug batch is stable. |
| P1 | Profile sync failure led to Refresh App / Retry Sync / Sign Out friction; Refresh App could feel like logout. | Fixed locally: recovery now defaults to Retry Sync and removes the hard-refresh action from the profile failure panel. | Re-test with a real interrupted profile request after auth cleanup lands. |
| P1 | Cloud STT could not be manually proven because account/session state was polluted. | Still open as evidence, not policy theory. | Use real Pro account and preserved console logging after auth cleanup lands. |
| P2 | Missing commas/periods and sentence punctuation quality in Native transcript. | Backlog only. Do not ship custom regex punctuation/casing in the Native hot path; use a trusted punctuation restoration API/model or provider-supported formatting path before claiming this fixed. | Capture Native punctuation/casing defects in evidence, then evaluate a trusted off-the-shelf formatter separately from STT lifecycle and duplication fixes. |
| P1 | (Independent review F2, DEV-partially-confirmed) Private `utteranceAudioChunks` resets at utterance/reset boundaries; there is **no sliding-window overlap across utterances**, unlike drop-in harnesses that feed overlapping/preceding context. Plausible cause of boundary phoneme mutation (e.g. "chewed up"→"tune up") and a likely facet of the open v2 app-vs-drop-in parity gap. | ✅ **RESOLVED — hypothesis REFUTED by decode architecture (2026-06-14).** Verified in `PrivateWhisper.ts`: `utteranceAudioChunks` resets ONLY at lifecycle points (constructor L823, recording-start L942) — never mid-stream — so the whole speech window accumulates (`appendUtteranceAudio`). The saved transcript (`commitWholeUtteranceTranscript` L2114) concatenates the FULL buffer (L2129) and the engine decodes it with transformers.js `chunk_length_s=30s` + `stride_length_s=5s` overlap (TransformersJSEngine L452-453 / v4 L88-89) whenever audio ≥ window. The overlapping sliding-window context the hypothesis claimed missing ALREADY EXISTS in the saved path; only the provisional/streaming display uses `stride=0` and is replaced by the final commit. NOT addressed by #789 (different defect) and not needed — no non-overlapping cross-utterance seam exists in saved output. | Closed (no pipeline change). Any residual boundary-word errors are model/stride-seam accuracy, addressed by the post-release neural-VAD Phase-2 workstream below, not a windowing-overlap fix. |
| — | (Independent review F1 & F4 — REVIEWED, REFUTED by DEV, no action) F1 "audio DSP distortion by default": FALSE — product default is `RAW_AUDIO_CONSTRAINTS` (echo/noise/AGC **off**); DSP-on is a **test-only** opt-in (`?privateMicConstraints=default`), surfaced in `__PRIVATE_MIC_CONSTRAINTS_DEBUG__.mode`. F4 "stop-tail silence bypass → hallucination": MOSTLY FALSE — low-energy forced tail is **dropped before inference** (`PrivateWhisper.ts:1162`), tiny/unsupported tails dropped (1471/1490), and the forced tail is fallback-only behind the whole-utterance commit (1678). | Closed (no defect). | TEST may confirm via proof artifacts: `__PRIVATE_MIC_CONSTRAINTS_DEBUG__.mode === 'raw'` in default runs; no low-energy tail decode in the Private timeline. |
| P2 | (#34) Segment-level transcript trust model: render `finalSegments[]` + `activeDraftSegment` + `finalizingSegment` instead of one whole-panel Draft (better for half-page speeches). | Deferred design — release-owner: explicitly NOT a 24h blocker; whole-panel Draft is acceptable short-term. | Design post-release; no code this release. Moved here from Dev task #34 when the tracker was cleared to zero (2026-06-14). |

## Deferred Feature — No-Concurrent-Recording / Recording-Lease (#794)

**Status: DEFERRED to post-release (release-owner decision). Dormant server plumbing retained on `main`, inert, and guarded. Finished off / closed out 2026-06-14.**

- Decision: do NOT ship no-concurrent-recording this release. It needs a dedicated recording-lifecycle proof cycle (lease acquire/renew/release + takeover UX + multi-tab/multi-device races) — out of scope now.
- On `main` (dormant, **zero user impact**): DB migration `backend/supabase/migrations/20260607040000_active_recording_lease.sql` + `frontend/src/services/recordingLeasePolicy.ts` (pure policy). **No runtime/client references** — verified grep-clean (only the policy file's own definition, its unit test, and the release contract test reference it).
- Guarded: `tests/release/recording-lease-contract.test.ts` + `recordingLeasePolicy.test.ts` (**12/12 green 2026-06-14**) lock the dormant contract so it cannot silently activate or drift.
- Client lease/takeover branches were NOT merged; notes + recovery SHAs were captured before branch deletion.
- To resume later: build the client lease controller + takeover UX against the existing policy/migration, behind a flag, with a full lifecycle proof. Until then: no action — leave dormant.

## DEV OWNERSHIP — Accuracy / Efficiency / Performance workstream (owner: dev-agent / claude)

Claiming the A/E/P STT optimization workstream. **Owner: dev-agent (claude).** Items I am taking:

| Item | Domain | Status (owner: dev-agent) |
| --- | --- | --- |
| **F2 / #37** Private cross-utterance audio overlap (no sliding-window context across utterances → boundary phoneme mutation, e.g. "chewed up"→"tune up") | **Accuracy** | ✅ RESOLVED — REFUTED by decode architecture (2026-06-14): buffer never resets mid-stream + final saved decode already uses transformers.js `stride_length_s=5s` overlap over the whole window. No non-overlapping seam exists; no change warranted. Residual boundary errors → post-release VAD Phase-2 below |
| **F5 / #36** provisional length-bias selecting hallucinations | **Accuracy** | ✅ DONE (merged `24d719e3`) |
| **F3 / #38** asterisk sanitizer length cap | **Accuracy/cleanliness** | ✅ DONE (merged `24d719e3`) |
| **Private v2 app-vs-drop-in parity** (browser `63.22%` < drop-in) | **Accuracy** | DEV fixes the exact boundary once TEST's clean capture isolates it (resampler already exonerated by DEV) |
| **Private v4 runtime** (`invalid data location: undefined for input "a"`) | **Accuracy + Efficiency** (unlocks faster v4 path) | ⏸️ ON HOLD per owner — WIP on branch `fix/v4-runtime-q8-decoder`; resume on signal |
| **Native formatter cost/volume guard / #35** | **Efficiency/cost** | ✅ DONE (merged `28742394`) |
| **Private post-Stop finalize latency** | **Performance** | ✅ already reduced (status-before-wait + bounded final-decode window); reverify after #37 |
| **NEW: A/E/P hot-path audit** (audio capture → resample → chunk → decode → commit → display) for accuracy/efficiency/perf defects | **All three** | 🔍 DEV — scoping next; findings will be added here with owner=dev-agent |
| **Phase 2: Replace RMS heuristics with neural VAD (post-release)** — retire Fix-A/RMS silence-gating in favor of Silero VAD (`@ricky0123/vad-web`); prove against the worst rows | **Accuracy** | 🔭 POST-RELEASE / branch-flagged — prototype behind a flag, run RMS-vs-VAD side-by-side on the worst rows (h1_6, the human-failure script, the v2 app-vs-drop-in parity gap), and replace heuristics only if VAD beats RMS with **zero guard-row regression**. Do not ship before release. |
| **v4 streaming→committed DUPLICATION + onset (regression of #87/#88, #7)** — saved v4 transcript concatenates the garbled provisional/streaming pass AND the clean final pass (browser evidence 2026-06-15: **142 words vs 87 reference** → WER garbage 51.72% base / −17.24% distil), and drops the first ~2 sentences (onset). The clean second pass ≈ Dev Node ceiling (98.85%), so this is the app-path defect that destroys the score, NOT the model. | **Accuracy (BLOCKER for v4 A/B)** | 🔧 DEV — open. Fix the streaming→committed de-dup (replace-vs-append at `SpeechRuntimeController.ts` ~1273 `hasProviderFullTranscriptPrefix`) + onset truncation, with a regression test; then hand Test a fixed build to re-benchmark. Likely v4-specific (v2 doesn't duplicate) — the v2-base sanity control (#811) will confirm. |
| **Clean in-browser decode probe → Node-ceiling equivalent** — there is no browser harness that decodes one full WAV through the v4 worker on WebGPU and reads the RAW transcript bypassing `SpeechRuntimeController` (the old `v4-decode-probe.html` was deleted). Without it, every browser number is app-path (controller in the loop), so it cannot be compared apples-to-apples to the Dev Node one-shot ceilings (v2-base 100%, v4-base/distil 98.85%; `/private/tmp/DEV_CLEAN_CEILINGS.md`). | **Accuracy validation tooling** | 🔭 DEV — backlog (added 2026-06-15 per release-owner). Build a Playwright `clean-decode-*.live.spec.ts` (or dev-only probe route) that: single full-WAV decode via the v4 worker on WebGPU + v2 engine on WASM, read worker transcript directly (no controller/streaming/save), WER vs `HARVARD_FULL`. Isolates WebGPU-q4 model+runtime from the controller-merge bug above. Then Test runs it the same turnkey way. |

TEST has overall jurisdiction to confirm app behavior; DEV (claude) owns the code fixes above and will
hand each back with regression tests for browser/human validation.

---

## Release Closure — Consolidated Findings Inventory + Lanes (2026-06-08)

**Status: INVENTORY ONLY — no fixes applied.** Consolidates the dev independent review
(`/private/tmp/DEV_INDEPENDENT_RELEASE_REVIEW_2026-06-08.md`), the test bloat inventory
(`/private/tmp/release-bloat-inventory-2026-06-08.md` + the section above), and the dev 2nd-pass
disposition (`/private/tmp/DEV_2ND_PASS_DISPOSITION_2026-06-08.md`). Both agents agree on the
important items. **Do not start broad bloat deletion or depcheck cleanup before Lane 1.** Every finding
is forced into exactly one lane.

**Executive call: NO-GO until Lane 1 is resolved** — but not because the app source is broadly messy
(it's clean: 0 `console.*`, 0 `@ts-ignore`/`eslint-disable`, 0 `debugger`, 0 `.only`, 0 empty catches in
`frontend/src`). Risk is concentrated in config/secrets, test-fixture integrity, customer-facing dead
states, the no-HF fallback hole, and a dead operational function.

### Historical Lane Snapshot — Superseded By Current Rows Above

The original Lane 1/2/3 inventory below is retained as an audit trail for what was found during the
root-canal review. **Do not use this snapshot as current status.** Current closure status lives in the
`Release Bloat / Dead-Weight Inventory`, `Open Beta Closeout Findings`, and `/private/tmp/ACTIVE_COORDINATION.md`
rows above. Items listed below as actions may already be closed in the current rows.

### Historical Lane 1 — Original Release Blockers

| # | ID | Finding | Evidence | Disposition / action | Owner | Found by |
|---|---|---|---|---|---|---|
| 1 | SECURITY-SECRETS | ✅ RESOLVED — **false alarm / misclassification** (owner ruling 2026-06-08). Original finding: tracked `.env.test` (root) + `frontend/.env.test` held entries *named* `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ASSEMBLYAI_API_KEY`, test passwords. | Re-examined: all 23 historical `.env.test` versions held **mock** values (`sk_test_mock`, `whsec_mock`, sub-real-length JWTs). Full-tree/full-history pickaxe (`/private/tmp/DEV_SECRET_HISTORY_SCAN_2026-06-08.md`; 3231 commits, 30 branches, 10 tags) → **no real secret ever committed** (2 hits, both benign). | **NOT an incident → no rotation, no history purge.** Repo hygiene done (`git rm --cached` both, root `.env.test.example` added, `.gitignore` confirmed, `rc-secret-scan.mjs` hardened, `rc:sast:secrets` PASS). Real secrets live only in GitHub, never committed. | product/ops (ruled fake) | dev + test |
| 2 | AUDIO-FIXTURES | `tests/fixtures/jfk_16k.wav` and `test-audio.wav` are **HTML, not WAV** → can validate STT against HTML bytes (false-green). | `file` → "HTML document text"; no RIFF/WAVE header. | Replace with real WAV; add fixture sanity test (RIFF + WAVE + nonzero duration + sample rate); mark prior proofs depending on them INVALID; STT harness precheck before scoring. | dev + test | both |
| 3 | NO-HF-FALLBACK | Main-thread Private fallback hardcodes `whisper-tiny.en` and, on local-load failure, sets `allowRemoteModels=true` + loads `Xenova/whisper-tiny.en` from Hugging Face; DEFAULT model fallbackPath = `local-then-remote`. Contradicts no-HF/self-host + base-default. | `TransformersJSEngine.ts` l.253/273/276/590. | **Recommend strict no-HF for beta:** selected-model-aware main-thread fallback, `allowRemoteModels=false`, clear "local model unavailable" error, add test that blocks/detects HF domains. (Alt: accept HF resilience → soften the no-HF claim.) | dev (+ product policy) | test only |
| 4 | UX-ENGINE-FROZEN | "Speech recognition is taking a moment (Engine Frozen)" fires during *healthy* Native recognition → trust hit. | `TranscriptionService.ts:1591`. | Native-aware watchdog (interim activity = alive); only warn on a confirmed stall; safer copy. | dev | both |
| 5 | UX-PAYMENT-CTAS | Upgrade CTAs render when payments disabled and no-op/link to dead pricing: AnalyticsPage button renders ungated (handler silently returns), `AnalyticsDashboard` secondary, `SunsetModals` → `/pricing`. | `AnalyticsPage.tsx` l.62 render vs l.128 handler-gate; `SunsetModals.tsx` l.44/72/89. | **Render-gate** every upgrade/payment CTA on `arePaymentsEnabled()` (not just the handler); else relabel "Premium features coming soon". No dead buttons. Public checkout only if `stripeKeyClass==='live'`. | dev | both |
| 6 | FIX-RLS-DELETE | `backend/supabase/functions/fix-rls` — dead stub: wildcard CORS (`*`), unused service-role client, "use dashboard SQL"; **not in deploy workflow**. | function body; `deploy-supabase-migrations.yml` does NOT list `fix-rls`. | Delete (confirmed undeployed). If ever kept, move to internal/admin script + remove public edge shape + wildcard CORS. | dev | both |
| 7 | FEEDBACK-GATE | "Report Issue" must not be visible-but-broken. | Current release proof `/private/tmp/prod-rerun-proof-1780861749917.json`: release `f9204d539091116759b859d31b739b4a6363e5d1`, fresh signup, visible Report Issue, HTTP 201 insert to `user_issue_reports`, `includeTranscript=false`, `includeAudio=false`, success text. | **Closed for beta:** keep visible. Reopen only if a later release build regresses or product requires attachment opt-in variants before beta. | test | dev supplement |

### Historical Lane 2 — Original Release Hygiene

| ID | Finding | Disposition | Found by |
|---|---|---|---|
| DEBRIS-CLEANUP | Tracked output dumps: `baseline_manifest.txt`, `consolidated_manifest.txt`, `e2e_errors_detailed.txt` (empty), `unit-results.txt`, `frontend/test_failures_v7.txt`. | `git rm` + add ignore patterns. | both |
| STALE-COORD | `product_release/ACTIVE_COORDINATION.md` claims source-of-truth but live board is `/private/tmp`; pins stale `origin/main`. | Tombstone pointer or delete. | both |
| STALE-DOCS | Legacy private-mode terminology + `:5173` in release docs/evidence — **not** in user-facing `frontend/src` (a guard test forbids the term). | Update active docs/templates; leave historical evidence only when intentionally historical. | test only |
| ENV-PROD-TRACKED | ✅ RESOLVED — `frontend/.env.production` **removed** on `main@c010434d` (outside Vite `envDir`, never build-loaded; all `VITE_*` client-public, never a secret leak). Root `.env.test.example` is the only tracked env template; post-merge CI/Canary/Deploy are green (`27153261348`, `27153261334`, `27153261357`). | Real prod client config = Vercel Project Env (Home B) + `ENV_INVENTORY.md`. Do not re-add. | dev + test |
| BUILD-WARNINGS | Large chunks; modules both dynamically+statically imported (defeats splitting); `onnxruntime-web` eval warning. | Chunking pass; non-blocking. | both |
| FORMAT-TRANSCRIPT-EDGE | ✅ RESOLVED and merged (BLOAT-FORMAT-TRANSCRIPT). Decision was REMOVE (not flag-gate): the `format-transcript` Gemini edge fn + client adapter + deploy lines are deleted; Native uses the deterministic `normalizeNativeTranscript` via the existing seam. No rollback flag kept (recoverable from git if ever needed). | Closed for beta. Native formatter-quality claims remain a separate product/test decision. | dev + test | dev |

### Historical Lane 3 — Original Post-Beta Cleanup

| ID | Finding | Disposition | Found by |
|---|---|---|---|
| PARKED-ENGINE-QUARANTINE | whisper-turbo (WebGPU) cluster ✅ RETIRED and merged (BLOAT-TURBO-ASSETS): `models/tiny-q8g16.bin`, `whisper-turbo/*`, `WhisperTurboEngine.ts`, `WhisperEngineRegistry.ts`, `patches/whisper-turbo@0.11.0.patch`, deps `whisper-turbo`/`whisper-webgpu`, duplicate mocks, and the `whisper-turbo` provider entry all removed. **Still parked (KEEP for post-release):** `transformers-js-v4` provider (off by default; opt-in via explicit `forceEngine`) + `webgpuSupport.ts` (used by v4 + runtime-path resolver). V4 design of record: `/private/tmp/DEV_PRIVATE_ENGINE_AUTODETECT_DESIGN_2026-06-08.md`; reviewer/test decision is **approve design, do not implement the v2-only resolver before beta** unless it fixes a current production failure. Future resolver integration must wait for compressed dtype + app-path proof and must prove init, first-decode, and mid-session fallback/replay safety. | Turbo: closed for beta. v4: keep quarantined for beta — not user-selectable / not in default bundle path — and enable post-beta per product ("need v4 working post initial release"). | both |
| DEAD-SCRIPTS | ~48/87 `scripts/` unreferenced (heuristic; CI aggregators are false positives). | depcheck/dependency-cruiser sweep; prune per-file post-beta. | dev only |
| UNUSED-DEPS | Not exhaustively checked. | Run `depcheck` + `.dependency-cruiser.cjs` post-beta. | dev |
| PLAYWRIGHT-CONFIGS | Root Playwright config inventory — confirm each is invoked; prune unused. | Test inventory artifact `/private/tmp/TEST_PLAYWRIGHT_CONFIG_INVENTORY_2026-06-08.md`: keep `playwright.base.config.ts`, `playwright.config.ts`, `playwright.live.config.ts`, `playwright.deployed-live.config.ts`, `playwright.canary.config.ts`, and `playwright.soak.config.ts`. Commit `97dd03b4` retired the unused `playwright.config.d.ts` artifact and the stale `tests/live/live-transcript.live.spec.ts` proof path. Remaining archive/document candidates are `playwright.stripe.config.ts` and `playwright.demo.config.ts` if product/test no longer uses those manual workflows. | test merge for retired files; later product/test disposition for manual stripe/demo configs |
| MODELS-OBJECT-STORAGE | ~115 MB Whisper base+tiny blobs are plain Git (post-LFS). | Move to object storage (Supabase Storage/Vercel Blob), runtime fetch + long cache. Post-beta. | dev |
| LOCAL-IGNORED-BLOAT | `frontend/dist` ~245 MB, `test-results` ~108 MB, `dist-e2e` ~94 MB, `lighthouse-results` ~58 MB — all **gitignored** (not shipped). | **Not a repo/release issue** — optional local `rm -rf`. | both |

### Historical Suggested Execution Order
1. SECURITY-SECRETS → 2. AUDIO-FIXTURES → 3. NO-HF-FALLBACK → 4. UX (Engine Frozen + payment CTAs) →
5. FIX-RLS-DELETE → 6. FEEDBACK reconfirm → 7. DEBRIS/STALE-DOC cleanup → 8. PARKED-ENGINE quarantine (no piecemeal deletion).

### Historical Beta GO/NO-GO
This was the original rule at inventory creation. Current GO/NO-GO is tracked by the current rows above:
provider-side key rotation remains the hard product-ops blocker; other items are either closed for beta,
conditional human proof, policy call, or post-beta cleanup.

## Re-Assessment Addendum — Dev Fine-Tooth Pass (2026-06-08, main@c5a2a460)

Second independent dev root-canal + bloat sweep after the closure merge. Source is clean
(400 `frontend/src` files; 0 real `console.*`/`debugger`/`@ts-ignore`/`eslint-disable`/empty-catch/`.only`).
Items below are NEW (not previously captured) or CORRECT prior inaccuracies. All are
bloat / post-beta class — **none are new beta-GO blockers.**

### New findings to track (Lane 3 / post-beta cleanup)

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| BLOAT-DEAD-SRC-MODULES | 9 dead / prod-unused `src` modules | 0 prod importers (verified repo-wide): `config/readiness.ts` (@deprecated), `hooks/useSpeechRecognition/useSessionTimer.ts`, `lib/e2eAttributes.ts`, `lib/processImage.ts`, `utils/stripeDetection.ts`, `services/recordingLeasePolicy.ts` (test-only), `services/transcription/utils/ImmutableCallbackProxy.ts` (test-only), `services/transcription/utils/privateVadFlag.ts` (test-only), `lib/mockData.ts` (test fixture in `src/`) | Post-beta: delete (move test-only fixtures to `tests/`). Re-verify each at delete time. |
| BLOAT-STRIPE-JS-DEPS | `@stripe/stripe-js@^7.9.0` + `@stripe/react-stripe-js@^4.0.2` are prod deps used ONLY by test infra (`tests/mocks/stripe.tsx`, `tests/support/utils/renderWithStripe.tsx`) exercising a Stripe **Elements** flow the app does not ship (checkout = server redirect) | grep: 0 src/prod imports; only test infra | Post-beta: remove both deps + the dead Elements test harness, or move to devDeps if an Elements flow is planned. |
| BLOAT-PARKED-VAD | Parked Silero-VAD Phase-2 cluster, unwired in prod: `silero_vad.onnx` asset + `onnxruntime-web` direct dep + `privateVadFlag` (flag never read in prod) + `sttConstants` VAD block. Whisper's ORT is transitive via `@xenova/transformers`. | `privateVadFlag` prod=0; `onnxruntime-web` 0 src imports | Post-beta: keep quarantined, or retire as one coherent change if VAD is not pursued. |
| BLOAT-ASSEMBLYAI-DEPCLASS | `assemblyai` SDK is in `dependencies` but imported ONLY by benchmark research scripts (`scripts/benchmark-assemblyai-ceiling.mts`); the app/Cloud path uses raw WS + an edge-fn token | grep: 0 src/backend SDK imports | Post-beta: move to `devDependencies` (or remove with the research harness). |

### Corrections to existing backlog rows

| Row | Correction |
|---|---|
| "Private STT CPU speed via cross-origin isolation" (claims "no `@stripe/stripe-js` … no stripe npm dependency") | **FALSE** — `@stripe/stripe-js` AND `@stripe/react-stripe-js` ARE in `package.json` (test-only usage; see BLOAT-STRIPE-JS-DEPS). The "no embedded Stripe.js in the shipped app" claim is true; the "no npm dependency" claim is not. |
| DEAD-SCRIPTS (Lane 3, "~48/87 unreferenced") | **OVERCOUNT.** Actual unreferenced top-level scripts = **3** research harnesses: `native-human-cdp-monitor.mjs`, `private-corpus-acceptance.mjs`, `private-local-punctuation-feasibility.mts`. The ~48 heuristic counted false positives (`lib/` helpers + CI-aggregated scripts). |

### Open dev tasks surfaced (not beta-GO blockers)
- **ORT-WASM-SAME-ORIGIN** — serve onnxruntime-web WASM from our origin (set `env.backends.onnx.wasm.wasmPaths` + copy wasm to `public/`) IF product wants the "all STT runtime assets same-origin" claim. Cost: re-add copy step + ~5–23 MB origin-served wasm + version-match on `@xenova` upgrades. Closes the no-HF claim-boundary nuance (ORT WASM currently loads from jsDelivr).
- **ENV-PROD** — ✅ RESOLVED: `frontend/.env.production` **removed** (was never build-loaded; outside Vite `envDir`). Prod client `VITE_*` = Vercel host env (Home B); Stripe key already host-injected.

### Confirmed clean (no action)
- Edge-function CORS = origin allowlist (no wildcards).
- No `@stripe/stripe-js` embedded in the shipped app (checkout = redirect).
- 0 real code smells in `frontend/src`; rotation runbook complete (`SECRET_ROTATION_RUNBOOK.md`).

## Private STT v4 — dormant infrastructure on main (convergence, not launch)

The v4 (transformers-js-v4 / WebGPU) infrastructure is merged to `main` as **dormant, flag-OFF**
code to close out the long-lived `dev/v4-integration` branch. v4 is **not launched**:
- `privateV4Flags` resolves **OFF by default** (PostHog flag absent → off; build kill-switch available).
- With the flag off, Private STT is byte-identical to the v2-base default (`resolvePrivateRuntimePath`
  never selects v4); Browser/Cloud/sample/save paths are unchanged.
- Telemetry (`privateV4Telemetry`) is non-PII (strict allowlist; no transcript/audio/email/name).
- No user-facing v4/base_q4/distil copy.

**Deferred to activation (post-release, not in this convergence):** flag-ON app-path lifecycle proof (#76),
v4 cross-utterance/decode tuning, the v4 decode-complete telemetry hook in `PrivateWhisper`, and the
Stage-B `SpeechRuntimeController` telemetry wiring — all to be re-derived/proved when v4 is intentionally enabled.

### v4 activation-readiness — material now on main (convergence), deferred items preserved

To allow deleting all `dev/v4-*` branches while keeping everything needed to ENABLE and PROVE v4 later
on `main`, the v4 proof material is converged onto main (flag-OFF, dispatch-only):
- Proof scripts: `posthog-stt-ab-authenticated-user-targeting-proof.mjs`, `posthog-stt-ab-targeting-inspector.mjs`, v4 `manual-stt-corpus-proof.mjs`.
- Proof CI: `.github/workflows/v4-auto-fallback-proof.yml`, `.github/workflows/v4-app-path-proof.yml` (workflow_dispatch).
- Flag-on browser-control proof: `tests/e2e/v4-posthog-browser-control.e2e.spec.ts` (skipped unless `RUN_V4_BROWSER_PROOF=1`).
- Active runbooks on main (current, clean): `V4_APP_PATH_PROOF_RUNBOOK` (#76 flag-on), `V4_POSTHOG_READINESS_PROOF`, `V4_DECODE_ROOT_CAUSE_EXPERIMENT`.
- **NOT ported (historical only; stale Gate/Option naming + obsolete email/`isInternalTester` targeting; superseded by the contract below):** `V4_WEBGPU_VALUE_PROOF_RUNBOOK`, `V4_GATE_B_TARGETING_MEMO`, `V4_DISTIL_BAKEOFF_KNOB_MEMO`, `GATE_B_IDENTITY_FAILURE_ANALYSIS` — preserved via `archive/*-pre-main-convergence` tags, not required to enable/prove v4.

**v4 flag-on targeting contract (FINAL — the only supported model):** the `private_stt_v4_enabled` PostHog flag is bucketed on `distinct_id`, which equals the Supabase `user.id` (set via `identify(userId)`; no PII). Targeting is an **operator-managed cohort or an exact `user.id` release condition** in PostHog. **No email targeting. No client-settable `isInternalTester`** (the app only *reads* flags; it never grants v4 to itself). Activation = an operator adds the test/cohort `user.id` to the flag condition; deactivation = remove it.

**Deferred to activation — explicitly classified as ACTIVATION BACKLOG/SPEC: NOT required for dormant v4 and NOT required for any flag-on proof.** (Verified empirically: zero references to `session_saved`/`emitV4SessionSaved` or to the #75 UX module across every ported proof — `v4-posthog-browser-control.e2e.spec.ts`, `posthog-stt-ab-*` scripts, `manual-stt-corpus-proof.mjs`, `v4-auto-fallback-proof.yml`, `v4-app-path-proof.yml`, and the app-path runbook #76.) Both are required only at **production v4 activation**, not to enable or prove v4. Preserved via `archive/*-pre-main-convergence` tags; re-derive at #76. So **no required v4 activation/proof material is branch-only.**
- `SpeechRuntimeController` Stage-B `session_saved` telemetry CALL-SITE — production rollout telemetry only. The `emitV4SessionSaved` module is already on main (#780); the call-site is deferred because wiring it requires threading `engineType` through the shipped save path + pulls in the excluded `storage`→`sessionRepository` rename. No proof depends on it.
- Customer-safe v4 UX copy + variant-aware download size (#75, incl. the `privateV4Ux` module which lives only on `dev/v4-customer-safe-ux`) — customer-facing copy shown only when v4 is ON. Re-derive flag-gated at activation so no v4/base_q4/distil copy ships while dormant. No proof depends on it.

## Auth / account-recovery — deferred security work (NOT in initial release)

Initial release ships **basic password reset only** (request neutral response + in-app `/auth/reset`
completion via Supabase `updateUser`). The following are explicitly deferred to backlog and must NOT
be implemented as part of basic reset:

- **MFA foundation** (enrollment + challenge scaffolding).
- **TOTP authenticator app** (RFC 6238) support.
- **Recovery codes** (one-time backup codes).
- **MFA recovery** (recover access when a second factor is lost).
- **High-risk-action reauthentication** (step-up auth before sensitive changes).
- **Email change hardening** (verified re-confirmation on both addresses; email is not user-changeable this release).
- **Session revocation hardening after password reset** — see provider-limitation note below.
- **Support/admin account-recovery policy** (assisted recovery, identity proofing, audit trail).

**Provider-limitation note (session revocation after reset):** Supabase issues a recovery session
to complete the reset; global revocation of *other* active sessions on password change is not
explicitly enforced in this flow. Behavior is recorded here as a **security-hardening backlog item**
(evaluate `signOut({ scope: 'global' })` / server-side session invalidation) rather than implemented
now. Basic reset still updates the credential so a stolen password no longer authenticates new logins.

## Password-reset E2E completion proof (#793) — ✅ CLOSED (release-owner, 2026-06-14)

**CLOSED: release-owner manually verified the full E2E on 2026-06-14** — received the reset email + link, set a new password (accepted), and signed in with the new credentials. The original recovery-session-race bug (`02cf3fe7`) is confirmed fixed end-to-end. A scripted live spec remains OPTIONAL (nice-to-have regression guard; see Option A admin-`generateLink` in the closure plan) but is no longer a release item.

_Historical steps (now satisfied):_

The reset CODE is shipped + deployed and the `/auth/reset` page is confirmed to **render the
"Set a new password" form** on prod (`02cf3fe7`) — that was the original bug (recovery-session
race), now fixed. What remains is finishing the **end-to-end manual/scripted proof** of an actual
password change (it was started but not completed). ~2 minutes in a browser (or a scripted live
spec). Steps to verify:

1. On `/auth/reset` (from a fresh reset email link): type a new password in both fields → click **Update password**.
2. Confirm the **"Your password has been updated. You can sign in with your new password."** success copy.
3. **Sign in** with the *new* password → succeeds.
4. *(optional)* the *old* password no longer authenticates.
5. Click a **used/expired** reset link → shows the safe **"This reset link is invalid or expired…"** copy (no token/password/email leak).

Owner: Test/Ops or release-owner (real browser + a confirmed account + working email delivery —
custom SMTP vs the rate-limited default; see the email-branding/SMTP backlog). Not a code blocker.

## No-concurrent-recording (account recording-lease) — DEFERRED, not in this release

**Decision (release-owner):** do NOT finish the no-concurrent-recording lock for this release. It
touches recording lifecycle, stale-lease recovery, multi-tab + cross-device state, and take-over UX
— exactly the kind of feature that creates last-mile bugs. Defer.

**Current state on `main` (verified): dormant server plumbing only, ZERO user impact.**
- Present: DB migration `backend/supabase/migrations/20260607040000_active_recording_lease.sql`
  (table + `acquire/heartbeat/release_recording_lease` RPCs) and `frontend/src/services/recordingLeasePolicy.ts`
  (an RPC-result→action/copy interpreter).
- **No runtime/client code imports or calls any of it** (`recordingLeasePolicy.ts` is only self-referenced;
  no `recordingLeaseService.ts` exists on main). So there is no user-facing behavior — harmless dormant plumbing. Leave it.

**Unmerged client work lives on branches (do NOT merge for this release; notes captured here so the
branches can be deleted without losing the design):**
- `dev/account-lease-takeover` (tip `10363bc4`) — client lease service (`recordingLeaseService.ts`) +
  controller wiring (`SpeechRuntimeController.ts`, `tabIdentity.ts`, `useSessionStore.ts`) + take-over
  UI (`components/session/AccountLeaseTakeover.tsx`) + unit tests + post-migration DB verify script. The
  most complete increment.
- `dev/account-recording-lease-2` (tip `60ad11ab`) — earlier subset of the same client service +
  controller wiring + tests.

**Future-work requirement:** completing this needs a dedicated **recording-lifecycle proof cycle**
(stale-lease recovery, multi-tab contention, cross-device take-over UX, failure/abort paths) before it
ships. Treat as its own scoped effort, not a closeout add-on.

## v4 Private STT — CONVERGED, DORMANT, activation-gated (not a branch dependency)

v4 is a **first-class, flag-gated implementation on `main`** (verified readiness matrix, all 17 areas):
default OFF / fail-closed to v2-base; selected only via `private_stt_v4_enabled`; behaves like v2-base
except for performance/quality/resource; no user-facing v4/base_q4/distil copy; same save/detail/analytics/
privacy/fallback paths; sanitized non-PII telemetry. **Activation-ready from `main` alone — no branch-only
code required.** v4 branches are therefore deletable after archive tags + Test confirmation.

**Not done (the activation GATE, not a code gap):** the empirical **WebGPU benchmark run** (v2-base 93.89%
vs v4 base_q4/distil_q4, on real GPU) + a **flag-ON app-path proof**. Until those pass the release-owner
bar (v4 ≥ v2-base on the same corpus), **do not turn the flag on / do not launch the A/B.** Tooling is on
main: `tests/live/benchmark-v4.live.spec.ts` (V4_VARIANT/V4_DEVICE), `engines.Private.v4.floors` in
`tests/STT_BENCHMARKS.json`, `.github/workflows/v4-app-path-proof.yml`, `tests/e2e/v4-posthog-browser-control.e2e.spec.ts`.

## Stripe refund/cancel — API-backed admin tool (DEFERRED, post-launch product-ops design)

**Priority:** P2 (product-ops; not a launch blocker). **Added:** 2026-06-22 (release-owner).

**Context.** For the paid-launch downgrade proof (`cus_UjX6pOoPaWreCA`, 2026-06-22) the subscription cancel + $9.99 refund were done **manually** in the Stripe dashboard. That was the right call for the proof: it kept the action under release-owner control and avoided building a new privileged refund/cancel path mid-launch. The DB-side downgrade contract then verified **PASS** (`verify-downgrade-proof.yml` run `27980607954`: free, both ids NULL, sample burned, customer preserved). Manual refunds are **not** required forever — Stripe exposes both actions via API; an API-backed admin path is the better long-term design.

**Stripe API (both actions are API-serviceable):**
- Cancel subscription immediately — `DELETE /v1/subscriptions/{id}` → status becomes `canceled`, no further charges. (https://docs.stripe.com/api/subscriptions/cancel)
- Refund a payment — `POST /v1/refunds` with `payment_intent` (or `charge`) → refunds to the original method, full or partial up to the unrefunded amount. (https://docs.stripe.com/api/refunds/create)

**Future design — admin-only refund/cancel tool (NOT a public/user-facing button initially):**
1. Verify requester is admin/release-owner.
2. Load profile by `customer_id` or `user_id`.
3. Confirm an active `stripe_subscription_id`.
4. Cancel the subscription via Stripe API (immediate).
5. Find the latest paid invoice / `payment_intent` / charge.
6. Create a full refund via Stripe API.
7. Write an audit row: `user_id, customer_id, subscription_id, payment_intent, refund_id, actor, reason, timestamp`.
8. Let the **Stripe webhook** drive the entitlement downgrade (do **not** downgrade the DB directly as the primary action).
9. Poll/verify the profile row (free, both ids NULL, sample burned) — reuse `verify-downgrade-proof.yml`.

**Key safety rules:**
- **Stripe is the source of truth.** Cancellation/refund must EMIT the webhook, and the webhook (`process_stripe_webhook_event`) drives the entitlement change. Direct DB downgrade is a **break-glass fallback only**.
- Runs **only** with a live Stripe secret in a locked-down, admin-gated environment. Must **never** print `sk_live`, card data, or full customer emails.
- Dev-buildable as an API-backed admin script or guarded `workflow_dispatch`, mirroring the secrets-in-YAML pattern (no local creds).

**Status:** deferred / not started. Manual Stripe dashboard action remains the interim path; the 2026-06-22 launch proof is already closed manually.

## Pre-Release UX Gates (release-owner, 2026-06-22)

**Posture:** **Billing/payment = GO** (paid refund/cancel entitlement proof closed — see `v0.8.5-rc1`). The remaining gate for *broad* release is **user-facing UX**, not cleanup. Block release only on items affecting first-user comprehension, trust, save/report confidence, or paid entitlement. These promote manual-testing findings into canonical items; they require **runtime proof** (screenshots/video/trace), not unit tests alone.

### Must complete before broad release (UX gates)

| Priority | ID | Item | Why it matters |
|---|---|---|---|
| P0/P1 | UXGATE-TRUST-STATE | **Real Native + Private trust-state proof** — at least one non-Cloud path must be trust-preserving: no blank panels, unstable labels, duplicate/truncated text, unreadable punctuation/casing, or overconfident score/analytics from weak transcripts. | Backlog requires a non-Cloud path that is trust-preserving. Runtime proof. |
| P1 | UXGATE-WEAK-CAVEAT | **Transcript-quality caveats visible in Native/Private reruns** — weak transcripts must not yield overconfident Score/Analytics. | Required guardrail; manual rerun proof. |
| P1 | UXGATE-SAVE-COHERENCE | **Save/history/detail coherence** — transcript, metrics, engine metadata, PDF, AI suggestions, and detail view must align as durable evidence. | Runtime journey proof. |
| P1 | UXGATE-FOCUS-CLARITY | **Analytics focus chooser clarity** — "Change Focus" flagged as unclear/visually weak; promote from review to a UX fix (label + affordance + tooltips/examples). | Self-explanatory focus model reduces "metric soup". |
| P1/P2 | UXGATE-CLARITY-CONSISTENCY | **Clarity metric consistency + honest labeling** — dashboard aggregate Clarity can show 0% while session/PDF are nonzero; align source of truth; rename/caveat if derived from pace/fillers not true speech clarity. | User-facing trust/correctness, not cosmetic. |
| P2 (high-value) | UXGATE-REPORT-ISSUE-OPS | **Report Issue ops notification / triage path** — insert works (closed) but there is no notification/triage loop. | Release-ops risk. |

### Should complete if public-facing

| Priority | ID | Item |
|---|---|---|
| P2 | UX-HOMEPAGE-DEMO | Homepage "See How Feedback Works" — unauth `/analytics` redirect blunts the promise; add a demo/preview route or change the CTA to set an authenticated expectation. |
| P2 | UX-PRIVATE-READY | Private STT ready/status signal — clear "Private STT ready" state/toast after model download (deliberate consent/download UX). |
| P2 | UX-STALE-TRANSCRIPT | Stale transcript / false unsaved banner after STT mode switch or save — false risk signals; fix or prove absent. |
| P2 | UX-FOCUS-CONTRAST | Focus button contrast + wording — e.g. "Choose coaching focus" or `Focus: <current> ▾`. |
| P2 | UX-VISUAL-DENSITY | Session visual-density screenshot pass (desktop/mobile) after trust-state fixes settle. |

### Deferred until after broad release (NOT UX gates)
#833 rc-gates webhook digest · #834 `subscription_id` deprecation · #835 frontend membership cleanup · #837 backlog doc · generic Stripe secret deletion · drop `subscription_id` column · CORS Set micro-opt · **OpsStatusPage fallback — do NOT parallelize (ordered fallback is intentional)** · dead `FORCE PRO` comment / dead `downgrade_to_basic` arm.

### Proposed focused UX PR sequence (do not mix with Stripe/Supabase/secrets/cleanup)
1. **STT trust + stale-state UX** — Native/Private trust banners; prevent stale transcript after mode switch; prevent false unsaved-draft banner after save/mode switch; prove visible draft/final state + saved detail correctness. *(Why first: ship only if a non-Cloud path is trust-preserving.)*
2. **Focus selector UX** — replace "Change Focus"; clear dropdown affordance; contrast; compact descriptions/tooltips for Speak Clearly / Sound Confident / Track Progress / Custom.
3. **Analytics/Clarity consistency** — fix aggregate Clarity 0% inconsistency; align dashboard/session/PDF/goals source of truth; rename/caveat Clarity if derived from pace/fillers; auto-surface transcript-quality caveat on weak transcripts.
4. **Homepage/demo path** — non-auth feedback preview/demo OR change the CTA to an authenticated expectation.
5. **Report Issue ops loop** — keep user success confirmation; add internal notification or daily triage query; document who reviews reports.

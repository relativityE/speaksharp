**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.1
**Last Updated:** 2026-06-08

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
| P0 | BLOAT-TRACKED-ENV-SECRETS | Tracked `.env.test` files contained secret-like production-dangerous keys. | Dev second pass confirmed `.env.test` and `frontend/.env.test` were tracked and contained entries named `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ASSEMBLYAI_API_KEY`, plus test passwords. Repo-side progress on `dev/release-closure@ff3b204b`: tracked env files removed, example files added, secret scan hardened; test verification `pnpm rc:sast:secrets` passes and `git ls-files` no longer lists root/frontend `.env.test`. GitHub secret slots exist for replacement, but listed update timestamps predate this cleanup. | Product-ops remains required: treat previous values as compromised unless proven fake; rotate any real keys and decide whether history purge is required. Provider-side rotation is only partly automatable: Stripe can be scripted by an owner; AssemblyAI is mostly dashboard/manual; legacy Supabase service-role requires JWT-secret regeneration and also rotates anon, so it is disruptive/dashboard-led. Dev/test can write/check the runbook and automate post-rotation verification, not issue all provider keys from this environment. Reverify after merge to main. |
| P0/P1 | BLOAT-AUDIO-FIXTURES | Two tracked audio fixtures were HTML, not audio. | Original `tests/fixtures/jfk_16k.wav` and `tests/fixtures/test-audio.wav` were HTML documents per `file`; `tests/live/live-transcript.live.spec.ts` uses `jfk_16k.wav` as fake mic audio. Test commit `dev/release-closure@7d8aa2bd`: replaced `jfk_16k.wav` from checked-in `jfk.flac`, replaced `test-audio.wav` from valid `test_speech_16k.wav`, added `tests/release/audio-fixture-integrity.test.ts`, and wrote classification artifact `/private/tmp/audio-fixture-evidence-classification-2026-06-08.md`; focused guard passes with coverage disabled. | Test/dev: rerun any release STT proof that needs the `live-transcript` fake-audio path after this branch is otherwise ready. Historical `live-transcript`/bad-fixture proofs are INVALID unless independently backed by valid audio; other RIFF/WAVE STT fixture families are not invalidated. |
| P1 | BLOAT-FIX-RLS | `fix-rls` Edge Function was dead/stubbed and risky-looking. | Original `backend/supabase/functions/fix-rls/index.ts` had permissive `Access-Control-Allow-Origin: *`, created an unused service-role client, and returned “Use the Supabase Dashboard SQL Editor...” It was not deployed by `.github/workflows/deploy-supabase-migrations.yml`. Dev deleted it on `dev/release-closure@35157a72`; test verification found no file and no runtime/deploy/code references outside backlog text. | Closed after merge/reverify: keep deleted. |
| P1 | BLOAT-TURBO-ASSETS | Legacy turbo/WebGPU model path is parked weight, not safely dead. | Tracked payload includes `frontend/public/models/tiny-q8g16.bin` (~49 MB) and `frontend/public/whisper-turbo/whisper-wasm_bg.wasm` (~5.8 MB). Dev second pass confirmed provider/registry references still exist, plus service-worker mappings, patch/deps, tests, and duplicate mocks. | Dev/product second pass: decide whether turbo is release-path. If not, retire/quarantine as one coherent change: provider entries, engine/util code, service-worker mappings, public assets, patch, deps, tests, and duplicate mocks. Do not delete piecemeal. |
| P1 | BLOAT-PRIVATE-FALLBACK | Main-thread Private fallback conflicted with no-HF/base-default posture. | Original `frontend/src/services/transcription/engines/TransformersJSEngine.ts` main-thread path hardcoded local `whisper-tiny.en`; on local load failure it enabled remote models and loaded `Xenova/whisper-tiny.en`. Dev fixed strict no-HF fallback on `dev/release-closure@b579c3a4`; targeted test `TransformersJSEngine.test.ts` passes 23/23 with no-HF assertions. | Test must still reverify after merge/browser proof that Private fallback makes no Hugging Face network call and respects the selected model. |
| P1 | BLOAT-PAYMENT-CTA | Some upgrade CTAs remained visible when payments were disabled/non-live. | Core payment enablement is correctly `pk_live_` gated. Dev committed `dev/release-closure@d7cd305c`: `AnalyticsPage`, `AnalyticsDashboard`, and `SunsetModals` now render-gate upgrade CTAs on `arePaymentsEnabled()`. Focused unit/component tests passed in the handoff. | Code-side done; test must browser-proof payment-disabled surfaces do not render dead/no-op upgrade buttons after merge. |
| P1 | BLOAT-CONFIG-REQUIRED-COPY | Configuration fallback page copy was stale after config-gate-relax. | Boot now only requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, but `ConfigurationNeededPage` told users/testers `VITE_STRIPE_PUBLISHABLE_KEY` and `VITE_SENTRY_DSN` were required. Test-agent fixed the page/test on `dev/release-closure`: only Supabase URL/anon are listed as required; Stripe/Sentry are described as optional for startup, with payment surfaces hidden unless a live Stripe key is configured. Focused proof passed: `ConfigurationNeededPage`, runtime config, payment/analytics/upgrade surfaces `73/73`. | Done-on-branch; close only after merge to main and browser/config fallback proof if needed. |
| P1 | BLOAT-NATIVE-FROZEN-COPY | Native watchdog exposed scary “Engine Frozen” user-facing text. | Prior human proof observed `Speech recognition is taking a moment (Engine Frozen)` during successful Native recognition. Dev committed `dev/release-closure@d7cd305c`: Native heartbeat drift is logged but no longer surfaces the scary user-facing frozen warning; non-Native warning copy is calmer. Focused heartbeat test passed in the handoff. | Code-side done; test must browser/manual proof healthy Native recognition shows no scary frozen toast after merge. |
| P1 | BLOAT-STALE-COORD | Repo still contained stale coordination source-of-truth file. | `product_release/ACTIVE_COORDINATION.md` claimed to be the single source of truth, but active coordination moved to `/private/tmp/ACTIVE_COORDINATION.md`; repo file contained stale `origin/main@7cc9fed2`. Test-agent deleted the repo file on `dev/release-closure@98b37528` and reset `/private/tmp/ACTIVE_COORDINATION.md` to a small active subset of this backlog. | Done-on-branch; close only after merge to main. Keep all future active coordination in `/private/tmp/ACTIVE_COORDINATION.md`. |
| P2 | BLOAT-VAULT-DOCS | Release/docs/tester surfaces still used legacy private-mode terminology. | `product_release/PRODUCT_FEATURES.operational.md` still paired Private with the legacy term; GitHub tester feedback template offered the same legacy mode label and privacy warning. App release guards block raw/stale terminology in user-facing `frontend/src`, so this was docs/tester-facing drift, not current UI copy. Test-agent cleaned active docs/templates on `dev/release-closure`. Historical evidence remains untouched. | Done-on-branch; close only after merge to main. Future active docs/templates should use Browser/Native, Private, and Cloud naming. |
| P2 | BLOAT-5173-DOCS | Local CORS/checklist docs pointed at `localhost:5173`. | `_shared/cors.ts` fallback/comment, `stripe-checkout` local fallback, Supabase deploy workflow `ALLOWED_ORIGIN`, and `LAUNCH_ENV_CHECKLIST.md` pointed release/manual CORS guidance at 5173 while manual proof mode is 5174. Test-agent aligned those release/manual CORS surfaces to 5174 on `dev/release-closure`; intentionally diagnostic/test-mode 5173 references remain. Verification: stale-release-surface `rg` returned no hits; `deno check` passed for CORS + stripe-checkout; Deno tests passed 2 files / 7 steps. | Done-on-branch; close only after merge to main and deploy-secret sync. |
| P2 | BLOAT-FAILURE-DUMP | Tracked test failure/output dumps remained in source tree. | `baseline_manifest.txt`, `consolidated_manifest.txt`, empty `e2e_errors_detailed.txt`, `unit-results.txt`, and `frontend/test_failures_v7.txt` were tracked generated outputs, not source/test/canonical evidence. Commit `dev/release-closure@ae532ee9` deleted those generated dumps and added ignore patterns. | Done-on-branch; close only after merge to main. Keep generated dumps ignored and out of source. |
| P2 | BLOAT-LOCAL-OUTPUTS | Large ignored local outputs are accumulating. | Observed ignored local output: `frontend/dist` ~245 MB, `test-results` ~108 MB, `frontend/dist-e2e` ~94 MB, `lighthouse-results` ~58 MB, plus reports/coverage/artifacts. | Local hygiene: periodically clean ignored build/test artifacts. No repo change required unless tooling should add cleanup commands. |
| P2 | BLOAT-EVIDENCE-REPORTS | Tracked release evidence is small but potentially stale/contradictory. | `product_release/evidence` has 25 tracked files, ~460 KB total, including 4 historical `test_reports/` Markdown reports and dated proof JSONs from 2026-06-02/05. `.DS_Store` was observed as ignored local debris, not tracked repo weight. Test-agent added `product_release/evidence/README.md` on `dev/release-closure` to label this directory as an evidence archive, not current release truth; it directs current verdicts back to `BACKLOG.md` and `/private/tmp/ACTIVE_COORDINATION.md`, and warns that older reports may contain superseded conclusions. | Done-on-branch; close only after merge to main. Do not delete dated evidence casually; use the README/backlog to prevent stale interpretation. |
| P2 | BLOAT-FORMAT-TRANSCRIPT | Complex Native formatter/Gemini path may be release-dead after Native simplification. | Product decision says Native release path uses browser SpeechRecognition with minimal deterministic cleanup only; current tree still contains `nativeGeminiFormatter`, `nativeAsyncFormatter`, `nativeTranscriptFormatter`, and `.github/workflows/deploy-supabase-migrations.yml` still deploys `format-transcript`. | Dev/product second pass: keep only if Cloud/future formatter explicitly owns it; otherwise remove from release call path/deploy surface or archive as future work. |
| P2 | BLOAT-SCRIPT-REACHABILITY | Several scripts look one-off or research-only. | Test-agent reachability disposition saved at `/private/tmp/TEST_SCRIPT_REACHABILITY_DISPOSITION_2026-06-08.md`. Several initial suspects are not bloat: `private-status-reducer.mjs` and `private-timing-reducer.mjs` are imported by release tests; `preinstall.sh`, `dev-init.sh`, `vm-recovery.sh`, `benchmark-filler-ceiling.mts`, and `generate-filler-audio.sh` are listed in `RC_TEST_INVENTORY.md`. Manual/research tools to keep-or-archive by product workflow: `native-human-cdp-monitor.mjs`, `private-local-punctuation-feasibility.mts`. Strongest archive/delete candidates are the unreferenced dev research harnesses under `scripts/dev/private-*`. | Dev second pass: do not broad-delete scripts. Keep package/workflow/release-inventory reachable scripts; archive/delete the five `scripts/dev/private-*` research harnesses only if their investigations are closed. |
| P2 | BLOAT-DEPS | Dependency list has likely-unused or release-parked packages. | Test-agent dependency disposition saved at `/private/tmp/TEST_DEPENDENCY_DISPOSITION_2026-06-08.md`. Confirmed in-use: `@xenova/transformers` for Private v2, `@huggingface/transformers` for v4 off-flag, and the active `whisper-turbo` cluster while dev retires it separately. Manifest-only candidates with no direct source/script/test imports found: `compromise`, `pdf-lib`, `pdf-parse`, `node-fetch`, `@types/node-fetch`, `jose`, `baseline-browser-mapping`. `@vitest/ui` is dormant/dev-only and already documented in SCA exceptions. | Dev second pass: remove manifest-only candidates in a dependency-cleanup branch if no hidden operator workflow uses them; update lockfile; run lint/typecheck/focused PDF/STT tests and secret scan. Keep this separate from active turbo retirement unless dev intentionally combines and fully verifies. |
| P2 | BLOAT-BUILD-WARNINGS | Production build passes but warns on bundle health. | `pnpm build` passed with warnings: stale Browserslist data, `onnxruntime-web` eval warning, large chunks over 500 KB, and duplicate timestamped/non-timestamped WASM files in build output. | Dev second pass: decide which warnings are acceptable for beta and whether duplicate WASM output is intentional cache-busting. |

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
| Score/Analytics | Trust interpretation layer | Converts transcript/session signals into coaching and trends | Score must stay directional/confidence-gated when transcript quality is weak. Analytics must make Transcript Quality prominent enough to distinguish speaking issues from STT capture issues. |

## Open Beta Closeout Findings (2026-06-05)

| Priority | ID | Finding | Status / evidence | Owner / next action |
|---|---|---|---|---|
| P0 | PROD-CONFIG-1 | Vercel production config is readable; production currently uses a test Stripe key. | Live browser proof against `https://speaksharp-public.vercel.app/` and `/pricing` found `window.__APP_RUNTIME_CONFIG__` present with real Supabase auth (`mockAuth=false`, `releaseProofEligible=true`), release `adfe1d5fc4a0a63db5e5c726285c827fd0240135`, and `stripeKeyClass="test"`. Public home/pricing did not expose checkout/Stripe/subscribe buttons; `/pricing` showed Pro copy with only `Start Free`. | Product-ops: set the live Stripe publishable key before payment exposure, or keep payment surfaces hidden. test-release-agent: recheck `stripeKeyClass === "live"` for payment launch, or confirm non-live keys still hide checkout. |
| P1 | PRIVACY-OBS-1 | Sentry/PostHog privacy posture is mostly good, but current production still predates the raw-message masking branch. | Production has Sentry `sendDefaultPii=false`, console breadcrumbs scrubbed, and PostHog `autocapture=false`, `capture_pageview=false`, `capture_performance=false`, `disable_session_recording=true`; SAST/Edge privacy tests passed. Current production bundle still contains the older raw background-toast string. | @dev-agent: merge/deploy `dev/beta-closeout` masking; test-release-agent re-proofs live bundle and user-facing toasts. |
| P0 | FEEDBACK-1 | In-app issue-report flow is implemented and current production submit proof passes. | Earlier proof failed with `PGRST205` because `public.user_issue_reports` was absent. Current release proof `/private/tmp/prod-rerun-proof-1780861749917.json` on production release `f9204d539091116759b859d31b739b4a6363e5d1` shows fresh signup, visible Report Issue, HTTP 201 insert to `user_issue_reports`, `includeTranscript=false`, `includeAudio=false`, and success text. | Closed for beta: keep Report Issue visible. Reopen only if a later release build regresses or product requires opt-in attachment variants before beta. |
| P0 | STT-EVIDENCE-1 | STT release evidence is partial. | Private STT-P6 base-vs-tiny evidence is complete: base helps guard rows but does not fix `conv_01` and is too slow as default. Native human mic proof is still pending. Cloud baseline smoke is complete; richer metrics are deferred behind Native/Private. | test-release-agent owns Native human proof and any Cloud richer metrics after Native/Private; product decides Private base opt-in vs tiny default. |

Current 24-hour gates:

| Gate | Owner | Pass condition |
|---|---|---|
| Native front-door proof | Test/release with human mic; dev only if artifact proves product bug | Clean/filler/realistic scripts captured with first visible text, visible-at-stop, post-stop final, `selectedForSave`, saved/history/detail, duplication flag, formatter telemetry, and readability. |
| Private trust proof | Test/release; dev fixes concrete boundaries | Setup consent honored; live text cumulative; Private Draft/Processing/Final states correct; no duplication/truncation in `saveCandidate`; short/medium scripts meet/beat the better of same-model/drop-in and Native human baseline. |
| Cloud baseline proof | Test/release; dev only for provider/request/tail bug | Current-head deployed smoke passed on run `26960691857`; richer tail/readability/WER metrics are deferred behind Native/Private. No default keyterms work. |
| Score/Analytics trust | Dev + test | Weak transcript quality lowers confidence/copy, not necessarily the numeric formula; Analytics exposes Transcript Quality as a first-class guardrail. |

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
| Score/Analytics | Transcript Quality is visible enough that users understand when feedback reflects capture quality rather than speaking quality. |

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
| Signup | Reduce friction while setting correct plan expectations. | Start free with Browser transcription; trial gives limited Private access; Cloud is Pro-only. | Local visual pass: signup card states "Start free, with a 60-minute Pro trial"; copy says Browser is free, trial includes Private, Cloud unavailable for trial. | Does the trial/Cloud/Private distinction feel clear and fair, or does it create too much decision load before the user has practiced? |
| Session | Make the live practice surface feel active, trustworthy, and coaching-oriented. | The user should know: current STT mode, whether text is draft/final, whether local processing is happening, what the SpeakSharp Score means, and which 2-3 actions to try. | Code path: `SessionPage` renders `LiveRecordingCard`, `LiveTranscriptPanel`, `LiveCoachingScoreCard`, and `FillerWordsCard`. Score card explains structure, pace/fillers/pauses, clarity, audience impact, and transcript-quality confidence. Browser E2E currently passes 38/38 on covered journeys. | Is the right side score/coaching rail motivating without distracting while speaking? Are trust banners strong enough when Native/Private text is jumpy or delayed? |
| Save/history/detail | Confirm that a practice session became durable evidence. | Saved transcript, metrics, engine metadata, history row, detail transcript, PDF, and AI suggestions should align. | Code path: Analytics detail view exposes `data-session-detail-transcript`, engine metadata, stat cards, PDF export, and AI suggestions. Known STT human-proof reruns still gate Native/Private detail correctness. | After Stop, does the user have an obvious next action, and does the saved detail feel like a coherent report rather than a database record? |
| Analytics dashboard | Turn many tools into a small number of understandable coaching stories. | Pick a focus: Delivery Control, Message Clarity, Habit Progress, Session Proof, Transcript Quality, or Custom Toolkit. Each focus should explain why its cards/charts are grouped. | Code path: `AnalyticsDashboard` renders visible focus label, purpose, outcome, "Why these tools are here", selected stat cards, selected carousel tools, goals, history, comparison, and PDF actions. Component coverage checks every focus story. | Are focus names and descriptions self-explanatory enough, or should each focus get a tooltip/help affordance and example question? |
| Score/Analytics connection | Keep Score motivating but not overconfident. | SpeakSharp Score is directional; transcript quality affects score confidence; Analytics should help separate speaking quality from STT capture quality. | Score card has a transcript-quality caveat and hides precise score when confidence is low. Analytics has a Transcript Quality focus with STT Engine Quality as the first tool. | Is Transcript Quality prominent enough when a transcript is weak, or should it surface automatically on low-confidence sessions instead of requiring the user to choose it? |

### Analytics Focus Definitions Shown To Users

| Focus | User question it should answer | Current user-facing meaning | Primary concern for review |
|---|---|---|
| Delivery Control | "Was I easy to follow?" | Shows whether pace, pauses, and filler habits make the speaker easy to follow. | Does it map cleanly to what users expect from "delivery"? |
| Message Clarity | "Did my point land?" | Connects transcript quality, clarity, and coaching notes to whether the point lands. | Does "transcript quality" inside this focus confuse message quality with STT quality? |
| Habit Progress | "Am I getting better over time?" | Turns practice volume and repeated patterns into a habit loop. | Does it feel motivating enough to bring users back? |
| Session Proof | "Can I compare this attempt to prior attempts?" | Prioritizes before/after comparison and reports the user can revisit or share. | Does this satisfy the user's need to prove improvement, or does it need score movement/PDF framing? |
| Transcript Quality | "Can I trust this feedback?" | Separates speaking performance from transcription reliability. | Is this prominent enough for Native/Private caveats, especially when punctuation/readability are weak? |
| Custom Toolkit | "Am I improving against my own target words?" | Lets users inspect specific tools outside a predefined group. | Does custom selection preserve interpretation, or does it dump users back into metric soup? |

### Open UX/Product Tasks From This Review

| Priority | Task | Why it matters | Owner / next proof |
|---|---|---|---|
| P0/P1 | Verify trust-state UX in real Private and Native sessions. | The product can have good final WER and still feel broken if text appears late, jumps, replaces prior text, or lacks a draft/final disclaimer. | Test/release proof with screenshots/video and `__SS_TRUST_TRACE__`; dev fixes only proven state-machine defects. |
| P1 | Keep Transcript Quality prominent in Native/Private reruns. | Automated score/analytics proof now verifies transcript-quality caveats and Analytics focus coverage, but human STT reruns still need to prove the warning appears when real transcripts are weak. | Test/release: rerun Native/Private after dev fixes and confirm score/Analytics caveats remain visible when quality is still low. |
| P1 | Review whether Analytics focus chooser needs tooltips or examples. | The focus model is intended to reduce metric soup; if names are unclear, users will not know which story to choose. | UX/reviewer pass; possible dev task: add compact help copy or hover/tooltips for each focus. |
| P2 | Review homepage "See How Feedback Works" path. | Homepage offers analytics preview, but unauthenticated `/analytics` redirects to sign-in, which may blunt the promise. | Product decision: either keep auth gate or add a non-auth demo/preview route. |
| P2 | Reassess visual density after STT bugs settle. | Session currently has recording controls, transcript, live score, and fillers; it must stay focused during speech. | Screenshot pass desktop/mobile after latest STT trust-state fixes. |

## Open Beta Closeout Gate Findings (2026-06-05)

| ID | Priority | Owner | Finding | Required action |
|---|---|---|---|---|
| RC-LH-1 | P1 | @dev-agent | `pnpm run rc:gate:1:product` runs local CI through code quality and E2E (`33/33`), then fails because Lighthouse returns `NO_FCP`. Reproduction on `127.0.0.1:4173` shows the built test-mode app stays on the loader and throws `Mock auth is not available from the runtime app...`. | Make the Lighthouse/product gate use the centralized E2E harness/mock-auth bridge or another valid preview route that paints without weakening environment discipline. |
| RC-LIVE-ENV | P0 | product/ops | `pnpm run rc:dast:live` correctly stops before browser execution because live proof inputs are absent (`BASE_URL`, Supabase URL/anon/service-role, Free/Pro test creds, Stripe webhook secret). | Supply live proof env/secrets before counting live DAST as release evidence. |
| RC-SCA-1 | P1 | @dev-agent | `pnpm run rc:gate:4:sca` fails current `main@da09b2c6` on critical `vitest <4.1.0` advisory `GHSA-5xrq-8626-4rwp`; audit reports 82 findings total (5 low, 35 moderate, 41 high, 1 critical). | Upgrade/pin the Vitest stack to a patched version or remove/disable vulnerable Vitest UI exposure, then rerun `pnpm run rc:gate:4:sca` and the relevant unit/front-end suites. |

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
| P1 | Private STT WebGPU turbo enablement UX | The runtime resolver (`utils/privateRuntimePath.ts`) will promote to the WebGPU `whisper-turbo` engine ONLY when the ~75MB turbo model is already cached (`ModelManager.isModelDownloaded('whisper-turbo')`), to avoid a surprise download. There is currently no flow that intentionally downloads/caches the turbo model, so on a fresh WebGPU-capable device the GPU fast path is implemented but effectively **unreachable** — those users stay on CPU. | WebGPU acceleration delivers no user value until capable users have a way to opt into the faster local model; without this the GPU path is dead code in practice. | Design a turbo-enablement flow: detect WebGPU support (`detectWebGPUSupport()`), offer "faster local model" setup, clearly explain model size/download, cache it, then confirm the resolver promotes to `webgpu` and that GPU→CPU fallback still works. Treat as a product decision (when/how to prompt), not an automatic background download. |
| P1 | Native first-session transcript responsiveness | A Free user's first Browser transcription session must show clear live progress or a useful recovery message if the browser hears speech but withholds transcript results. | A silent transcript panel during recording feels broken even if text appears after Stop; it damages the Free return loop and any Native accuracy claim. | Add a targeted live/harness test for long initial silence followed by speech, then harden Native recovery/status messaging so users are not left staring at an empty transcript. |
| P1 | Production environment safety evidence | Manual profile login and entitlement paths no longer use `devBypass` or `VITE_DEV_USER`; remaining production evidence must prove internal routes are disabled and the production build uses real auth/profile state. | A leaked preview or misconfigured production env could make admin behavior look wrong and undermine launch confidence even if source code is safe. | Before RC tag, verify Vercel production has `VITE_ENABLE_INTERNAL_ROUTES` absent or false and document that `devBypass`/`VITE_DEV_USER` no longer grant app access. |
| P1 | Manual auth/profile truth | Manual testing exposed that fake local auth could show `PRO dev@speaksharp.app` while backend usage and Cloud token calls rejected the session. Source and tests now reject malformed fake sessions and keep Cloud disabled without real Cloud entitlement. | Users should never think about credential state after login; profile, usage, entitlement policy, and UI controls must agree. | Re-test with real Free/trial/Pro credentials only, then close this as live evidence. Keep manual app paths real-auth only. |
| P1 | Morning manual STT bug ledger | The May 30 manual STT run exposed a broad set of launch bugs: auth pollution, Cloud gating copy, Native bulk transcript dump, transcript disappearance after stop, Private setup ambiguity, analytics permission failure, and post-session navigation gaps. | This is the highest-signal human tester evidence so far; losing any item would create repeat churn or invalid evidence. | Work from the May 30 bug ledger before declaring RC-ready: close P0/P1 auth/profile/STT persistence items first, then analytics narrative and UI polish. |
| P1 | Live database entitlement evidence | Local migrations restore the Free baseline and remove old Basic mutation behavior, but the live database must prove it is running the latest `update_user_usage`, `effective_subscription_tier`, and tier configuration. | If production DB lags code, Free/trial/Pro entitlement behavior can drift from the product promise and create confusing access or revenue leakage. | Verify live `update_user_usage` does not write `subscription_status = 'basic'`, `effective_subscription_tier` falls back to `free`, and any `tier_configs.basic` row is absent or equivalent to Free. |
| P1 | SLO/SLC evidence before RC tag | Service-level evidence can go stale quickly as CI and endurance fixes land. | Calling a commit release-ready without fresh evidence on the same SHA weakens the RC signal and makes support claims harder to defend. | After latest CI/deploy/canary are green, dispatch Service-Level Evidence, archive the generated artifacts, update `QUALITY_METRICS.md`/service-level evidence pointers, then run RC gates on the same SHA. |
| P1 | Stripe live-key cutover | Current billing evidence is intentionally test-mode/sandbox. Production Pro checkout still needs live key, live price, and live webhook proof. | Broad public launch cannot rely on test-mode Stripe evidence, but changing live billing credentials during red RC gates risks confusing release debugging. | After RC gates are green, configure live Stripe env vars, run one controlled live Pro checkout/webhook entitlement proof, verify `cs_live_...`, then cancel/refund as needed and record evidence in the public-launch ledger. |
| P1 | Stripe customer identity persistence | Checkout currently uses `customer_email` and does not persist `stripe_customer_id` from completed checkout events. | A returning user can create duplicate Stripe Customer records, future billing-portal support has no stable customer ID, and repeated checkout attempts increase double-subscription risk. | Before live-key production cutover, read `stripe_customer_id` from `user_profiles`, pass `customer` when available, persist Stripe customer IDs from webhook events, and test repeat checkout behavior. |
| P1 | AI suggestions server-side quota | `get-ai-suggestions` caches per saved session but has no server-side per-user request ceiling. | Client-side throttles can be bypassed; a trial/pro user could script repeated Gemini calls and burn quota or cost. | Add a database-backed hourly/daily AI suggestion counter or equivalent API-gateway limit, return an explicit 429-style response, and include the limit in service-level/evidence docs. |
| P1 | Session save and draft recovery | Route-exit teardown now stops recording before destroying the session, but failed session completion still lacks a durable retry/draft recovery path. | Losing or nearly losing a long practice session is a high-churn event for Free and Pro users. | Design a persistent local draft/retry path for transcript/session completion failures; keep it separate from RC safety patches unless fresh testing shows active data loss. |
| P2 | Ergonomic information architecture review | Core pages are functional, but the product has not had a formal "can a first-time user find the next obvious thing?" pass across Session, Analytics, Pricing, Auth, and Home. | Confusing placement or hidden next actions can make an otherwise useful product feel harder than it is. | Run a page-by-page task map for recording, saving, reviewing, exporting, changing mode, seeing goals, and upgrading. Keep actions in expected locations and remove layout surprises. |
| P2 | Trial workflows | Trial setup now lives in the database entitlement layer and live-release matrix. | No separate tester-code workflow remains after automatic trial cutover. | Closed by automatic trial cutover. |
| P2 | CI performance | Split setup actions into minimal paths: `setup-node-pnpm`, `setup-playwright`, `setup-supabase`, `setup-deno-edge`, and `setup-report`. | CI Audit can exceed the improved target when edge/report setup drags, slowing iteration without implying product failure. | Optimize after release correctness gates are green. |
| P2 | Workflow consolidation | Previously, `create-user.yml`, `query-users.yml`, and `setup-test-users.yml` split test-user administration across three workflows. | Some evidence could be mislabeled if admin-created accounts were confused with public signup/trial evidence. | Consolidated into `setup-test-users.yml` as `Test User Admin` with `setup`, `query`, and `create` actions. |
| P2 | RC/CI reporting performance | Final report aggregation and RC Gate 3 setup can take longer than the actual product test work. | Slows release feedback even when all product gates are green. | Include report-job minimization in the CI setup split: install only report dependencies and avoid unnecessary Playwright/Supabase setup for report-only work. |
| P2 | Session UI polish | Session page still has post-release polish opportunities around exact hierarchy density, mobile screenshots, and final visual tuning beyond the controlled-tester flow. | The page can be improved, but current controlled desktop tester gates are no longer blocked by Session layout/status. | Schedule after controlled-tester release. Keep any follow-up visual work separate from STT lifecycle changes and validate with screenshots. |
| P2 | Manual mic proof environment | Agent-run Chrome CDP evidence is not the same as a normal human speaking into a physical mic. | Public-launch claims should not overstate CDP proof as `manual-real-mic`. | Keep evidence labels explicit. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
| P2 | Manual validation tooling | During the Free/Pro live walkthrough, the Codex in-app browser became wedged on `/session`; navigation away and creating a clean tab timed out at `about:blank`. A later dedicated Chrome CDP session on port `9222` allowed Free and Pro UI operation, but it still needs clear evidence labeling because Chrome was launched with mic permission auto-allow and speech stimulus came from macOS `say`. | Tool choice can change the apparent STT result, and mislabeled evidence can create false confidence or false blockers. | Prefer the dedicated Chrome CDP session for agent-operated live UI checks. Label evidence as `Chrome CDP live UI`, include account source, media setup, and artifact paths. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |

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
| P1 | Rerun Native real-mic proof on current main | Native | Must verify save/detail equality, formatter quality, trust labels, no false local copy. | test-release-agent / Codex |
| P1 | Rerun Private human proof on current main | Private | Must verify explicit setup remains, cumulative draft text, improved accuracy, filler recall, Fix-A-v2 behavior, and detail equality. | test-release-agent / Codex |
| P2 | Run richer Cloud baseline metrics proof | Cloud | Current-head deployed smoke passed (`26960691857`, `1/1`); collect full timeline, tail/readability, WER, and clean transcript-only evidence after Native/Private are less blocked. | test-release-agent / Codex |
| P2 | Keep stale deploy chunk recovery on radar | Whole app / STT funnel | Prior proof showed generic `Oops` for stale dynamic import chunk; not retested in current human proofs. | @dev-agent if still reproducible |

## May 30 Manual STT Live-Test Ledger

| Priority | Finding | Current Status | Follow-up |
|---|---|---|---|
| P0 | Fake `devBypass`/local auth showed `PRO dev@speaksharp.app` while backend calls rejected the token. | Fixed and committed: manual auth/profile paths no longer create or rescue fake Pro profiles; malformed stored sessions are ignored before backend requests. | Re-test with real Free/trial/Pro credentials only. Local auth regression tests passed 10/10 on May 30. |
| P0 | Cloud mode was selectable but start failed with "requires authentication" while the UI showed signed-in Pro. | Code path fixed/covered: Cloud entitlement is computed from real profile + Cloud entitlement only, the dropdown disables Cloud without `canUseCloudStt`, and manual fake auth no longer grants Cloud. | Re-test Cloud with a real Pro account that has `stripe_subscription_id` or `subscription_id`. Local Session/recording UI entitlement tests passed 18/18 on May 30. |
| P0 | Analytics displayed raw Supabase URL and `permission denied for table sessions`. | Fixed locally: session fetch errors and Analytics error UI now show sanitized recovery copy; new migration grants authenticated table privileges while RLS keeps owner isolation. | Deploy/verify migration in live DB. |
| P0 | Error boundary exposed `Cannot access 'privateModelStatus' before initialization`. | Fixed locally: initialization order corrected and app/global error boundaries no longer show raw exception messages. | Keep focused regression tests in quality lane. |
| P1 | Native transcript appeared as a bulk dump at stop, then visible transcript disappeared. | Partially fixed locally: transcript projection now preserves live partial text, promotes final text, clears stale partials, and capitalizes the first visible letter. | Add/collect live Chrome evidence for initial silence followed by speech. |
| P1 | First letter of transcript must be capitalized. | Fixed locally in speech-recognition utils, session store projection, and final transcript controller path. | Keep regression tests in quality lane. |
| P1 | Private setup CTA looked ambiguous and duplicate "setup needed" confused the mic area. | Known UX issue; Session layout is frozen per product direction for now. | Revisit only after current functional bug batch is stable. |
| P1 | Profile sync failure led to Refresh App / Retry Sync / Sign Out friction; Refresh App could feel like logout. | Fixed locally: recovery now defaults to Retry Sync and removes the hard-refresh action from the profile failure panel. | Re-test with a real interrupted profile request after auth cleanup lands. |
| P1 | Cloud STT could not be manually proven because account/session state was polluted. | Still open as evidence, not policy theory. | Use real Pro account and preserved console logging after auth cleanup lands. |
| P2 | Missing commas/periods and sentence punctuation quality in Native transcript. | Backlog only. Do not ship custom regex punctuation/casing in the Native hot path; use a trusted punctuation restoration API/model or provider-supported formatting path before claiming this fixed. | Capture Native punctuation/casing defects in evidence, then evaluate a trusted off-the-shelf formatter separately from STT lifecycle and duplication fixes. |
| P1 | (Independent review F2, DEV-partially-confirmed) Private `utteranceAudioChunks` resets at utterance/reset boundaries; there is **no sliding-window overlap across utterances**, unlike drop-in harnesses that feed overlapping/preceding context. Plausible cause of boundary phoneme mutation (e.g. "chewed up"→"tune up") and a likely facet of the open v2 app-vs-drop-in parity gap. | Open (dev task #37). Hypothesis, NOT a confirmed defect — needs A/B proof before any pipeline change. | Test vision: A/B same audio through (a) app per-utterance path vs (b) overlapping sliding-window drop-in; compare WER + boundary-word accuracy at utterance starts. Only patch if overlap measurably closes the parity gap. |
| — | (Independent review F1 & F4 — REVIEWED, REFUTED by DEV, no action) F1 "audio DSP distortion by default": FALSE — product default is `RAW_AUDIO_CONSTRAINTS` (echo/noise/AGC **off**); DSP-on is a **test-only** opt-in (`?privateMicConstraints=default`), surfaced in `__PRIVATE_MIC_CONSTRAINTS_DEBUG__.mode`. F4 "stop-tail silence bypass → hallucination": MOSTLY FALSE — low-energy forced tail is **dropped before inference** (`PrivateWhisper.ts:1162`), tiny/unsupported tails dropped (1471/1490), and the forced tail is fallback-only behind the whole-utterance commit (1678). | Closed (no defect). | TEST may confirm via proof artifacts: `__PRIVATE_MIC_CONSTRAINTS_DEBUG__.mode === 'raw'` in default runs; no low-energy tail decode in the Private timeline. |

## DEV OWNERSHIP — Accuracy / Efficiency / Performance workstream (owner: dev-agent / claude)

Claiming the A/E/P STT optimization workstream. **Owner: dev-agent (claude).** Items I am taking:

| Item | Domain | Status (owner: dev-agent) |
| --- | --- | --- |
| **F2 / #37** Private cross-utterance audio overlap (no sliding-window context across utterances → boundary phoneme mutation, e.g. "chewed up"→"tune up") | **Accuracy** | 🔧 IN PROGRESS — building app-vs-drop-in windowing A/B harness; change pipeline only if overlap measurably closes the v2 parity gap |
| **F5 / #36** provisional length-bias selecting hallucinations | **Accuracy** | ✅ DONE (merged `24d719e3`) |
| **F3 / #38** asterisk sanitizer length cap | **Accuracy/cleanliness** | ✅ DONE (merged `24d719e3`) |
| **Private v2 app-vs-drop-in parity** (browser `63.22%` < drop-in) | **Accuracy** | DEV fixes the exact boundary once TEST's clean capture isolates it (resampler already exonerated by DEV) |
| **Private v4 runtime** (`invalid data location: undefined for input "a"`) | **Accuracy + Efficiency** (unlocks faster v4 path) | ⏸️ ON HOLD per owner — WIP on branch `fix/v4-runtime-q8-decoder`; resume on signal |
| **Native formatter cost/volume guard / #35** | **Efficiency/cost** | ✅ DONE (merged `28742394`) |
| **Private post-Stop finalize latency** | **Performance** | ✅ already reduced (status-before-wait + bounded final-decode window); reverify after #37 |
| **NEW: A/E/P hot-path audit** (audio capture → resample → chunk → decode → commit → display) for accuracy/efficiency/perf defects | **All three** | 🔍 DEV — scoping next; findings will be added here with owner=dev-agent |
| **Phase 2: Replace RMS heuristics with neural VAD (post-release)** — retire Fix-A/RMS silence-gating in favor of Silero VAD (`@ricky0123/vad-web`); prove against the worst rows | **Accuracy** | 🔭 POST-RELEASE / branch-flagged — prototype behind a flag, run RMS-vs-VAD side-by-side on the worst rows (h1_6, the human-failure script, the v2 app-vs-drop-in parity gap), and replace heuristics only if VAD beats RMS with **zero guard-row regression**. Do not ship before release. |

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

### Lane 1 — Release blockers (MUST fix before beta)

| # | ID | Finding | Evidence | Disposition / action | Owner | Found by |
|---|---|---|---|---|---|---|
| 1 | SECURITY-SECRETS | Committed secrets in tracked `.env.test` (root) + `frontend/.env.test` — `SUPABASE_SERVICE_ROLE_KEY` (full DB/RLS bypass), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ASSEMBLYAI_API_KEY`, test passwords. In HEAD + history (gitignored only *after* commit). | `git show HEAD:frontend/.env.test` → service-role + stripe secret keys; secret-pattern hits 2 (frontend) / 1 (root). | **Incident, not cleanup.** (a) ROTATE service-role + Stripe secret/webhook + AssemblyAI keys + any real test passwords → **product/ops (dev cannot rotate)**. (b) dev: `git rm --cached` both, add `.env.test.example` placeholders, confirm `.gitignore`, harden `rc-secret-scan.mjs` + pre-commit. (c) history-purge decision (defer if repo private + keys rotated; purge before any public exposure). | product/ops + dev | dev only |
| 2 | AUDIO-FIXTURES | `tests/fixtures/jfk_16k.wav` and `test-audio.wav` are **HTML, not WAV** → can validate STT against HTML bytes (false-green). | `file` → "HTML document text"; no RIFF/WAVE header. | Replace with real WAV; add fixture sanity test (RIFF + WAVE + nonzero duration + sample rate); mark prior proofs depending on them INVALID; STT harness precheck before scoring. | dev + test | both |
| 3 | NO-HF-FALLBACK | Main-thread Private fallback hardcodes `whisper-tiny.en` and, on local-load failure, sets `allowRemoteModels=true` + loads `Xenova/whisper-tiny.en` from Hugging Face; DEFAULT model fallbackPath = `local-then-remote`. Contradicts no-HF/self-host + base-default. | `TransformersJSEngine.ts` l.253/273/276/590. | **Recommend strict no-HF for beta:** selected-model-aware main-thread fallback, `allowRemoteModels=false`, clear "local model unavailable" error, add test that blocks/detects HF domains. (Alt: accept HF resilience → soften the no-HF claim.) | dev (+ product policy) | test only |
| 4 | UX-ENGINE-FROZEN | "Speech recognition is taking a moment (Engine Frozen)" fires during *healthy* Native recognition → trust hit. | `TranscriptionService.ts:1591`. | Native-aware watchdog (interim activity = alive); only warn on a confirmed stall; safer copy. | dev | both |
| 5 | UX-PAYMENT-CTAS | Upgrade CTAs render when payments disabled and no-op/link to dead pricing: AnalyticsPage button renders ungated (handler silently returns), `AnalyticsDashboard` secondary, `SunsetModals` → `/pricing`. | `AnalyticsPage.tsx` l.62 render vs l.128 handler-gate; `SunsetModals.tsx` l.44/72/89. | **Render-gate** every upgrade/payment CTA on `arePaymentsEnabled()` (not just the handler); else relabel "Premium features coming soon". No dead buttons. Public checkout only if `stripeKeyClass==='live'`. | dev | both |
| 6 | FIX-RLS-DELETE | `backend/supabase/functions/fix-rls` — dead stub: wildcard CORS (`*`), unused service-role client, "use dashboard SQL"; **not in deploy workflow**. | function body; `deploy-supabase-migrations.yml` does NOT list `fix-rls`. | Delete (confirmed undeployed). If ever kept, move to internal/admin script + remove public edge shape + wildcard CORS. | dev | both |
| 7 | FEEDBACK-GATE | "Report Issue" must not be visible-but-broken. | Current release proof `/private/tmp/prod-rerun-proof-1780861749917.json`: release `f9204d539091116759b859d31b739b4a6363e5d1`, fresh signup, visible Report Issue, HTTP 201 insert to `user_issue_reports`, `includeTranscript=false`, `includeAudio=false`, success text. | **Closed for beta:** keep visible. Reopen only if a later release build regresses or product requires attachment opt-in variants before beta. | test | dev supplement |

### Lane 2 — Release hygiene (fix if low-risk, else document; do NOT block beta on these alone)

| ID | Finding | Disposition | Found by |
|---|---|---|---|
| DEBRIS-CLEANUP | Tracked output dumps: `baseline_manifest.txt`, `consolidated_manifest.txt`, `e2e_errors_detailed.txt` (empty), `unit-results.txt`, `frontend/test_failures_v7.txt`. | `git rm` + add ignore patterns. | both |
| STALE-COORD | `product_release/ACTIVE_COORDINATION.md` claims source-of-truth but live board is `/private/tmp`; pins stale `origin/main`. | Tombstone pointer or delete. | both |
| STALE-DOCS | Legacy private-mode terminology + `:5173` in release docs/evidence — **not** in user-facing `frontend/src` (a guard test forbids the term). | Update active docs/templates; leave historical evidence only when intentionally historical. | test only |
| ENV-PROD-TRACKED | `frontend/.env.production` tracked — all `VITE_*` (client-public), **not a secret leak**, but unusual. | Policy decision; keep or move to host env. | dev only |
| BUILD-WARNINGS | Large chunks; modules both dynamically+statically imported (defeats splitting); `onnxruntime-web` eval warning. | Chunking pass; non-blocking. | both |
| FORMAT-TRANSCRIPT-EDGE | `format-transcript` (Gemini Native formatter) is **deployed**; client call path is pending the unresolved Native formatter decision. | If Native simplification is final: hard-disable client call for beta + leave edge fn unused or drop from deploy manifest; keep code if rollback wanted (behind false flag + test proving no Native call). | dev (gated on formatter decision) | dev |

### Lane 3 — Post-beta cleanup (DO NOT TOUCH before beta)

| ID | Finding | Disposition | Found by |
|---|---|---|---|
| PARKED-ENGINE-QUARANTINE | whisper-turbo / WebGPU / v4 cluster (~55 MB): `models/tiny-q8g16.bin` (49 MB), `whisper-turbo/*` (~6 MB), `WhisperTurboEngine.ts`, `webgpuSupport.ts`, `benchmark-webgpu.live.spec.ts`, `patches/whisper-turbo@0.11.0.patch`, deps `whisper-turbo`/`whisper-webgpu`, **duplicate mocks** (`tests/__mocks__/whisper-turbo.ts` + `tests/mocks/whisper-turbo.ts`), provider entries `transformers-js-v4` + `whisper-turbo`. **Parked, not dead** (registered + cross-cutting). | **Quarantine for beta** — ensure not user-selectable / not preloaded / not in default bundle path; **do NOT delete piecemeal**. Full retirement in a dedicated post-beta branch + full suite. | both (dev: dup mocks) |
| DEAD-SCRIPTS | ~48/87 `scripts/` unreferenced (heuristic; CI aggregators are false positives). | depcheck/dependency-cruiser sweep; prune per-file post-beta. | dev only |
| UNUSED-DEPS | Not exhaustively checked. | Run `depcheck` + `.dependency-cruiser.cjs` post-beta. | dev |
| PLAYWRIGHT-CONFIGS | 9 root playwright configs — confirm each is invoked; prune unused. | Post-beta. | dev only |
| MODELS-OBJECT-STORAGE | ~115 MB Whisper base+tiny blobs are plain Git (post-LFS). | Move to object storage (Supabase Storage/Vercel Blob), runtime fetch + long cache. Post-beta. | dev |
| LOCAL-IGNORED-BLOAT | `frontend/dist` ~245 MB, `test-results` ~108 MB, `dist-e2e` ~94 MB, `lighthouse-results` ~58 MB — all **gitignored** (not shipped). | **Not a repo/release issue** — optional local `rm -rf`. | both |

### Suggested execution order (for the fix phase, after this inventory is approved)
1. SECURITY-SECRETS → 2. AUDIO-FIXTURES → 3. NO-HF-FALLBACK → 4. UX (Engine Frozen + payment CTAs) →
5. FIX-RLS-DELETE → 6. FEEDBACK reconfirm → 7. DEBRIS/STALE-DOC cleanup → 8. PARKED-ENGINE quarantine (no piecemeal deletion).

### Beta GO/NO-GO
**NO-GO** while any Lane 1 item is open. **GO when:** secrets rotated/removed; valid audio-fixture checks pass + final STT proofs rerun on valid fixtures; Private base-default/local-only/no-HF proof passes; Native funnel works without scary copy; feedback works-or-hidden; payment hidden unless Stripe live; v4 off; CI/canary/deploy green. **A fully pruned repo is NOT required for beta** — a safe, honest, non-misleading product is.

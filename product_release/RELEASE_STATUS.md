# Release Status

**Last updated:** 2026-06-17 · Last updated by: dev-agent (claude), RC-gate evidence run 27708194872
**Scope:** Single source of truth for current release posture.

If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational docs and RC gate docs; current ship status lives here only.

## Current Decision

| Release Track | Status | Why |
|---|---|---|
| Controlled soft release | HOLD / VALIDATION IN PROGRESS | The release evidence model has been refactored into pushed checkpoints. GitHub must finish the latest `CI - Test Audit`, production smoke, Supabase deploy, and any explicitly requested RC gate reruns before tester invites. |
| Broad public launch | NO-GO | Live billing/mobile/public-launch gates are broader than the controlled tester scope and remain separately gated. |

## Latest Evidence

| Area | Latest Evidence | Status |
|---|---|---:|
| RC gates | ✅ All 5 gates GREEN on `main@596a6950` — `Release Candidate Gates` `gate=all` run `27708194872` (Gate 1 Product / 2 SAST / 3 DAST / 4 SCA / 5 UX). Live-DAST: 9 passed, 2 env-gated skips. The Gate-3 flaky 7-min hang was fixed (#821/#822 bounded the live-harness mode-select waits — a test-harness defect, not a product regression). Re-run on the exact final signoff SHA before tester invites. | PASS (2026-06-17) |
| CI/Test Audit | Green on `main` (run `27684865346` @`b18220da`; #820/#821/#822 each passed required CI before squash-merge) | GREEN |
| Production smoke | Push-triggered `Production Canary Smoke Test` remains the production quick-check workflow | IN PROGRESS / CHECK GITHUB |
| Supabase deploy | Push-triggered deploy workflow remains the backend/Edge deploy proof when backend paths change | IN PROGRESS / CHECK GITHUB |
| Ops health | Hosted ops status is a high-level display fed by the authoritative GitHub/Supabase JSON evidence path | CHECK CURRENT DASHBOARD |
| Software quality | `SOFTWARE_QUALITY.operational.md`; generated artifacts `product_release/evidence/software-quality.latest.*` uploaded by CI | ADVISORY / EVIDENCE |
| Service levels | `SERVICE_LEVELS.operational.md`; backend stress and browser endurance artifacts from `stress-endurance.yml` | ADVISORY UNLESS PROMOTED |
| Private deployed worker | Gate 3 passed after the Vite `?worker&url` worker fix | PASS |
| Native Browser STT | Chrome desktop real mic uses `continuous=true`, `interimResults=true`, `maxAlternatives=1`; Native corpus/WER is not a benchmark gate | PASS WITH BROWSER CAVEAT |
| Cloud STT | Cloud-only Pro STT Artifact Matrix run `26762814579` passed after Supabase migration/function deploy run `26762736418`; transcript, save/history/detail, AI suggestions, and PDF export completed on `main` commit `7431e843` | PASS FOR CLOUD PRO PATH |
| Benchmarks | Vendor numbers verified + INTERNAL-ONLY (no customer vendor-vs-SpeakSharp comparison); v4 reproducible facts = WebGPU floors + Gate 2 + Gate B (`tests/STT_BENCHMARKS.json` `_measurement_framing`). v4 Node-ceiling re-measure = post-launch backlog. Native excluded from WER claims. | ADVISORY / INTERNAL |
| Gate B (v4 A/B) | Read-only verified for operator `22899590` (selectionSource=posthog_flag, base_q4, no fallback, sessions saved); flag OFF/0% for everyone else | VERIFIED — A/B flip = owner's call |

## Current Blockers

| Priority | Blocker | Required Closure |
|---|---|---|
| ✅ RESOLVED | Latest pushed `main` green required workflows | `main@596a6950`: CI-Test-Audit + Production Canary + Deploy Supabase green; RC `gate=all` run `27708194872` all 5 gates green. |
| P0 | RC gates are manual (not tag-triggered) | They currently PASS (run `27708194872`); re-dispatch + pass once on the exact final signoff SHA before tester invites. |
| P1 | Stress/endurance evidence is newly structured | Use `stress-endurance.yml` artifacts for backend p50/p95/counts and browser endurance memory evidence; advisory unless stability is release risk. |
| P1 | Private and Native STT remain below the Cloud proof standard | Private needs timing/parity fixes; Native needs live-text consistency and punctuation/readability proof before either can be claimed as launch-quality. |
| P2 | Ops health display is intentionally high-level | If hosted ops status is red/yellow, inspect the richer GitHub/Supabase JSON evidence rather than reconciling a second query source. |

## STT Release Positioning

| Engine | Release Role | Current Claim Boundary |
|---|---|---|
| Private v2 | Controlled, benchmarkable local STT path | In our control; suitable for benchmark automation once current artifacts are refreshed. |
| Private v4 | Controlled, benchmarkable worker-backed local STT path | In our control; WIP benchmark evidence must replace mini-corpus seed data. |
| Cloud | Controlled, provider-backed STT path | Current strongest/pristine STT candidate. Cloud-only Pro artifact run `26762814579` passed live transcript, stop/save, history/detail, AI suggestions, and PDF export. Paid Early Access entitlement required. |
| Native Browser | Browser-dependent convenience STT | Chrome desktop recommended. Do not use Native fixture/WER as release benchmark evidence unless the exact audio route is proven. |

## Known Limitations

- **Private (Whisper) short-clip repetition.** On short or ambiguous audio, Whisper may repeat a phrase in the transcript (a known model failure class around silence/non-speech regions), which can inflate filler counts and short-clip WER. Long-form transcription is unaffected (Washington fixture ~98.95%). For this release we **preserve the raw model output rather than deleting text that may reflect real speech** — prior aggressive de-duplication was reverted for data integrity, and decode-param tuning A/B'd worse. The saved transcript is flagged (non-mutating `detectRepetitionRisk` → `repetitionRisk` evidence fields), not altered. **The principled fix (VAD / audio segmentation) is queued as the next STT reliability lane (STT-P5).**

## Tester Scope

Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` for human tester copy. The tester path is:

1. Fresh account starts with free Browser transcription.
2. Private sample model download/setup if prompted.
3. Private sample recording, transcript, stop/save, history/detail, analytics.
4. Custom word added through UI and spoken during recording.
5. PDF export from saved session.
6. Optional Browser transcription in Chrome with browser-dependent wording.

## Evidence Freshness Contract

Each release gate is green only when the definition of green is backed by a named artifact that a reviewer can inspect without relying on operator memory. The active artifact is always the latest complete passing run. If a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`.

## Quality And Service-Level Evidence

Quality and service-level data are evidence, not PRD content:

- Product promises and user-visible guarantees live in `PRD.operational.md`.
- Quality interpretation lives in `SOFTWARE_QUALITY.operational.md`.
- SLO/SLC/SLA definitions and target interpretation live in `SERVICE_LEVELS.operational.md`.
- Generated software-quality artifacts are produced under `product_release/evidence/` during CI and uploaded as artifacts.
- Backend stress and browser endurance artifacts are produced by `stress-endurance.yml` and are advisory unless explicitly promoted by this file or `RC_GATES.md`.

## Named STT Gate Artifacts

| Gate | Required Current Artifact |
|---|---|
| G6 Fresh Trial Private STT Transcript/Save/History Path | `/private/tmp/speaksharp-private-human-[timestamp].json`; must include `SESSION_LIFECYCLE_WARMUP`, model setup/download state, chunk RMS/duration rows, first partial timestamp/text, console events, save result, and history/detail proof. |
| Native Browser Chrome human-mic proof | `/private/tmp/speaksharp-native-[timestamp].json`; must include event order from `onspeechstart -> first onresult`, selected transcript on stop, save/history/detail proof, analytics proof, and no unintended 4-word sequence appearing more than once. |
| Cloud Pro proof | `/private/tmp/cloud-artifact-[timestamp].log` (latest: GitHub Actions run `26762814579`, artifact `/private/tmp/pro-stt-artifact-matrix-26762814579/`); must show AssemblyAI token HTTP 200, transcript/save/history/detail proof, AI suggestions, PDF export, and Pro entitlement context. |
| Custom word analytics proof | Browser/session artifact showing words such as `like = 1` or `basically = 1` after adding the custom word through the UI, then saving and opening detail/analytics. |
| PDF export proof | Saved-session PDF artifact whose transcript, duration, WPM, filler/custom word counts, and session metadata match the saved detail view within ±15%. |
| Session Status UX | Screenshot/video or browser trace showing one clear status/progress surface, Private setup/download/ready states, and no duplicate or internal FSM/debug status obstructing the user flow. |

## Update Rule

Only this file should receive changing release status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence.

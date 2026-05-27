# Release Status

**Last updated:** 2026-05-26
**Scope:** Single source of truth for current release posture.

If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational docs and RC gate docs; current ship status lives here only.

## Current Decision

| Release Track | Status | Why |
|---|---|---|
| Controlled soft release | HOLD | Local fixes now pass `pnpm ci:unit` and the formerly failing E2E shard shape, but the fixes are not yet pushed and GitHub has not rerun on the release branch. |
| Broad public launch | NO-GO | Live billing/mobile/public-launch gates are broader than the controlled tester scope and remain separately gated. |

## Latest Evidence

| Area | Latest Evidence | Status |
|---|---|---:|
| RC gates | `Release Candidate Gates` run `26468665191` on `main` | PASS |
| CI/Test Audit | GitHub run `26471011112` is red on old `main`; local rerun after fixes: `pnpm ci:unit` passed with 119 files / 873 tests / 1 todo | LOCAL PASS / PUSH PENDING |
| E2E shard 2 | GitHub `e2e-shard-2` failed startup diagnostic on old `main`; local rerun after helper fix: `full-suite --shard=2/4` passed 13/13 | LOCAL PASS / PUSH PENDING |
| Production canary | `Production Canary Smoke Test` run `26471011114` on `main` | PASS |
| Ops health | Local `pnpm ops:health` generates the simplified v1 software/API board; GitHub secret-backed rerun is pending after push | LOCAL ARTIFACT / PUSH PENDING |
| Private deployed worker | Gate 3 passed after the Vite `?worker&url` worker fix | PASS |
| Native Browser STT | Chrome desktop real mic uses `continuous=true`, `interimResults=true`, `maxAlternatives=1`; Native corpus/WER is not a benchmark gate | PASS WITH BROWSER CAVEAT |
| Cloud STT | Paid-Pro Cloud remains explicit Pro path; Free/trial denials are expected entitlement behavior | PASS FOR TESTER SCOPE WHEN PAID-PRO PROOF IS USED |
| Benchmarks | Private v2/v4 benchmark automation is WIP; Native excluded from WER claims | WARN |

## Current Blockers

| Priority | Blocker | Required Closure |
|---|---|---|
| P0 | Latest GitHub `CI - Test Audit` is still red on old `main` | Push local fixes and rerun CI; GitHub must replace the old red run with a green run before tester invites. |
| P1 | Benchmark WIP is dirty and not yet durable | Commit or discard the benchmark workflow/manifest/spec changes only after validating the benchmark path. |
| P1 | Markdown consolidation in progress | Current docs now use `RELEASE_STATUS.md` for changing posture and archive superseded packets; final push/rerun still pending. |
| P2 | Ops health needs authoritative GitHub run | Local shell lacks GitHub Actions secrets, so local rows show `NOT READY`; push changes and dispatch `ops-health.yml` for the secret-backed result. |

## STT Release Positioning

| Engine | Release Role | Current Claim Boundary |
|---|---|---|
| Private v2 | Controlled, benchmarkable local STT path | In our control; suitable for benchmark automation once current artifacts are refreshed. |
| Private v4 | Controlled, benchmarkable worker-backed local STT path | In our control; WIP benchmark evidence must replace mini-corpus seed data. |
| Cloud | Controlled, provider-backed STT path | Benchmarkable against fixtures; paid-Pro entitlement required. |
| Native Browser | Browser-dependent convenience STT | Chrome desktop recommended. Do not use Native fixture/WER as release benchmark evidence unless the exact audio route is proven. |

## Tester Scope

Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` for human tester copy. The tester path is:

1. Fresh account with automatic one-hour trial.
2. Private model download/setup if prompted.
3. Private recording, transcript, stop/save, history/detail, analytics.
4. Custom word added through UI and spoken during recording.
5. PDF export from saved session.
6. Optional Browser transcription in Chrome with browser-dependent wording.

## Evidence Freshness Contract

Each release gate is green only when the definition of green is backed by a named artifact that a reviewer can inspect without relying on operator memory. The active artifact is always the latest complete passing run. If a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`.

## Named STT Gate Artifacts

| Gate | Required Current Artifact |
|---|---|
| G6 Fresh Trial Private STT Transcript/Save/History Path | `/private/tmp/speaksharp-private-human-[timestamp].json`; must include `SESSION_LIFECYCLE_WARMUP`, model setup/download state, chunk RMS/duration rows, first partial timestamp/text, console events, save result, and history/detail proof. |
| Native Browser Chrome human-mic proof | `/private/tmp/speaksharp-native-[timestamp].json`; must include event order from `onspeechstart -> first onresult`, selected transcript on stop, save/history/detail proof, analytics proof, and no unintended 4-word sequence appearing more than once. |
| Cloud Pro proof | `cloud-artifact-[timestamp].log`; must show AssemblyAI token HTTP 200, transcript/save/history/detail proof, and paid-Pro entitlement context. |
| Custom word analytics proof | Browser/session artifact showing words such as `like = 1` or `basically = 1` after adding the custom word through the UI, then saving and opening detail/analytics. |
| PDF export proof | Saved-session PDF artifact whose transcript, duration, WPM, filler/custom word counts, and session metadata match the saved detail view within ±15%. |
| Session Status UX | Screenshot/video or browser trace showing one clear status/progress surface, Private setup/download/ready states, and no duplicate or internal FSM/debug status obstructing the user flow. |

## Update Rule

Only this file should receive changing release status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence.

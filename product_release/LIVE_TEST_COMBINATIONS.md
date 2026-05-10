**Owner:** [unassigned]
**Last Reviewed:** 2026-05-08
**Version:** v0.6.18
**Last Updated:** 2026-05-10

# Live Test Combinations Matrix

This matrix defines the production-browser validation surface for MVP test release. CI proves mocked orchestration; this matrix proves real user behavior against deployed infrastructure, real browser capabilities, real auth, and real persistence.

## Release Rule

A path is green only when all required checks pass:

1. User can reach the path with the expected tier/entitlement.
2. Recording starts and stops through explicit user action.
3. Transcript or explicit no-speech state is shown.
4. Session save completes or a clear recoverable error is shown.
5. Returning-user view can load the saved analysis state.
6. Analytics/export behavior matches the tier and STT mode.

## Tier × STT Mode Matrix

| User/Tier | Native STT | Private CPU STT | Private WebGPU STT | Cloud STT | Required Before Test Release |
|---|---|---|---|---|---|
| Anonymous visitor | Not required; CTA should route to auth/pricing | Not available | Not available | Not available | Verify no unauthenticated recording path. |
| Free legacy user | Start/stop/save allowed within quota until Basic migration | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Validate legacy behavior until Free -> Basic migration is intentionally executed. This migration is parked until current bugs are cleared, then becomes a pre-human-tester business gate. |
| Basic future user | Start/stop/save allowed within paid baseline quota | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Parked until live STT, analytics, promo, and CI gates are flat; then implement before broad human tester rollout. |
| Promo Pro tester | Start/stop/save allowed | Required: CPU-first setup, transcript, save, history | Manual accelerated-path evidence only | Explicitly selectable; token must be usage-gated | Primary human tester route. |
| Paid Pro user | Start/stop/save allowed | Required: CPU-first setup, transcript, save, history | Manual accelerated-path evidence only | Explicitly selectable; token must be usage-gated | Required before charging real users. |
| Expired promo user | Continue as baseline tier or enter new promo/upgrade | Blocked with clear expired-promo copy | Blocked with clear expired-promo copy | Blocked with clear expired-promo copy | Verify no stale Pro access. |
| Over-quota user | Blocked fail-closed | Private local path may be allowed only if product policy says quota permits; otherwise block consistently | Same as Private CPU | Token denied before paid Cloud cost | Verify quota messaging and fail-closed behavior. |

## Private STT Cache/Setup Matrix

| State | Expected Behavior | Required Evidence |
|---|---|---|
| First use, no cached CPU assets | Show explicit setup/download/progress state; initialize CPU/Transformers.js from same-origin assets; no silent Cloud switch. | Clear origin storage, start Private, capture progress/status, observe ready state. |
| Second use, CPU assets cached | Do not show a required download CTA; initialize from browser cache and allow recording. | Reload/login again, select Private, confirm faster ready path and recording. |
| WebGPU available | WebGPU/WhisperTurbo may be explicitly validated as acceleration; it must start quickly or fail fast. | Headed Chrome hardware run with explicit WebGPU path. |
| WebGPU unavailable/slow | CPU path proceeds without making the user wait on WebGPU. | Disable WebGPU/GPU and confirm CPU path. |
| Private setup failure | Show retry/recovery copy; present Native/Cloud only as explicit user choices. | Simulate missing asset or blocked model request. |

## Browser × Hardware Matrix

| Browser/Device | Native | Private CPU | Private WebGPU | Cloud | Required Before Test Release |
|---|---|---|---|---|---|
| Desktop Chrome | Required | Required | Manual acceleration evidence | Required for Pro | Yes |
| Desktop Safari | Required if supported; otherwise clear compatibility copy | Best-effort | Not required | Required if Cloud supported | Yes for mic/error UX |
| Firefox | Compatibility behavior required | Best-effort | Not required | Best-effort | Yes for unsupported messaging |
| iPhone Safari | Auth and mic permission behavior required | Not launch-critical | Not required | Best-effort | Yes for mobile trust |
| Bluetooth/external mic | Start/recover behavior required | Same session behavior as selected engine | Not required | Same session behavior as selected engine | Yes for recovery UX |

## Feature Combination Checks

| Feature | Native | Private CPU | Private WebGPU | Cloud |
|---|---|---|---|---|
| Live transcript appears | Required | Required | Required for acceleration claim | Required |
| Filler words counted | Required | Required | Required for acceleration claim | Required |
| Custom words persist to next session | Required | Required | Not separate if CPU passes | Required |
| Cloud keyterms boost | N/A | N/A | N/A | Required |
| WPM/clarity/pause analytics | Required | Required | Not separate if CPU passes | Required |
| Session-over-session comparison | Required | Required | Not separate if CPU passes | Required |
| PDF export with watermark | Required | Required | Not separate if CPU passes | Required |
| WER benchmark evidence | 🔴 Required; currently no valid numeric baseline | 🔴 Required; fixture/reference mismatch blocks a trustworthy run | Required for acceleration claim; hardware-specific | 🔴 Required; current manifest has no benchmark history |

### STT Benchmark Truth Status (2026-05-09)

| Engine | Current User-Facing Status | Known Blocker | Required Evidence |
|---|---|---|---|
| Cloud / AssemblyAI | Must not show an authoritative ceiling until rerun. | `tests/STT_BENCHMARKS.json` has `expectedAccuracy` but no history-backed WER. | `pnpm benchmark:cloud` with `ASSEMBLYAI_API_KEY`, recorded average WER, and manifest history entry. |
| Native Browser | Must show "not benchmarked" until rerun. | Current history has `trials: 0` and null WER. Local fake-audio run did not produce enough transcript for a valid score. | Browser benchmark with fake WAV input, successful transcript, average WER, and manifest history entry. |
| Private CPU / Transformers.js | Must show "not benchmarked" until rerun. | Fixture/reference mapping is locally corrected, but local run was blocked by mock `.env.test` credentials (`Invalid API key`); manifest expected/history values still conflict until rerun. | Successful CPU transcript with real Pro benchmark credentials, WER, and manifest history entry for the actual CPU runtime. |
| Private WebGPU / WhisperTurbo | Acceleration evidence only; not launch-blocking if CPU path is green. | Hardware/browser-specific and cannot be generalized to all users. | Headed local WebGPU run on supported hardware, recorded as acceleration evidence rather than a blanket Private ceiling. |

## Current Status

| Area | Status | Notes |
|---|---|---|
| Automated CI baseline | 🔴 Latest GitHub report job failed | `CI - Test Audit` passed on `56ce972` (run `25610699098`), but latest `1ea2b099` run `25611616096` failed because the report job could not find `test-results/playwright/results.json` after no E2E reports were merged. |
| Production canary | ✅ Passed post-deploy on `1ea2b099` | `deploy-supabase-migrations.yml` run `25620857952` passed, then `canary.yml` run `25620877113` passed. |
| Promo path | 🟡 Core live path verified / full artifact pending | Promo `1193119` granted Pro and reuse was rejected. Promo `4132867` granted Pro via Edge Function. Fresh non-promo signup/free behavior passed. Full promo artifact browser path still needs valid audio fixture and analytics/PDF proof. |
| Private CPU path | 🟡 DB/RPC persistence verified / browser transcript pending | Post-deploy DB/RPC smoke saved/read a `private` session for a promo Pro user with transcript, WPM, filler words, and clarity. Real browser Private transcript/cache validation is blocked because `tests/fixtures/10sec.wav` is an HTML document, not valid WAV audio. |
| Native path | 🔴 Mocked analytics persistence not green / real live not green | Analytics-truth testing showed in-session WPM/fillers changed, but persisted history/detail still showed stale/default values. Native benchmark fake-audio produced only one meaningful word, so no valid WER. |
| Cloud path | 🟡 Token gate partially live-verified / analytics pending | Live Free user received HTTP 403 from `assemblyai-token`; live active promo-Pro received HTTP 200 token with `expires_in:600`. Over-limit and expired-promo denial remain pending. Real Cloud analytics still requires a non-mocked live harness. |
| Analytics return path | 🔴 Not green | Agent Gate 2 found persisted analytics can diverge from live session values (`8WPM`, `0Fillers`, `100%Clarity` after live values changed). Patch probes are present, but full mocked/live validation remains open. |
| Expired promo path | 🟡 Deployed / live seeded smoke pending | Dialog is simplified to two aligned choices; backend guards now cover expired promo-only Cloud token and DB session/heartbeat paths. Effective-tier migration is deployed, but live seeded expired-promo smoke remains pending. |
| Toast/status/mobile UX | 🟡 Local fix / browser smoke pending | UI polish is pushed in `0d5f2cef`; production canary/CI are running. Manual visual pass still required after Vercel serves the new bundle. |
| STT WER evidence | 🔴 Not green | GitHub benchmark run `25611403312` failed. No new valid WER values exist for Cloud, Native, Private CPU, or WebGPU. |

## Validation Harness Findings

| Finding | Impact | Status |
|---|---|---|
| `tests/fixtures/10sec.wav` is HTML text, not WAV audio. | Blocks trustworthy browser Private transcript, WER, and fake-mic live validation. | 🔴 Must point live Playwright config/tests to a real app-contained fixture such as `tests/fixtures/harvard_benchmark_16k.wav`. |
| Full promo canary treats benign Private model/ONNX warnings as fatal diagnostics. | Full promo canary failed after Pro redemption/return succeeded. | 🟡 Core promo behavior verified separately; diagnostics allowlist should be tightened before making this spec required. |
| `apply-promo` returns wildcard CORS. | Hardening inconsistency with `check-usage-limit`; not a quota/privacy/session-save P0. | 🟡 Confirmed live; fix with shared request-aware CORS after current P0 validation unless policy requires immediate uniformity. |

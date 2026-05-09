**Owner:** [unassigned]
**Last Reviewed:** 2026-05-08
**Version:** v0.6.18
**Last Updated:** 2026-05-09

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
| Automated CI baseline | 🟢 Passing on latest pushed commit | `CI - Test Audit` passed on `56ce972` (run `25610699098`). |
| Production canary | 🟢 Passing on `56ce972` | GitHub production canary passed on `56ce972` (run `25610699109`); Edge Function deploy passed on the same push (run `25610699101`) and Supabase migration deploy passed on `7da01c8` (run `25606499810`). Keep required for deployed smoke. |
| Promo path | 🟡 Local fixes / deploy + live retest pending | Mocked promo coverage is included in the green CI gate, and prior live promo smoke proved generation/redeem/reuse rejection. Latest live promo testing confirmed the tester entitlement worked, but the Private artifact path failed at save with DB error `engine_not_allowed_for_tier`. Migration `backend/supabase/migrations/20260509000000_allow_private_engine_for_pro.sql` is pending deploy/retest before this path can go green. Local fixes now also deny expired promo-only Cloud token issuance and add DB effective-tier enforcement for session/heartbeat paths via `backend/supabase/migrations/20260509010000_enforce_effective_promo_tier.sql`. |
| Private CPU path | 🟡 Model served+initialized / transcript-save-history pending | Same-origin assets load locally, and latest live testing reached a served/initialized Private CPU model state. Live transcript, successful save, and history readback are still not proven because the deployed DB rejected the Private engine save for Pro. |
| Cloud path | 🟡 Local audio pump fix / live validation pending | Token issuance is usage-gated in code. 2026-05-09 code review found Cloud had a `processAudio()` streaming method but no central mic-frame caller. Local fix pumps mic frames to Cloud and analytics; targeted regression coverage passes. Live successful/over-quota checks pending. |
| Analytics return path | 🟡 Local patch / live validation pending | CI is green on `56ce972`. A newer local analytics correctness patch preserves persisted WPM/clarity values in comparisons. Local mic-frame pump fix now lets Native/Cloud pause metrics receive real audio frames instead of staying flat. Live returning-user comparison and input-change proof are still pending. |
| Expired promo path | 🟡 Local fixes / deploy + live smoke pending | 2026-05-09 visible-browser test found the expired Pro dialog could trap testers and block sign-out/signup navigation and presented too many choices. Local fix simplifies the dialog to two aligned choices: Continue as Free or Upgrade to Pro. Deploy/live verification pending. Local backend fixes deny expired promo-only Cloud token issuance and treat expired promo-only users as Free for DB session/heartbeat paths. |
| Toast/status/mobile UX | 🟡 Local fix / visual smoke pending | Visible-browser testing found toasts could cover important header/status content and mobile overlays had no clear hierarchy. Local patch keeps toasts top-right but narrows and offsets them below the nav, raises dialogs over toasts, hides the global mobile nav on `/session`, and adds bottom padding for the fixed recording action bar. |

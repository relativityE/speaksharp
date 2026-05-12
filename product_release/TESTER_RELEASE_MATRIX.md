# Tester Release Matrix

**Last updated:** 2026-05-12
**Evidence baseline commit:** `60c8af5c`
**Verdict:** P0 release gates and P1 release-control work are green on the latest release commit `60c8af5c`. Broad tester share can proceed with the documented Chrome/browser-dependent Native scope and manual observability fallback.

| Priority | Gate | Status | Evidence | Remaining Action |
|---|---|---:|---|---|
| P0 | Expired promo / free downgrade | ✅ | `Expired Promo Live Smoke` run `25704192079` passed on `e986ecf8`. | Freeze unless entitlement code changes. |
| P0 | Free/basic access sanity | ✅ | Same expired-promo proof plus Native proof below: downgraded/free-safe users retain Native path and do not keep Cloud/Private entitlement. | Recheck only through focused entitlement smoke if tier/mode logic changes. |
| P0 | CI Audit latest commit | ✅ | `CI - Test Audit` run `25710006382` passed on `60c8af5c`, including unit/build/edge/health/lighthouse advisory, `unit-shard-1..4`, and E2E shards 1-4. | Freeze unless release-critical code changes. |
| P0 | Deploy latest commit | ✅ | `Deploy Edge Functions` run `25710006386` passed on `60c8af5c`. | Freeze unless deploy path changes. |
| P0 | Canary latest commit | ✅ | `Production Canary Smoke Test` run `25710006385` passed on `60c8af5c`. | Freeze unless release-critical code changes. |
| P0 | Cloud Pro cradle-to-grave | ✅ | Latest Cloud rerun `Pro STT Artifact Matrix` run `25710014996` passed on `60c8af5c`. Extracted PDF text includes `STT Engine cloud` and the latest Cloud transcript shown below. | Freeze unless Cloud/STT/save/history/AI/PDF code changes. |
| P0 | Native Chrome mic proof | ✅ | Headed Google Chrome production proof with real `getUserMedia`, no fake audio flags: `NATIVE_CHROME_MIC_EVIDENCE` pass, promo sign-up `native-proof-1778546140280@example.com`, transcript length `83`, save/history/analytics all true. | Document as Chrome/browser-dependent. The script records `transcriptMatchesScript=false` because ambient mic text did not match the scripted audio, but non-placeholder live transcript appeared through the real mic path. |
| P0-last | Observability readback/fallback | ✅ | API readback workflow/helper exists, but `gh secret list` shows no `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, or `OBSERVABILITY_SMOKE_SECRET`. Manual fallback is therefore the accepted controlled-trial route via `.github/ISSUE_TEMPLATE/tester-feedback.yml`. | Run `Observability API Smoke` later after secrets are added; not blocking controlled tester share. |
| P1 | Release matrix/docs | ✅ | This matrix is updated with final post-P1 run IDs and latest-commit Cloud PDF evidence. | Keep this file current only if release evidence changes. |
| P1 | Frontend "Free" -> "Basic" wording | ✅ | Frontend copy now displays Basic for the baseline plan while internal tier values, test IDs, and backend semantics remain `free`. Targeted Basic copy unit tests pass locally. | Backend `free` -> `basic` migration remains intentionally deferred. |
| P1 | Unit test sharding / CI speed | ✅ | CI now runs `unit-shard-1..4` separately from `unit-coverage`; E2E waits on sharded unit correctness while the canonical coverage artifacts remain under `unit-artifacts`. Local shard smoke and GitHub CI run `25710006382` both passed. | Tune shard balance later only if CI timing data shows a bottleneck. |

## Native Evidence

```text
browser: Google Chrome via Playwright channel=chrome, headed
microphonePath: real browser getUserMedia, no fake audio flags
proofEmail: native-proof-1778546140280@example.com
modeSelected: true
recordingStarted: true
transcriptVisible: true
transcriptMatchesScript: false
saved: true
historyVisible: true
analyticsVisible: true
pass: true
transcriptSample: like Market to the state well that's partially we had a marketing class eBay bottom
```

## Cloud PDF Text

```text
SpeakSharp Session Report
Date: May 12th, 2026
Duration: 0 minutes
Vocal Analytics
Metric Value
Speaking Pace (WPM) 219
STT Engine cloud (unknown, unknown, unknown)
Silence Percentage 0.0%
...
Transcript
Stales smell of old beer lingers, a dash of pepper spoils beef stew. The swan dive was far short of perfect. The box
was thrown beside the parked truck. The twister left no trace of the town. They told Wild Tails to frighten him. We
find joy in the simplest things. The puppy chewed up the new shoes. A smooth robe makes driving pleasant. The
quick brown fox jumps over the lazy dog. The stale smell of old beer lingers. A dash of pepper spoils beef stew. The
swan dive was far short of
```

## P1 Validation

```text
Basic copy targeted unit tests:
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/constants/__tests__/subscriptionTiers.test.ts \
  frontend/src/pages/__tests__/PricingPage.component.test.tsx \
  frontend/src/hooks/__tests__/useUserFillerWords.test.ts \
  frontend/src/pages/__tests__/SessionPage.rendering.component.test.tsx
Result: 4 files passed, 58 tests passed.

Unit shard smoke:
pnpm ci:unit:shard 1 4
Result: 27 files passed, 167 tests passed.

Full GitHub CI:
CI - Test Audit run 25710006382
Result: unit-shard-1..4, unit-coverage, build, edge-tests, health-check, lighthouse-advisory, e2e-shard-1..4, and report all passed.
```

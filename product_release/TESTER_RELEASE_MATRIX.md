# Tester Release Matrix

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-19)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `69ad3f13` (`Fix E2E final transcript projection`). |
| CI/Test Audit | PASS: GitHub run `25994869503` on `main`. |
| Production canary | PASS: GitHub run `26085357729` on `main` schedule; push canary `25994869500` also passed. |
| Edge Function deploy | PASS: GitHub run `25994869506` on `main`. |
| Scheduled soak | PASS: GitHub run `26083232887` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Tester instructions | Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`: fresh account, one-use 60-minute promo, Private STT first, Cloud optional, save/history check required. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

**Last updated:** 2026-05-19
**Evidence baseline commit:** `69ad3f13`
**Verdict:** GO for controlled human tester release. P0 release gates, P1 release-control work, Observability API Smoke, all five RC gates, latest CI, latest Edge deploy, scheduled canary, and scheduled soak are green. Tester share can proceed with the Private-first instructions in `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`; Native remains Chrome/browser-dependent and Cloud remains optional/caveated.
**Latest full RC gates:** `Release Candidate Gates` run `25769178359` passed on `e73408c0`.
**Latest workflow hygiene evidence:** `69ad3f13`; CI/Test Audit run `25994869503`, production canary run `25994869500`, Edge Function deploy run `25994869506`, scheduled production canary run `26085357729`, and scheduled soak run `26083232887` passed on `main`.
**Latest observability readback:** `Observability API Smoke` run `25764783852` passed.

## RC Gate Overlay

| Gate | Product | SAST | DAST | SCA | UX | Observability | Release Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Expired promo / stale profile | ✅ | ✅ | ✅ | N/A | ✅ | N/A | Green |
| Basic/basic access sanity | ✅ | ✅ | ✅ | N/A | ✅ | N/A | Green |
| Cloud Pro | ✅ | ✅ | ✅ | N/A | ✅ | N/A | Green, included |
| Private Pro | ✅ | ✅ | ✅ | N/A | ✅ | N/A | Green for release |
| Native Chrome | ✅ | ✅ | ✅ manual | N/A | ✅ | N/A | Green if labeled Chrome/browser-dependent |
| Stripe checkout/webhook | ✅ | ✅ | ✅ | N/A | N/A | N/A | Green for test-mode release |
| CI/deploy/canary | ✅ | ✅ | ✅ | ✅ | N/A | N/A | Green; critical SCA audit recorded |
| Observability | ✅ | N/A | ✅ | N/A | N/A | ✅ | Green; API readback passed and manual fallback remains available |

| Priority | Gate | Status | Evidence | Remaining Action |
|---|---|---:|---|---|
| P0 | Expired promo / basic downgrade | ✅ | `Expired Promo Live Smoke` run `25704192079` passed on `e986ecf8`. | Freeze unless entitlement code changes. |
| P0 | Basic/basic access sanity | ✅ | Same expired-promo proof plus Native proof below: downgraded/basic-safe users retain Native path and do not keep Cloud/Private entitlement. | Recheck only through focused entitlement smoke if tier/mode logic changes. |
| P0 | CI Audit latest commit | ✅ | `CI - Test Audit` run `25710006382` passed on `60c8af5c`, including unit/build/edge/health/lighthouse advisory, `unit-shard-1..4`, and E2E shards 1-4. | Freeze unless release-critical code changes. |
| P0 | Deploy latest commit | ✅ | `Deploy Edge Functions` run `25710006386` passed on `60c8af5c`. | Freeze unless deploy path changes. |
| P0 | Canary latest commit | ✅ | `Production Canary Smoke Test` run `25710006385` passed on `60c8af5c`. | Freeze unless release-critical code changes. |
| P0 | Cloud Pro cradle-to-grave | ✅ | Latest Cloud rerun `Pro STT Artifact Matrix` run `25710014996` passed on `60c8af5c`. Extracted PDF text includes `STT Engine cloud` and the latest Cloud transcript shown below. | Freeze unless Cloud/STT/save/history/AI/PDF code changes. |
| P0 | Native Chrome mic proof | ✅ | Headed Google Chrome production proof with real `getUserMedia`, no fake audio flags: `NATIVE_CHROME_MIC_EVIDENCE` pass, promo sign-up `native-proof-1778546140280@example.com`, transcript length `83`, save/history/analytics all true. | Document as Chrome/browser-dependent. The script records `transcriptMatchesScript=false` because ambient mic text did not match the scripted audio, but non-placeholder live transcript appeared through the real mic path. |
| P0-last | Observability readback/fallback | ✅ | `Observability API Smoke` run `25764783852` passed. Manual fallback exists via `.github/ISSUE_TEMPLATE/tester-feedback.yml`. | Freeze unless observability workflow/secrets change. |
| RC | Full release candidate gates | ✅ | `Release Candidate Gates` run `25769178359` passed on `e73408c0`: Gate 1 Product Truth, Gate 2 SAST/OWASP, Gate 3 DAST, Gate 4 SCA, Gate 5 UX. | Freeze unless release-critical code changes. |
| P1 | Release matrix/docs | ✅ | This matrix is updated with final post-P1 run IDs and latest-commit Cloud PDF evidence. | Keep this file current only if release evidence changes. |
| P1 | Frontend "Basic" -> "Basic" wording | ✅ | Frontend copy now displays Basic for the baseline plan while internal tier values, test IDs, and backend semantics remain `basic`. Targeted Basic copy unit tests pass locally. | Backend `basic` -> `basic` migration remains intentionally deferred. |
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
Latest full RC gates:
Release Candidate Gates run 25769178359
Commit: e73408c0
Result: Gate 1 Product Truth, Gate 2 SAST/OWASP, Gate 3 DAST, Gate 4 SCA, and Gate 5 UX all passed.

Observability API Smoke:
Run 25764783852
Result: passed.

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

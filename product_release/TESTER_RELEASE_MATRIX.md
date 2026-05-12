# Tester Release Matrix

**Last updated:** 2026-05-12
**Commit:** `e986ecf80f74ff09b0caf7d054d593606128237c`
**Verdict:** Conditional green for controlled tester share after owner accepts observability manual fallback or adds dashboard readback secrets.

| Priority | Gate | Status | Evidence | Remaining Action |
|---|---|---:|---|---|
| P0 | Expired promo / free downgrade | ✅ | `Expired Promo Live Smoke` run `25704192079` passed on `e986ecf8`. | Freeze unless entitlement code changes. |
| P0 | Free/basic access sanity | ✅ | Same expired-promo proof plus Native proof below: downgraded/free-safe users retain Native path and do not keep Cloud/Private entitlement. | Frontend-only "Free" -> "Basic" copy waits until P0s stay green. |
| P0 | CI Audit latest commit | ✅ | `CI - Test Audit` run `25704186636` passed on `e986ecf8`, including unit/build/edge/health/lighthouse advisory and E2E shards 1-4. | Freeze correctness; CI speed work waits. |
| P0 | Deploy latest commit | ✅ | `Deploy Edge Functions` run `25704186639` passed on `e986ecf8`. | Freeze unless release-critical code changes. |
| P0 | Canary latest commit | ✅ | `Production Canary Smoke Test` run `25704186668` passed on `e986ecf8`. | Freeze unless release-critical code changes. |
| P0 | Cloud Pro cradle-to-grave | ✅ | Final Cloud rerun `Pro STT Artifact Matrix` run `25705463530` passed on `e986ecf8`. Extracted PDF text includes `STT Engine cloud` and transcript: `The stale smell of old beer lingers, a dash of pepper spoils beef stew. The swan dive was far short of perfect. The`. | Freeze Cloud internals unless a fresh focused run regresses. |
| P0 | Native Chrome mic proof | ✅ | Headed Google Chrome production proof with real `getUserMedia`, no fake audio flags: `NATIVE_CHROME_MIC_EVIDENCE` pass, promo sign-up `native-proof-1778546140280@example.com`, transcript length `83`, save/history/analytics all true. | Document as Chrome/browser-dependent. The script records `transcriptMatchesScript=false` because ambient mic text did not match the scripted audio, but non-placeholder live transcript appeared through the real mic path. |
| P0-last | Observability readback/fallback | 🟡 | API readback helper and workflow are present locally; `deno check` passes for `observability-smoke`. GitHub repo secrets currently lack Sentry/PostHog readback credentials, so dashboard/API confirmation cannot run yet. Manual fallback issue template added at `.github/ISSUE_TEMPLATE/tester-feedback.yml`. | Add readback secrets and run `Observability API Smoke`, or explicitly accept manual tester-feedback fallback for the controlled trial. |
| P1 | Release matrix/docs | 🟡 | This matrix records latest P0 evidence. | Reconcile older release docs after observability decision. |
| P1 | Frontend "Free" -> "Basic" wording | ⏸️ | Correctly not started while P0s were red. | Start after P0 stays green; frontend copy only, no backend tier rename. |
| P1 | Unit test sharding / CI speed | ⏸️ | Correctly not started; latest unit job already passed, and prior red was E2E shard-4. | Start after release gates settle; preserve aggregate required CI result. |

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
Speaking Pace (WPM) 231
STT Engine cloud (unknown, unknown, unknown)
Silence Percentage 0.0%
...
Transcript
The stale smell of old beer lingers, a dash of pepper spoils beef stew. The swan dive was far short of perfect. The
```

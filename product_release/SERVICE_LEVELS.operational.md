**Owner:** [unassigned]
**Last Reviewed:** 2026-05-28
**Version:** v0.7.0-rc lineage
**Last Updated:** 2026-05-28

# SpeakSharp Service Levels

> Internal target and evidence document, not an external customer contract.
> Do not publish SLA language until we intentionally accept external obligations.

This document groups SpeakSharp service-level definitions, soft-release targets, current evidence, and gaps. It keeps operational expectations near the evidence instead of scattering them through the PRD.

---

## 1. Definitions

| Term | Meaning For SpeakSharp |
|---|---|
| SLO | Service Level Objective. Internal target, such as “95% of auth requests complete under 2 seconds.” |
| SLA | Service Level Agreement. External promise, often contractual, such as “99.9% uptime or credits.” SpeakSharp should avoid external SLA language for controlled soft release. |
| SLC | Service Level Commitment or softer public/internal commitment. Less universal than SLO/SLA; for SpeakSharp, treat it as a controlled promise that can be shown publicly only when supported by evidence. |
| Stress test | Increases concurrency/load to find bottlenecks, failure limits, p95 latency, and locking/contention issues. |
| Soak/endurance test | Runs a realistic scenario for a sustained period to catch memory leaks, stale sessions, resource exhaustion, and long-tail bugs. |

---

## 2. Soft-Release Targets

| Claim | Target | Classification | Current Evidence | Gap / Next Evidence |
|---|---:|---|---|---|
| Primary recording path availability | 99.5% internal target | SLO, aspirational | Canary, RC gates, live STT paths | Not uptime monitoring; use controlled-test evidence only. |
| Auth p95 latency | < 2s release floor; < 1s industry target at tested concurrency | SLO | Backend stress script now measures p50/p95 auth latency | Needs fresh GitHub artifact from `service-level-evidence.yml` or `stress-endurance.yml`. |
| Usage-limit Edge Function p95 | < 2s release floor; < 1s industry target at tested concurrency | SLO | `check-usage-limit` correctness tests and backend stress path | Needs fresh GitHub stress artifact. |
| Session-save RPC p95 | < 2s release floor; < 1s industry target at tested concurrency | SLO | Current RPC used by backend stress path | Needs fresh GitHub stress artifact with p50/p95 and counts. |
| Stress failure rate | 0% release floor and industry target for tested concurrency | SLO | Stress script checks auth, usage Edge, and session RPC success counts | State exact concurrency tested; do not generalize beyond it. |
| Browser endurance | <= 50 MB max JS heap growth when memory API is available, plus no functional endurance failure | SLO | Browser endurance path uses Native mode and emits memory growth evidence when the browser exposes it | Needs fresh GitHub artifact with duration/memory growth or an explicit memory-unavailable note. |
| PDF export durability | 99.9% aspirational from valid state | SLC candidate | PDF unit/e2e/live artifact evidence in release ledgers | Too aggressive for external claim until repeated export evidence exists. |
| Session restoration | 95% aspirational | SLC candidate | PRD intent exists | Current evidence is weak; needs targeted restoration proof before public claim. |
| Private STT WER | < 10% on controlled fixtures | Quality target, not generic SLA | STT benchmark/proof artifacts when run | Browser/user environment variability means do not promise globally. |
| Cloud STT WER | < 8% on controlled fixtures | Quality target, not generic SLA | Cloud live proof requirements | Provider/model/version must be recorded with evidence. |

---

## 3. Industry Reality Check

| Area | Industry Pattern | SpeakSharp Soft-Release Stance |
|---|---|---|
| Availability | 99.9% is common for mature paid SaaS; 99.5% is more realistic for early controlled release. | Use 99.5% as an internal target only. Do not promise credits or contractual uptime. |
| Auth/API latency | p95 < 1-2s is reasonable for user-facing SaaS flows. | Track p50/p95 through backend stress evidence. |
| Export durability | Mature systems can target 99.9%+ when repeated evidence and monitoring exist. | Keep 99.9% aspirational until repeated PDF evidence exists. |
| Browser endurance | Long-running browser apps need leak/endurance evidence, but durations vary by risk. | Run shorter CI endurance regularly; run longer endurance before broad launch or after recording-path changes. |
| STT accuracy | Accuracy varies by audio hardware, accents, environment, model, and browser. | Tie WER targets to controlled fixtures only. |

---

## 4. Evidence Mapping

| Question | Evidence Source |
|---|---|
| Can real Supabase auth/users survive concurrent test traffic? | `stress-endurance.yml` backend stress artifact, auth phase. |
| Can `check-usage-limit` respond under load? | `stress-endurance.yml` backend stress artifact, usage-edge phase. |
| Can `create_session_and_update_usage` handle concurrent writes and locking? | `stress-endurance.yml` backend stress artifact, session-rpc phase. |
| Can the browser app run an extended Native recording flow without UI/state/memory problems? | `stress-endurance.yml` browser endurance artifact. |
| Are core workflows correct in normal CI? | `CI - Test Audit`: Vitest, Edge tests, build, Playwright shards, Lighthouse advisory, report. |
| Are deployed boundaries healthy? | Production smoke/canary, live release matrix, ops-health status. |

---

## 5. Release-Gate Fit

Do not add redundant SLA-specific tests by default. Prefer making existing tests produce better structured evidence.

| Evidence | Normal RC Role |
|---|---|
| CI correctness | Required baseline. |
| Production smoke | Required after `main` deploy. |
| Ops health | Required operational snapshot before release decision. |
| Backend stress | Advisory unless backend durability, auth, quota, or session-save concurrency is a release concern. |
| Browser endurance | Advisory unless browser stability, memory, or long-recording behavior is a release concern. |
| Benchmarks/WER | Advisory unless STT model/provider/performance changed or an STT claim is being made. |

---

## 6. Evidence Artifact Expectations

Stress/endurance artifacts should include:

- concurrency tested
- success/failure counts per phase
- p50/p95 latency per phase
- throughput
- browser memory growth where available
- run ID, timestamp, commit SHA, and actor

If those fields are missing, the run can still be useful for debugging but should not be used to make service-level claims.

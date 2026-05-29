**Owner:** [unassigned]
**Last Reviewed:** 2026-05-28
**Version:** v0.7.0-rc lineage
**Last Updated:** 2026-05-28

# SpeakSharp Software Quality Evidence

> Stable interpretation document, not a dynamic metrics dump.
> Latest generated evidence is produced by CI under `product_release/evidence/` and uploaded as GitHub workflow artifacts.

The PRD states what matters to the product. This document explains how we measure current software quality against those expectations without rewriting the PRD on every run.

---

## 1. Evidence Chain

```text
tests produce facts
scripts summarize facts
workflows run them authoritatively
artifacts preserve evidence
docs interpret the evidence
```

GitHub Actions is authoritative for release evidence because it provides controlled runners, repository secrets, stable run IDs, and uploaded artifacts. Local runs are useful for debugging and fast feedback, but local-only output does not close release evidence unless a release document explicitly says so.

---

## 2. Quality Evidence Sources

| Evidence Type | Source | Current Use |
|---|---|---|
| Unit correctness | Vitest unit/component tests inside CI | Required baseline correctness. |
| Browser flow correctness | Playwright E2E tests inside CI | Required baseline UX/runtime correctness. |
| Live deployed behavior | Live Playwright workflows | Release-time evidence for deployed boundaries. |
| Production smoke | Production smoke workflow, currently `canary.yml` | Required quick proof after `main` deploys. |
| Backend stress | `stress-endurance.yml` / `test:stress:backend` | Advisory unless backend durability is release risk. |
| Browser endurance | `stress-endurance.yml` / `test:endurance:browser` | Advisory unless browser stability is release risk. |
| API stack health | Ops-health workflow and hosted ops status view | Operational go/no-go snapshot. |
| Security/dependency posture | Edge tests, SAST, SCA, audit gates | Release gate evidence where explicitly named. |
| Software quality | Coverage, Lighthouse, bundle metrics, flaky count | Advisory quality and risk trend evidence. |

---

## 3. Generated Evidence Files

CI writes these generated files when quality evidence generation is enabled:

| File | Purpose |
|---|---|
| `product_release/evidence/software-quality.latest.json` | Machine-readable quality evidence: test counts, coverage, Lighthouse, bundle/runtime metrics, GitHub run metadata. |
| `product_release/evidence/software-quality-summary.latest.md` | Human-readable summary of the same evidence. |

These files are generated artifacts, not source-of-truth product requirements. They are ignored locally to prevent noisy commits. GitHub uploads them with the CI metrics artifacts so each run has stable evidence tied to a commit and run ID.

---

## 4. Current Quality Targets

| Area | Release Floor | Industry Target | Interpretation |
|---|---:|---:|---|
| Unit tests | 0 unexpected failures | 100% pass for non-skipped tests | Required. Any failure in `CI - Test Audit` returns the gate to red. |
| Browser E2E | 0 unexpected failures | 100% pass for non-skipped tests | Required. Flakes are named concerns, not silent green. |
| Skipped / disabled release-path tests | 0 | 0 | Any skipped startup, auth, session, save, analytics, STT, billing, quota, or PDF test needs explicit review. |
| Statements coverage | 60% enforced CI floor | 80% | The floor prevents backsliding while we raise coverage toward industry standard. |
| Branch coverage | 60% enforced CI floor | 80% | Prioritize STT, session lifecycle, quota/billing, PDF, analytics truth, and failure handling before vanity coverage. |
| Function coverage | 60% enforced CI floor | 80% | Same interpretation as coverage above. |
| Line coverage | 60% enforced CI floor | 80% | Same interpretation as coverage above. |
| Lighthouse performance | 90 | 90+ | Advisory unless UX or load-time regressions affect tester launch. |
| Lighthouse accessibility | 90 | 90+ | Required when a flow is being claimed accessible; otherwise advisory quality evidence. |
| Lighthouse best practices | 90 | 90+ | Advisory unless it indicates a security/runtime issue. |
| Lighthouse SEO | 90 | 90+ | Advisory for controlled soft release. |
| Code bloat index | < 20% | < 20% | Advisory unless load time becomes a tester issue. |
| Initial chunk size | Track trend | Keep stable or explain increase | No universal byte target; any material jump needs reviewer explanation. |
| Total source/project size | Track trend | Keep stable or explain increase | No universal byte target; use it to catch generated artifacts and stale output bloat. |

---

## 5. Interpretation Rules

- Raw artifacts win when summaries disagree: coverage JSON, Playwright reports, Vitest output, Lighthouse JSON, workflow logs, and browser traces are the source of truth.
- Quality score cannot override red release gates.
- A high coverage number does not prove STT quality, billing safety, quota enforcement, or privacy behavior.
- Advisory metrics can become blocking only when `RC_GATES.md` or `RELEASE_STATUS.md` explicitly promotes them for a release.
- Local generated quality output should help debugging; GitHub-generated artifacts should close release evidence.

---

## 6. Related Documents

- `PRD.operational.md`: product contract and user-visible guarantees.
- `SERVICE_LEVELS.operational.md`: service-level definitions, targets, evidence, and industry comparison.
- `RC_GATES.md`: release gate authority and evidence freshness.
- `RC_TEST_INVENTORY.md`: test/workflow mapping.
- `RELEASE_STATUS.md`: current go/no-go posture.

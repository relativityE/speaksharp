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

| Area | Soft-Release Target | Interpretation |
|---|---|---|
| Unit tests | No unexpected failures in `CI - Test Audit` | Required. |
| Browser E2E | No unexpected failures or hidden flaky startup diagnostics | Required. Flakes are named concerns, not silent green. |
| Coverage | Improve critical-path coverage before global percentage vanity | Advisory. Prioritize STT, session lifecycle, quota/billing, PDF, analytics truth. |
| Lighthouse | Keep current strong scores unless feature changes explain drift | Advisory. Good hygiene, not product correctness. |
| Bundle/code bloat | Track initial chunk and bloat index trend | Advisory unless load time becomes a tester issue. |
| Flaky tests | Zero known unresolved release-path flakes | Required when the flaky test covers startup, auth, session, save, analytics, or PDF. |

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

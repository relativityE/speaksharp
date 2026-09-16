**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-16 — reconciled to `main@28b66bc4`, which is `main` after PR #1469, PR #1483, PR #1481 and PR #1489 (issue #1474) merged; the open PRs, the open issues, and incomplete RWT evidence were re-read at the same time.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, the archived `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

> **Baseline `28b66bc422ad90b2f785ae4f03f7858196fbcbe3`** (`main`, 2026-09-16, after #1489 / issue #1474). The deployed release is recorded separately in `RELEASE_STATUS.md` and is a **read** of Production, never inferred from this pointer — the two values differ because Production has not been re-read since #1469, and #1483, #1481 and #1489 have merged since. #1481 and #1489 both moved bundle files, so the live product is expected to differ visibly from the recorded read until it is re-read.

This file is the live backlog authority. The former `BACKLOG.md` is archived and must not be restored as a fifteenth canonical document. Completion belongs in issue/PR/git history; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
baseline: 28b66bc422ad90b2f785ae4f03f7858196fbcbe3
deployed-release: 734d045adafcdb8cc00cf95b5b3bbc5bfa7e4dc3
verified-on: 2026-09-16
release-blocker: production-journey-recovery
retention-campaign: off-critical-path
task-1304-1: merged
task-1304-2: merged
task-1304-3a: merged
task-1304-3b: merged
task-1304-3c: merged
task-1304-4: merged
task-1360-recovery-copy: merged
lane-stage-b: off-critical-path
lane-telemetry: open
lane-retention-copy: open
lane-billing: off-critical-path
lane-1258-journey: returned
lane-1469: merged
lane-1483: merged
lane-1481: merged
lane-1474: merged
lane-1475: open
lane-canary-rotation: open
lane-practice-loop: open
lane-moonshine: returned
-->

The currency guard checks internal consistency and recent ancestry; it cannot read a moving GitHub branch or Production deployment.

## Now — closure-first path back to RWT

Keep **one merge token**, and run **two working lanes**: Dev implementation and PM review/selected implementation. Review or CI waiting does not halt unrelated executable work; only the merge token is serialized. PR #1477 contains a bounded review-qualification implementation and is **frozen behind the active product PR**, which is now PR #1487. Predecessors merging does not release it: the freeze follows the merge token, not a fixed list of PRs. It restacks/currentizes once each time `main` advances, which is what that rule requires.

| Order | Outcome | Owner | Smallest closure evidence |
|---|---|---|---|
| 1 | Close Focus Points attribution authority | PR #1469 | Exact-head automatic reviews + full CI, PM acceptance, exact PO head/base authorization; Production migration application remains separate. |
| 2 | Close Focus verdict palette/explanation | PR #1467 | Restack after #1469, preserve bounded UI scope, exact-head browser/CI/review packet. |
| 3 | Make progress saves truthful and cross-tab safe | #1471 → #1476 | Empty `{}` never means verified zero; two-tab queue casualties prove no loss, overwrite, duplication, or indefinite Start hold. |
| 4 | Restore the automatic Practice Loop review | #1473 | One automatic request, one valid 1+1 review or cause-matched terminal, truthful retry, received telemetry, and separate authorized Production grant/Edge checks. |
| 5 | Stop false filler/clarity claims | #1472 | Persisted `complete | unobservable | no_speech` state shared by Session, Analytics, PDF, Progress, recovery, and telemetry. |
| 6 | Make Moonshine RWT-ready — **deferred until after RWT or MVP** | #1263 | Not a current RWT prerequisite. Keep the acquisition/switch fixes; when it is picked up, investigate and eliminate the real long-form loop at the model-driving boundary without output sanitization, and prove tail and live-stability contracts. |
| 7 | Produce comparable rows that validate the standing choice | #1304 + #1390 | Same corpus, identity, word-count, filler completeness, WER, latency, stability, and **v2/v4** journey evidence. It confirms the standing choice of v4 as provisional primary and v2 as fallback; it is not a three-model down-selection, and Moonshine rows are not required. |
| 8 | Complete the approved core UI | #1474 | G10 during/after Practice Loop hierarchy/theme, with loading/success/failure in the same dominant footprint. |
| 9 | Complete the approved landing page | #1475 | G12 landing layout/theme and full 30-day/$10 offer, without shipping claims ahead of #1471/#1473. |
| 10 | Close observability and final journey gates | #1259 + #1382/#1383/#1384 → #1258 | Received events, clean baseline, SLO/alert/cleanup proof, Dev runs both products, then PO repeats on the exact deployed release. |

The `onnxruntime-web` int8/q8 failure was the upstream QDQ regression #28306/#28326, not a model verdict. The 459-word preflight exposed corpus/runtime defects before the 600-utterance selection run. Those lessons remain binding, but historical rows do not qualify the current **v2/v4** comparison.

## Active MVP and pre-GO issue register

All 24 current MVP/pre-GO issues and roadmap-owned gaps have an owner and closure boundary:

| Area | Issues | Disposition |
|---|---|---|
| Final product/copy/journey | #1254, #1258, #1360, #1407 | Active; close owning fixes before the final exact-release journey and copy scan. |
| Observability/operations | #1259, #1382, #1383, #1384 | Active; received evidence and cleanup are required, not producer calls. |
| Security/CI truth | #1261, #1313, #1315, #1385 | Active pre-GO controls; keep separate from product-feature PRs. |
| STT comparison | #1304, #1390 | Active; validates **v4 (provisional primary) against v2 (fallback)**. #1263 Moonshine is deferred until after RWT or MVP and is not required here. |
| Documentation/review gate | #1318 / PR #1477 | **Frozen behind the active product PR.** #1469, #1483 and #1481 having merged does NOT discharge the freeze: the rule serialises this lane behind whichever product PR currently holds the merge token, and that is now PR #1487. This PR waits for #1487 to close, then restacks once. Canonical-authority currentization plus the bounded documentation-review qualification. Archives and dated evidence remain immutable. |
| Retention safety | #1452 | Must close before newest-one retention is activated; it does not authorize activation. |
| Account deletion | Roadmap-owned pre-GO gap | Product Owner owns disposition; Dev may author a bounded corrective issue/PR. Choose one deletion authority, make account erasure unblockable, cover unfinished `session_delivery_measurements` rows and the non-cascading `user_id` dependency, define cleanup/SLA ownership, and prove the real migrations in tests. Production migration remains separately authorized. |
| Progress/review/filler | #1471, #1472, #1473, #1476 | Active release blockers with separate owners. |
| Approved UI | #1474, #1475 | Active approved design work; no scope leakage into unrelated PRs. |

## Later — explicitly post-MVP

Accepted work, deferred. Nothing in this section is declined, and nothing is dropped for being post-MVP: each item names the durable owner that holds its detail, so deferral never becomes deletion.

### Retained engineering debt

| Issues | Reason |
|---|---|
| #1275, #1312, #1322, #1340, #1398, #1462 | Dependency/runtime runway, CI optimization, retired remnants, generated-type maintenance, proof-selector hardening, and future v4 research are retained debt, not current RWT blockers unless they reproduce a user-facing P0/P1. |

### Accepted product and business workstreams

| Workstream | Durable owner | Standing |
|---|---|---|
| **Enterprise and team capabilities** — organization accounts and administration; SSO/SAML and SCIM; role-based access and organization isolation; audit logs; organization-configurable retention/deletion; procurement/security documentation; support/SLA and incident-response commitments; cohort reports and content-free exports; organization policy controls | **#1307**, the consolidated parking lot (preserves the selected ideas from closed #1048 and #1075). The durable architectural constraints live in `ARCHITECTURE.md` §14. | Accepted and parked. Build nothing until #1307's activation gate is met: released and stable MVP, a concrete request, an explicit Product Owner choice, a new scoped issue, and resolved privacy/security/retention/trademark implications. |
| **On-prem / self-hosted deployment** | This file is the classification authority; `ARCHITECTURE.md` §14 states the boundary it sits against. | Accepted as **Later**, explicitly **not declined**. Separate per-customer databases/deployments and per-tenant models are Declined below; on-prem/self-hosted is not. |
| **Demand validation and market discovery** | **#1307** — the three current strengths recorded there are positioning hypotheses to validate, not feature requirements. | Accepted, sequenced strictly after the product is release-qualified. Competitive analysis must not change current requirements, acceptance criteria, gates, sequencing, or scope. |
| **Financial and pricing validation** | `work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-09-05.md` and the workbook it records, held as a point-in-time artifact. | Accepted as an **unvalidated planning forecast**. It is not evidence, not a product promise, and authorizes no pricing or entitlement change. |

### Declined

Recorded here because this file is the authority for Declined work. Reversing any of these is a new Product Owner decision, not an incremental change.

Each row is phrased as a negation because the product-contract guard scans Markdown line by line: a row that merely names a declined capability reads to the guard as asserting it.

| Declined | Stated in |
|---|---|
| No separate per-customer databases or deployments, and no per-tenant models | `ARCHITECTURE.md` §14 |
| No avatars, and no body-language, facial, gesture, posture or video analysis | `PRODUCT_REQUIREMENTS.md` §10 |
| No continuous or verbose coaching while the user speaks | `PRODUCT_REQUIREMENTS.md` §10 |
| No customer-visible Browser, Cloud, Native, provider, model-variant or engine-choice entitlement | `PRODUCT_REQUIREMENTS.md` §10 |
| No daily or monthly accumulated recording-minute gate for active-trial or paid users | `PRODUCT_REQUIREMENTS.md` §10 |
| No fabricated or unattributed testimonials | `PRODUCT_REQUIREMENTS.md` §10 |

## Closed or consolidated — do not reopen as duplicate lanes

The 15 Sep backlog sweep closed 20 stale/duplicate items:

- verified complete: #1316, #1404, #1451, #1453, #1457, #1458;
- consolidated: #1450/#1455 → #1476; #1417/#1454/#1456 → #1472; #1459 → #1254; #1470 → #1475;
- superseded/not selected: #1268, #1295, #1307, #1386, #1389, #1415, #1460.

A closed issue may remain as provenance. New evidence goes to the current owner above rather than reopening a duplicate.

## Fixed decisions

- One customer product: Private Practice, with Open Mic and Focus Points.
- Complete product free for 30 days, then $10/month; no accumulated-minute commercial quota.
- Canonical Production URL only for PO model qualification.
- One STT engine per take; requested and observed identities must match.
- Moonshine is **deferred until after RWT or MVP** by Product Owner decision and is not part of current RWT qualification. The raw long-form failure evidence stands and is preserved; deferring the candidate does not retract the observation.
- No output deduplication/sanitization may hide a repetition loop.
- Exactly one **What went well** and one **What to improve** suggestion per eligible saved session.
- Newest-one transcript retention is the approved target; #1452 must close before activation.
- No Production migration, configuration, credential, account, payment, deployment, RWT, or merge without exact-action authority.

## Stop conditions

- Do not resume Production RWT until the exact deployed candidate is PM-qualified and the Product Owner authorizes the named stop.
- Do not treat the partial Stop B or the descriptive v2/v4 observations as the comparable evidence that confirms v4 over v2.
- Do not treat CI, a transport 200, a generated artifact, or an installed observer as proof of received/user-visible behavior.
- Do not let the queued #1477 gate/docs lane or post-MVP debt displace the current product merge token.

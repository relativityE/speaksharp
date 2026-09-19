**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-18
**Last Verified:** 2026-09-19 — reconciled to `main@5b89dc86`, which is `main` after PR #1502 (Share feedback retheme, G8), PR #1494 (Home, Design Correction Brief H-1…H-5) and PR #1498 (Session, S-8…S-14), on top of PR #1490 (#1259 received-receipt gaps), PR #1467 (Focus Points detection limit), PR #1486 (#1473 automatic Practice Loop suggestions), PR #1493 (Design Correction Brief shared slot map, S-1–S-7 / F-1–F-6), PR #1487 (#1475 G12 signed-out homepage) and PR #1492 (#1294 checkout email sourcing) merged; the open PRs, the open issues, the Production migration ledger and incomplete RWT evidence were re-read at the same time.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, the archived `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

> **Baseline `5b89dc8636ce69740eda66ade7987c280c74180a`** (`main`, 2026-09-19, after #1502). The deployed release is recorded separately in `RELEASE_STATUS.md` and is a **read** of Production, never inferred from this pointer. The two values currently agree because Production was read at 2026-09-19T11:01:27Z after the #1502 deploy propagated — agreement is the observed result of that read, not a conclusion drawn from the merge. They diverge again the moment `main` advances, until a new read is taken.

This file is the live backlog authority. The former `BACKLOG.md` is archived and must not be restored as a fifteenth canonical document. Completion belongs in issue/PR/git history; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
baseline: 5b89dc8636ce69740eda66ade7987c280c74180a
deployed-release: 5b89dc8636ce69740eda66ade7987c280c74180a
verified-on: 2026-09-19
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
lane-1475: merged
lane-1467: merged
lane-1493: merged
lane-design-brief: open
lane-test-identity-roles: open
lane-canary-rotation: open
lane-practice-loop: merged
lane-moonshine: returned
-->

The currency guard checks internal consistency and recent ancestry; it cannot read a moving GitHub branch or Production deployment.

## Now — closure-first path back to RWT

Keep **one merge token** and, as the standing rule, **one active implementation lane**. Review or CI waiting does not halt unrelated executable work; only the merge token is serialized.

**The temporary two-lane exception for the RWT closure queue has run its course.** Its Dev lane (#1477 → #1486 → #1467) and PM's #1490 merged; PM's #1488 is still open under the same rule. When #1488 closes, the exception expires and the default of one active implementation lane resumes. Design Correction Brief lanes (PR #1498 Session, PR #1494 Home) are each one PR and merge serially on the one token.

| Order | Outcome | Owner | Smallest closure evidence |
|---|---|---|---|
| 1 | Close Focus Points attribution authority — **merged**; Production migration `20260914214307` still pending | PR #1469 | Production migration application remains separate and needs exact PO authorization. |
| 2 | Close Focus verdict palette/explanation — **merged** 2026-09-17 | PR #1467 | Done; verify in the final exact-release journey. |
| 3 | Make progress saves truthful and cross-tab safe | #1471 → #1476 | Empty `{}` never means verified zero; two-tab queue casualties prove no loss, overwrite, duplication, or indefinite Start hold. |
| 4 | Restore the automatic Practice Loop review — **PR #1486 merged** | #1473 | One automatic request, one valid 1+1 review or cause-matched terminal, truthful retry, received telemetry; the issue closes on a verified Production journey. |
| 5 | Stop false filler/clarity claims | #1472 | Persisted `complete | unobservable | no_speech` state shared by Session, Analytics, PDF, Progress, recovery, and telemetry. |
| 6 | Make Moonshine RWT-ready — **deferred until after RWT or MVP** | #1263 | Not a current RWT prerequisite. Keep the acquisition/switch fixes; when it is picked up, investigate and eliminate the real long-form loop at the model-driving boundary without output sanitization, and prove tail and live-stability contracts. |
| 7 | Produce comparable rows that validate the standing choice | #1304 + #1390 | Same corpus, identity, word-count, filler completeness, WER, latency, stability, and **v2/v4** journey evidence. It confirms the standing choice of v4 as the approved primary and v2 as the fallback — a target, not a deployed state — and supplies the pre-promotion evidence #1263 needs; it is not a three-model down-selection, and Moonshine rows are not required. |
| 8 | Complete the approved core UI | #1474 → Design Correction Brief | G10 hierarchy merged (#1489); the brief continued it: PR #1493 (slot map), PR #1494 (Home H-1…H-5) and PR #1498 (Session S-8…S-14) are merged and deployed. G8 Share feedback retheme merged (#1502). Open: G7 set-up retheme (#1503), the #1498 P2 follow-up (#1505), S-12 (verdict + evidence contract), S-15/S-16, the "Count look wrong?" opener, and the shared dialog surface. |
| 9 | Complete the approved landing page — **PR #1487 merged** | #1475 | G12 layout/theme and the full 30-day/$10 offer shipped; the issue closes on PO verification. |
| 10 | Close observability and final journey gates | #1259 + #1382/#1383/#1384 → #1258 | Received events, clean baseline, SLO/alert/cleanup proof, Dev runs both products, then PO repeats on the exact deployed release. |

The `onnxruntime-web` int8/q8 failure was the upstream QDQ regression #28306/#28326, not a model verdict. The 459-word preflight exposed corpus/runtime defects before the 600-utterance selection run. Those lessons remain binding, but historical rows do not qualify the current **v2/v4** comparison.

## Active MVP and pre-GO issue register

All 23 current MVP/pre-GO issues and the one roadmap-owned gap (account deletion) have an owner and closure boundary; the Approved UI row also names its two open PRs:

| Area | Issues | Disposition |
|---|---|---|
| Final product/copy/journey | #1254, #1258, #1360, #1407 | Active; close owning fixes before the final exact-release journey and copy scan. |
| Observability/operations | #1259, #1382, #1383, #1384 | Active; received evidence and cleanup are required, not producer calls. |
| Security/CI truth | #1261, #1313, #1315, #1385 | Active pre-GO controls; keep separate from product-feature PRs. |
| STT comparison | #1304, #1390 | Active; validates **v4 (approved primary, not yet live) against v2 (pre-Start fallback, and today's only customer default)**. #1263 Moonshine is deferred until after RWT or MVP and is not required here. |
| Documentation/review gate | #1318 | PR #1477 merged 2026-09-16; this currentization restores the baseline to `main@5b89dc86`. Archives and dated evidence remain immutable. |
| Retention safety | #1452 | The newest-one migration was applied on 2026-09-12 and installs the policy **inert**; current activation is unverified (no read-only DB secret), and installation stopped the prior newest-two expiry. #1452 stays open with its must-fix-before-activation priority, re-classified P1/RWT blocker if activation is observed. PR #1497 was closed unmerged as superseded. See `RELEASE_STATUS.md`, *Database migration state*. |
| Account deletion | Roadmap-owned pre-GO gap | Product Owner owns disposition; Dev may author a bounded corrective issue/PR. Choose one deletion authority, make account erasure unblockable, cover unfinished `session_delivery_measurements` rows and the non-cascading `user_id` dependency, define cleanup/SLA ownership, and prove the real migrations in tests. Production migration remains separately authorized. |
| Progress/review/filler | #1471, #1472, #1473, #1476 | Active release blockers with separate owners. |
| Approved UI | #1474, #1475, PR #1503, PR #1505 | Design Correction Brief work (Home, Session and Share feedback merged); G7 retheme and the #1498 P2 follow-up open; no scope leakage into unrelated PRs. |
| Test identities | #1495 | Separate auth, full-product, paid and trial identity roles; consumer inventory first, and no identity or credential change without exact PO authorization. |

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
- superseded/not selected: #1268, #1295, #1386, #1389, #1415, #1460.

**#1307 is deliberately not in that list.** It is closed, but closed as the consolidated **parking lot**, and it is
the durable owner named in the accepted-Later table above for enterprise/team capabilities and demand validation.
Classifying it as "superseded/not selected" alongside a section that says not to reopen would read as a rejection of
accepted work and leave those workstreams with nowhere to send new evidence. Its disposition is: **accepted, parked,
owner of record**, releasable only through its own activation gate.

A closed issue may remain as provenance. New evidence goes to the current owner above rather than reopening a
duplicate — for the parked enterprise/team and demand-validation workstreams, that owner is #1307.

## Fixed decisions

- One customer product: Private Practice, with Open Mic and Focus Points.
- Complete product free for 30 days, then $10/month; no accumulated-minute commercial quota.
- Canonical Production URL only for PO model qualification.
- One STT engine per take; requested and observed identities must match.
- Moonshine is **deferred until after RWT or MVP** by Product Owner decision and is not part of current RWT qualification. The raw long-form failure evidence stands and is preserved; deferring the candidate does not retract the observation.
- No output deduplication/sanitization may hide a repetition loop.
- Exactly one **What went well** and one **What to improve** suggestion per eligible saved session.
- Newest-one transcript retention is the approved target. Its migration is installed inert in Production (ledger read 2026-09-18); activation still requires #1452 and exact PO authorization, and retention mutation is paused.
- No Production migration, configuration, credential, account, payment, deployment, RWT, or merge without exact-action authority.

## Stop conditions

- Do not resume Production RWT until the exact deployed candidate is PM-qualified and the Product Owner authorizes the named stop.
- Do not treat the partial Stop B or the descriptive v2/v4 observations as the comparable evidence that confirms v4 over v2.
- Do not treat CI, a transport 200, a generated artifact, or an installed observer as proof of received/user-visible behavior.
- Do not let post-MVP debt displace the current product merge token.

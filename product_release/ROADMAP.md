**Status:** Authoritative for the bounded current work routing below; wider canonical reconciliation remains open under #1318.
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-10-17 — Sam source-accepted the bounded corrections; successor review qualification remains separate.
**Last Verified:** 2026-10-17 — linked current assignments and source checkpoints; operational state is recorded in `RELEASE_STATUS.md`.
**Applies To:** RWT/Alpha, MVP/Beta sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** the stale September active-queue narrative here; archived `BACKLOG.md` and `ROADMAP.operational.md` remain provenance.
**Evidence Sources:** current linked owning issues, `RELEASE_STATUS.md`, and [Sam's #1318 assignment](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6234300137).

# SpeakSharp Roadmap

**19 October receiving correction.** The [35-item owner/closure directive](https://app.slack.com/archives/C0C9RE8KNHG/p1792432639622239) supersedes older queue assignments: App owns11, CLI15, Browser PM3 and Sam6. RWT/Alpha and MVP/Beta overlap but remain separate milestones. Prepared source must pass integration, deployment and matching acceptance; a final human sitting cannot close branch-only or unapplied work. Routine account exit follows [account-scoped policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298); elapsed timeout or request acceptance is not deletion. This is routing, not release or operational approval. Dynamic source/deployment facts remain in RELEASE_STATUS.

The fixed integration / qualification baseline is `5f5f465a93a5c582ca0f2553a0781ecb5eb9dfbf`, the reviewed #1650 mainline base integrated into #1648. The dated deployed-release read (`613a026e`, verified 26 October; historical `bc1ea8ea`) and subsequent drift belong in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md), which remains the only current deployment authority. The machine-readable copy below exists for the shared currency guard; it does not independently verify GitHub or Production or claim an evergreen current-main pointer. Its `baseline` field records `origin/main` at `d6be063facccf778df1c7b86742c9d3d69ed23fd` (after #1725), reconciled as merged source only in the dated 26 October `RELEASE_STATUS.md` addendum; the #1650 base above is unchanged.

<!-- CURRENCY-BLOCK
baseline: d6be063facccf778df1c7b86742c9d3d69ed23fd
deployed-release: 613a026eb8ec819c326043ebf68e03f388b6400a
verified-on: 2026-10-26
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
lane-1474: open
lane-1475: merged
lane-1467: merged
lane-1493: merged
lane-design-brief: open
lane-test-identity-roles: open
lane-canary-rotation: open
lane-practice-loop: merged
lane-moonshine: returned
-->

Legacy `task-1304-*` fields record merged source checkpoints, not model promotion or completion of the parent comparison program. The historical `onnxruntime-web` QDQ failures #28306/#28326 remain runtime observations, not model rejection: the 459-word preflight and 600-utterance selection are distinct evidence sets. Model evaluation and promotion retain their separate dispositions; no new model gate is created by this current-state correction.

## Now — existing owner assignments

Keep App Dev on RWT/Alpha and CLI Dev on MVP/Beta. Sam owns central routing, review, qualification and operational decisions; CLI PM supports monitoring/delivery. Production Dev reviews and GitHub work take precedence over Orch support. Preserve one writer per owned branch and serial guarded landings; independent source work does not wait for unrelated operational permission.

| Outcome / owning issue | Existing owner | Next bounded outcome / completion boundary |
|---|---|---|
| Full useful two-product RWT — #1258 / coordination #1593 | App Dev executes; Sam reviews; PO/named humans accept | Follow the existing nine-spec matrix and retain each case's PASS/FAIL/HOLD/not-run. Rebind the save/retry request-lost then response-lost packet to the actual served release with specific authority, receipt/cleanup review and stop conditions. Complete remaining received/human/device acceptance. Source merges do not close this outcome. |
| Backend-only staging — #1611 | CLI Dev post-deployment evidence; App Dev assigned operations; Sam dispositions | #1611 source is landed; migration120 is applied and verified, and the coupled Edge release and canary are reported successful. Do not repeat source reconciliation, landing or deployment. Remaining work is the existing nonsecret effective deployment identity, generation/configuration and default-disabled readback, followed by the separate #1643 customer-exit evidence. Deletion registration/activation and full customer acceptance remain separate decisions. Exact heads, runs and operation receipts live in `RELEASE_STATUS.md`. |
| Complete customer exit — #1643, with #1495 provider/fixture prerequisites | CLI Dev implementation/evidence; Sam scope/review; App Dev only assigned operations | Retain all nine existing acceptance items: cancellation versus deletion, account-bound email/UI, account-scoped admission and settlement under policy6251767298 (legacy cutover remains separately evidenced), registration/runtime binding, billing ownership/recovery, cleanup and terminal sign-in refusal, telemetry and controlled live proof. The authoritative registration/current-facts producer is SOURCE INCOMPLETE, separate from the missing operational drain/settlement evidence. Consolidate accepted preserved-source increments, integrate against current main and qualify before eligible controlled activation. Backend staging alone cannot close it. **23 Oct:** #1684 backend source (status read/issue/ACK) landed; completion execution is inactive, the producer is still SOURCE INCOMPLETE, runtime/schema is UNVERIFIED, and UI #1683 is inactive. |
| G10 presentation and acceptance — #1474 | App Dev final campaign release binding/live RWT; Browser PM evidence review; PO/named humans accept; Sam routing | [Sam's natural-growth ruling](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6240521998) supersedes the earlier pending recommendation. The Share Feedback opener is source-landed in #1649; #1652 source-landed the readable full prescription, unobscured repeat/retry controls and replacement rendered checks. [App's #1652 receipt6248196339](https://github.com/relativityE/speaksharp/pull/1652#issuecomment-6248196339) is recorded in the separately labelled post-snapshot addenda in [the deployment authority](./RELEASE_STATUS.md); do not repeat these repairs or that deployment. Remaining work is binding the final campaign to the actual served release, specifically authorized live RWT and human/mobile/device acceptance. Keep rejected reservations/unmet evidence; no clipping, hidden rows or weakened maximum-content oracle is approved here. **23 Oct:** #1679 (N1/N2) landed as source; it is not in the served `29d7c7e5` read. |
| Truthful download progress — #1491 / #1647 | App Dev | The bounded percentage-display fix is source-integrated and included in the later #1649 served-release receipt recorded in `RELEASE_STATUS.md`. Cold-download proof and mobile stale-label behavior retain their own evidence boundaries; do not repeat the old served-identity task. |
| Canonical documentation — #1318 | Browser PM; Sam reviews | Published via #1648/#1671; continue remaining reconciliation. Then continue the remaining canonical/current-document inventory and consolidated intake; do not recreate the accepted readiness packet or wait idle for release completion. This increment does not close the full inventory. |
| Existing telemetry and test-identity requirements — #1259 / #1495 / owning journey issues | App/CLI implementation by existing assignment; Sam dispositions | Keep received versus sent evidence, AUTH/FULL_PRODUCT/PAID/expired/conversion fixtures and cleanup boundaries distinct. Do not turn the broader five-role redesign into a new core-RWT entry gate. |
| Remaining product usefulness — #1548 | Existing product/engineering owners; Sam/PO adjudicate | Preserve the broader truthful/actionable coaching outcome. The narrow stored-target display integration is delivered source, not full product-effectiveness acceptance. **23 Oct:** #1681 practice-continuity source landed; it is not in the served `29d7c7e5` read. |

### Preserved sequencing and deferred intake

- Open owners #1254, #1261, #1315, #1259, #1383, #1407, #1472 and #1475 retain their live dispositions. Closed records below are **historical provenance**, not resurrected assignments:

| Closed record | Current owner / disposition |
|---|---|
| [#1313](https://github.com/relativityE/speaksharp/issues/1313) | Consolidated into [#1312](https://github.com/relativityE/speaksharp/issues/1312), post-MVP CI reliability. |
| [#1385](https://github.com/relativityE/speaksharp/issues/1385) | Remaining causal-truth residuals belong to [#1315](https://github.com/relativityE/speaksharp/issues/1315), not a replay of merged implementation. |
| [#1382](https://github.com/relativityE/speaksharp/issues/1382) / [#1384](https://github.com/relativityE/speaksharp/issues/1384) | Consolidated into [#1259](https://github.com/relativityE/speaksharp/issues/1259); later internal SLO work remains [#1383](https://github.com/relativityE/speaksharp/issues/1383). |
| [#1360](https://github.com/relativityE/speaksharp/issues/1360) / [#1473](https://github.com/relativityE/speaksharp/issues/1473) | Retained abandonment and useful coaching journey evidence belongs to [#1258](https://github.com/relativityE/speaksharp/issues/1258) / [#1593](https://github.com/relativityE/speaksharp/issues/1593). Historical mock/source proof does not close deployed acceptance. |
| [#1471](https://github.com/relativityE/speaksharp/issues/1471) | Its specific NULL-evidence casualty is closed; separate Start residuals are [#1491](https://github.com/relativityE/speaksharp/issues/1491), completeness [#1472](https://github.com/relativityE/speaksharp/issues/1472), and deployed journey [#1258](https://github.com/relativityE/speaksharp/issues/1258). |
| [#1476](https://github.com/relativityE/speaksharp/issues/1476) | Implementation closed after #1525; separate deployed acceptance transferred to [#1258](https://github.com/relativityE/speaksharp/issues/1258) / [#1593](https://github.com/relativityE/speaksharp/issues/1593). |
| [#1452](https://github.com/relativityE/speaksharp/issues/1452) | [Closed superseded/OBE for CR-091](https://github.com/relativityE/speaksharp/issues/1452#issuecomment-5782362326). Not an active retention assignment or a claim that every retention journey passed. Any fresh supported failure uses existing [#1491](https://github.com/relativityE/speaksharp/issues/1491) triage and [#1258](https://github.com/relativityE/speaksharp/issues/1258) acceptance, without reopening the old casualty by implication. |

### Existing sequence and consolidated intake

- #1606 → #1607 → option A retains its existing sequence where the live owner disposition still applies; old hashes are never new assignments.
- #1619/#1637 schema-source integration, #1611 backend staging, migration application, runtime deployment and deletion activation are separate checkpoints.
- [Sam's consolidated #1318 intake](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6234021735) retains signed-versus-owner-dispatched wording, six refutations/identifier aliases, retrospective evidence, old-bundle skew and release-tag decisions for the existing final batch. No separate documentation PR per row is required.
- The remaining 14-document verification and non-archive terminal-disposition inventory stay open under #1318. This two-file increment does not certify untouched documents, delete retained evidence or alter `archive/**`.

## Current parallel model work

**Model evaluation and current release boundaries.** Private v2 may complete MVP. The current coordination record selects the near-term #1565 evaluator and #1304 model/fallback work; do not treat an older post-MVP label as permission to stop that assigned work. Reuse preserved #1567/#1568 source through the sole CLI integration lane. Evaluation is not promotion: v4 and any fallback configuration require comparable real evidence and explicit Product Owner selection. One producer remains locked for a take; full useful Open Mic/Focus and applicable device acceptance remain required for the selected customer configuration. This document grants no model acquisition, live execution or activation authority. A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

## Later — explicitly post-MVP

Accepted work, deferred. Nothing in this section is declined, and nothing is dropped for being post-MVP: each item names the durable owner that holds its detail, so deferral never becomes deletion.

### Retained engineering debt



| Issues | Reason |
|---|---|
| #1275, #1312, #1322, #1340, #1398 | Dependency/runtime runway, CI optimization, retired remnants, generated-type maintenance and proof-selector hardening are retained debt, not current RWT blockers unless they reproduce a user-facing P0/P1. Closed #1462 is historical v4 provenance; the current model lane and owners are named above. |

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
- Newest-one transcript retention remains the approved target; application/activation observations belong in `RELEASE_STATUS.md`. #1452's specific casualty is closed superseded/OBE, not a standing blocker. This roadmap grants no retention mutation authority.
- No Production migration, configuration, credential, account, payment, deployment, RWT, or merge without exact-action authority.

## Stop conditions

- Do not resume Production RWT until the exact deployed candidate is PM-qualified and the Product Owner authorizes the named stop.
- Do not treat the partial Stop B or the descriptive v2/v4 observations as the comparable evidence that confirms v4 over v2.
- Do not treat CI, a transport 200, a generated artifact, or an installed observer as proof of received/user-visible behavior.
- Do not let post-MVP debt displace the current product merge token.

**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-23
**Last Verified:** 2026-09-23 — GitHub `main@1319e8b5803bf535b947f7587d215f3a4f118044` (`git ls-remote`), 6 open PRs, 34 open issues, and the linked issue/PR dispositions were read. Production deployment and migration ledger were **not** re-read; their last dated evidence lives in `RELEASE_STATUS.md`.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, the archived `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

> **Repository baseline `1319e8b5803bf535b947f7587d215f3a4f118044`** (GitHub `main`, read 2026-09-23). The last documented Production read is older and distinct; see `RELEASE_STATUS.md`. Neither the repository pointer nor a successful deploy proves which release is serving now.

This file is the live backlog authority. The former `BACKLOG.md` is archived and must not be restored as a fifteenth canonical document. Completion belongs in issue/PR/git history; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
baseline: 1319e8b5803bf535b947f7587d215f3a4f118044
deployed-release: be64b300a2a964501544f4f6421b9b5504f95a74
verified-on: 2026-09-23
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

One implementation lane and one merge token. Close #1525 (one-engine lease and per-session Progress), separately authorize and verify its migration, then restack #1521 (NULL clarity evidence) and decide its migration separately. #1473 still lacks its availability/grant correction and an unattended deployed 1+1 Practice Loop journey; #1486 alone did not close it. #1495's Gate 3 identity/HOLD patch is not integrated. The final #1258 journey follows the fixes.

### Open PR queue — six on GitHub, read 2026-09-23

| PR | Placement | Next boundary |
|---|---|---|
| #1525 (039043877, Draft) | RWT front; four P1 review threads remain after 17 were dispositioned. | Multi-device correction, exact-head CI/reviews, PO merge decision; migration apply is separate. |
| #1521 (8f314a3, Ready) | Progress NULL-evidence correction, older base. | Restack and requalify after #1525; migration apply is separate. |
| #1488 (ab73b03, Ready, currently unmergeable) | Exact-take canary observer, distinct from #1495. | Resolve conflicts and requalify before any merge. |
| #1523 (af82ff3, Ready) | Dispatch-only telemetry readback for #1382. | Qualify code; clean deployed baseline and #1259 remain open. |
| #1517 (888ff75, Draft) | Idle-route runtime battery/telemetry concern. | Park unless required journey or baseline evidence depends on it. |
| #1526 (c314938, Draft) | Eight masked workflow exits under #1315. | Outside RWT; classify release-critical false greens and restack before any later merge. |

No open PR is merged, deployed or ready for unconditional merge by this inventory. Age alone is not grounds to close a prepared PR. There is no catch-all post-MVP implementation PR.

### Open issue register — 34 on GitHub, read 2026-09-23

| Placement | Issues | Closure boundary |
|---|---|---|
| Immediate RWT and recovery (6) | #1360, #1471, #1472, #1473, #1476, #1495 | Return after abandonment, truthful filler/clarity, per-session Progress and one engine across devices, automatic Practice Loop, and identity/Gate 3 proof. |
| MVP and final deployed proof (17) | #1254, #1258, #1259, #1261, #1263, #1304, #1318, #1382, #1383, #1384, #1385, #1390, #1407, #1462, #1474, #1475, #1515 | Copy/UI truth, security/CI boundary, ordered telemetry, one model evidence matrix and both Production journeys. #1462 includes a near-term PO-directed model patch; only its broader research is later. |
| Deferred or conditional (11) | #1275, #1312, #1313, #1315, #1322, #1340, #1398, #1479, #1484, #1491, #1496 | Keep issue acceptance detail. Promote #1313/#1315 for a proved false release verdict, and #1275 for a reachable shipped/trusted path or required SCA gate. #1479 branch pruning is done; its archive half remains later. |

No unverified issue is closed by this currentization. #1475 still requires its remaining deployed landing variant check after #1522's verified disabled variant; #1474 retains outstanding design/journey acceptance; #1473 lacks code and Production proof. #1452 is already closed, so it is not an open retention gate. Actual newest-one retention activation remains unverified independently of that closure.

### One execution plan per shared outcome

- #1476 and the PO's one-engine rule belong to #1525; #1471 follows in #1521. Keep each outcome open until its own deployment/save/Progress evidence is complete.
- #1304 and #1390 share one pinned evidence matrix; #1390 adds exact Production requested/observed-engine journeys. #1462's 4.2.0 versus 4.3.0 check and #1263's Moonshine/runtime path reuse the same harness.
- #1259 and #1382/#1383/#1384 proceed as telemetry identity, clean baseline, SLO, then deployed receipt/dashboard/alert/cleanup proof. #1523 only prepares dispatch.
- #1254 and #1515 share one final copy pass; #1515 keeps its bounded false-adjacency check. #1495's skipped-proof HOLD and #1488's exact-take canary are complementary.
- #1474's G10 design and #1407's Focus Points journey retain the G16 numeric body, S-12 verdict/evidence contract, S-15/S-16, the “Count look wrong?” opener and shared dialog surface until each is accepted on the deployed product. Merged layout increments do not close the remaining acceptance items.

The PO's conditional user-serving default target is v4:base:q4 on pinned Transformers.js 4.3.0, including browser WASM without WebGPU. On this baseline, the checked-in config still selects v2:base.en and package.json declares ^4.2.0. Base q4's current WASM decode, reproducible paired quality, and full 4.3.0 journey are HOLD until measured. Historical base-int8 WASM data do not qualify base q4. The old v4:distil:q4 default wording is superseded; distil remains a WebGPU comparison candidate. Moonshine quantized_26_08_21 is the sole forward revision, but installed npm WASM rejects its split frontend and long-audio repetition/tail remains unmeasured. Do not reinstate the known-bad older set or promote any model solely because a version is newer.

Prior onnxruntime-web int8/q8 failure was upstream QDQ regression #28306/#28326, not a model-quality verdict. The 459-word preflight exposed harness/runtime issues before the 600-utterance selection run. Preserve those dated observations as provenance, not proof of current base-q4 WASM performance.
## Later — explicitly post-MVP

Accepted work, deferred. Nothing in this section is declined, and nothing is dropped for being post-MVP: each item names the durable owner that holds its detail, so deferral never becomes deletion.

### Retained engineering debt

| Issues | Reason |
|---|---|
| #1275, #1312, #1322, #1340, #1398 | Dependency remediation, CI speed, retired runtime remnants, generated-type maintenance and proof-selector hardening. Retained, not current RWT blockers unless the specific issue's promotion condition occurs. |
| #1313, #1315 (Draft PR #1526), #1491 | Conditional CI reliability and parked P2 findings; promote a demonstrated release-critical false verdict or a PO-selected bounded item. A Draft PR is not a blanket post-MVP authorization. |
| #1479, #1496 | Remaining archive cleanup and post-Stop PCM-buffer release; branch pruning under #1479 has already been receipted. |
| #1462 (broader research), #1263 (Moonshine) | Future model work only. The PO's near-term base-q4 4.3.0 qualification is active and stays in the Now register. |

### Accepted product and business workstreams

| Workstream | Durable owner | Standing |
|---|---|---|
| **Enterprise and team capabilities** — organization accounts and administration; SSO/SAML and SCIM; role-based access and organization isolation; audit logs; organization-configurable retention/deletion; procurement/security documentation; support/SLA and incident-response commitments; cohort reports and content-free exports; organization policy controls | **#1307**, the consolidated parking lot (preserves the selected ideas from closed #1048 and #1075). The durable architectural constraints live in `ARCHITECTURE.md` §14. | Accepted and parked. Build nothing until #1307's activation gate is met: released and stable MVP, a concrete request, an explicit Product Owner choice, a new scoped issue, and resolved privacy/security/retention/trademark implications. |
| **On-prem / self-hosted deployment** | This file is the classification authority; `ARCHITECTURE.md` §14 states the boundary it sits against. | Accepted as **Later**, explicitly **not declined**. Separate per-customer databases/deployments and per-tenant models are Declined below; on-prem/self-hosted is not. |
| **Demand validation and market discovery** | **#1307** — the three current strengths recorded there are positioning hypotheses to validate, not feature requirements. | Accepted, sequenced strictly after the product is release-qualified. Competitive analysis must not change current requirements, acceptance criteria, gates, sequencing, or scope. |
| **Financial and pricing validation** | `work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-09-05.md` and the workbook it records, held as a point-in-time artifact. | Accepted as an **unvalidated planning forecast**. It is not evidence, not a product promise, and authorizes no pricing or entitlement change. |
| **Account exit and deletion** | #1484 | Stripe-owned cancellation/resumption and a separate post-MVP permanent closure journey. This current issue classification supersedes the old pre-GO roadmap-owned account-deletion gap; any changed release obligation needs an explicit PO disposition. |

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

Later receipts: #1527 was closed as a duplicate of #1476/#1525, #1522 completed the disabled-payment landing fix (the remaining #1475 verification stays open), and #1452 is closed as not planned. These are not members of the 34 open issues above.

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
- One active STT engine per account across tabs and devices, including preparation, after #1525's server enforcement is applied and verified; requested and observed identities must match. This is a current RWT requirement, not later debt.
- The conditional v4:base:q4 4.3.0 target does not become a user-serving default without browser WASM, paired quality and full-journey proof. v2 is being phased out as a default, not silently replaced by an unqualified candidate.
- Moonshine quantized_26_08_21 remains forward evaluation work outside the immediate RWT train until the actual loader and long-audio integrity pass; the old set's negative evidence remains preserved.
- No output deduplication/sanitization may hide a repetition loop.
- Exactly one **What went well** and one **What to improve** suggestion per eligible saved session.
- Newest-one transcript retention is the approved target. The 2026-09-18 ledger read observed its migration installed inert; current activation is unverified. #1452 is closed as not planned, so do not claim that it remains an open gate. Any activation remains a separate exact PO decision based on a fresh read.
- No Production migration, configuration, credential, account, payment, deployment, RWT, or merge without exact-action authority.

## Stop conditions

- Do not resume Production RWT until the exact deployed candidate is PM-qualified and the Product Owner authorizes the named stop.
- Do not treat the partial Stop B or the descriptive v2/v4 observations as the comparable evidence that confirms v4 over v2.
- Do not treat CI, a transport 200, a generated artifact, or an installed observer as proof of received/user-visible behavior.
- Do not let post-MVP debt displace the current product merge token.

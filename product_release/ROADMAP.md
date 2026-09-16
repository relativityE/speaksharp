**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-16 — reconciled to `main@f7179031`, which is `main` after PR #1469 and PR #1483 merged; the open PRs, the open issues, and incomplete RWT evidence were re-read at the same time.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, the archived `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

> **Baseline `f7179031a230e1d3d346b05020d0d207ad9de0c4`** (`main`, 2026-09-16, after #1483). The deployed release is recorded separately in `RELEASE_STATUS.md` and is a **read** of Production, never inferred from this pointer — the two values currently differ because Production has not been re-read since #1483 merged.

This file is the live backlog authority. The former `BACKLOG.md` is archived and must not be restored as a fifteenth canonical document. Completion belongs in issue/PR/git history; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
baseline: f7179031a230e1d3d346b05020d0d207ad9de0c4
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
lane-1481: open
lane-canary-rotation: open
lane-practice-loop: open
lane-moonshine: returned
-->

The currency guard checks internal consistency and recent ancestry; it cannot read a moving GitHub branch or Production deployment.

## Now — closure-first path back to RWT

Keep one merge token and one active coding lane. PR #1477 now contains a bounded review-qualification implementation and is frozen behind the current merge-token holder, PR #1469. It may not proceed as a parallel implementation lane or merge until #1469 closes; then it must restack/currentize once and repeat exact-head reviews and CI.

| Order | Outcome | Owner | Smallest closure evidence |
|---|---|---|---|
| 1 | Close Focus Points attribution authority | PR #1469 | Exact-head automatic reviews + full CI, PM acceptance, exact PO head/base authorization; Production migration application remains separate. |
| 2 | Close Focus verdict palette/explanation | PR #1467 | Restack after #1469, preserve bounded UI scope, exact-head browser/CI/review packet. |
| 3 | Make progress saves truthful and cross-tab safe | #1471 → #1476 | Empty `{}` never means verified zero; two-tab queue casualties prove no loss, overwrite, duplication, or indefinite Start hold. |
| 4 | Restore the automatic Practice Loop review | #1473 | One automatic request, one valid 1+1 review or cause-matched terminal, truthful retry, received telemetry, and separate authorized Production grant/Edge checks. |
| 5 | Stop false filler/clarity claims | #1472 | Persisted `complete | unobservable | no_speech` state shared by Session, Analytics, PDF, Progress, recovery, and telemetry. |
| 6 | Make Moonshine genuinely RWT-ready | #1263 | Keep acquisition/switch fixes; investigate and eliminate the real long-form loop at the model-driving boundary without output sanitization; prove tail and live-stability contracts. |
| 7 | Produce comparable model rows and decision | #1304 + #1390 | Same corpus, identity, word-count, filler completeness, WER, latency, stability, and v2/v4/Moonshine journey evidence; then an explicit PO primary/fallback choice. |
| 8 | Complete the approved core UI | #1474 | G10 during/after Practice Loop hierarchy/theme, with loading/success/failure in the same dominant footprint. |
| 9 | Complete the approved landing page | #1475 | G12 landing layout/theme and full 30-day/$10 offer, without shipping claims ahead of #1471/#1473. |
| 10 | Close observability and final journey gates | #1259 + #1382/#1383/#1384 → #1258 | Received events, clean baseline, SLO/alert/cleanup proof, Dev runs both products, then PO repeats on the exact deployed release. |

The `onnxruntime-web` int8/q8 failure was the upstream QDQ regression #28306/#28326, not a model verdict. The 459-word preflight exposed corpus/runtime defects before the 600-utterance selection run. Those lessons remain binding, but historical rows do not qualify the current v2/v4/Moonshine comparison.

## Active MVP and pre-GO issue register

All 24 current MVP/pre-GO issues and roadmap-owned gaps have an owner and closure boundary:

| Area | Issues | Disposition |
|---|---|---|
| Final product/copy/journey | #1254, #1258, #1360, #1407 | Active; close owning fixes before the final exact-release journey and copy scan. |
| Observability/operations | #1259, #1382, #1383, #1384 | Active; received evidence and cleanup are required, not producer calls. |
| Security/CI truth | #1261, #1313, #1315, #1385 | Active pre-GO controls; keep separate from product-feature PRs. |
| STT comparison | #1263, #1304, #1390 | Active; Moonshine is mandatory and currently blocked on long-form integrity. |
| Documentation/review gate | #1318 / PR #1477 | Queued implementation behind #1469; canonical-authority currentization plus the bounded documentation-review qualification. Archives and dated evidence remain immutable. |
| Retention safety | #1452 | Must close before newest-one retention is activated; it does not authorize activation. |
| Account deletion | Roadmap-owned pre-GO gap | Product Owner owns disposition; Dev may author a bounded corrective issue/PR. Choose one deletion authority, make account erasure unblockable, cover unfinished `session_delivery_measurements` rows and the non-cascading `user_id` dependency, define cleanup/SLA ownership, and prove the real migrations in tests. Production migration remains separately authorized. |
| Progress/review/filler | #1471, #1472, #1473, #1476 | Active release blockers with separate owners. |
| Approved UI | #1474, #1475 | Active approved design work; no scope leakage into unrelated PRs. |

## Later — explicitly post-MVP

| Issues | Reason |
|---|---|
| #1275, #1312, #1322, #1340, #1398, #1462 | Dependency/runtime runway, CI optimization, retired remnants, generated-type maintenance, proof-selector hardening, and future v4 research are retained debt, not current RWT blockers unless they reproduce a user-facing P0/P1. |

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
- Moonshine remains in the comparison until a Product Owner decision explicitly removes it.
- No output deduplication/sanitization may hide a repetition loop.
- Exactly one **What went well** and one **What to improve** suggestion per eligible saved session.
- Newest-one transcript retention is the approved target; #1452 must close before activation.
- No Production migration, configuration, credential, account, payment, deployment, RWT, or merge without exact-action authority.

## Stop conditions

- Do not resume Production RWT until the exact deployed candidate is PM-qualified and the Product Owner authorizes the named stop.
- Do not downselect STT from the partial Stop B or descriptive v2/v4 observations.
- Do not treat CI, a transport 200, a generated artifact, or an installed observer as proof of received/user-visible behavior.
- Do not let the queued #1477 gate/docs lane or post-MVP debt displace the current product merge token.

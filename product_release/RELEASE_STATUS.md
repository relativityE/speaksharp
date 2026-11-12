# Release Status

**Status:** Authoritative for the bounded 9 November 2026 MVP acceptance map and source snapshot below; earlier dated component snapshots remain history. Release acceptance HOLD.
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-10-28 — specialist source review and current-main receiving; exact-head qualification remains a separate gate.
**Last Verified:** 2026-11-12 — source through main `b9907d62` (#1830); Production `__APP_RELEASE__` read directly as `d401349b` on 2026-11-12; no end-to-end acceptance is claimed (the 5 November reconciliation below remains dated history). The acceptance map below records the 2026-11-10 consolidation state, inspected with its retained source. #1760 and #1788 remain open unmerged. #1798/#1799/#1800 are closed duplicates of #1760/#1782/#1795; #1797 retains distinct recovery work pending disposition. #1774 is closed with its branch deleted because its source landed through #1772; operational acceptance remains OPEN. The prior main observation was `524c325a95874d31239203dce9ef7893331ca756`. This is source reconciliation, not a fresh Production read, hosted recovery success or end-to-end acceptance.
**Applies To:** Current production deployment + RWT/Alpha and MVP/Beta release tracks.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** the September current-status narrative and October baseline-only banner here. Historical evidence and archives remain unchanged.
**Evidence Sources:** the exact GitHub PR, issue-comment and workflow receipts linked below.

## 9 November 2026 MVP acceptance map

**HOLD.** The release outcome is customer benefit worth paying for: useful, trustworthy
practice that helps the customer improve what they intended to practise. The
recommendation → deliberate same-target repeat → honest comparison → return loop is
the mechanism to test that value. Executing the loop, moving an unrelated metric,
passing CI or merging a PR does not establish usefulness or willingness to pay.

This is the one bounded acceptance map under [#1539](https://github.com/relativityE/speaksharp/issues/1539),
not another broad audit. All work belongs to the ten numbered buckets below. Each
bucket follows all four stages: **1. Define the release/pilot contract; 2. Close its
product or safety gap; 3. Prove the identified release; 4. Release and learn.** A
source increment can finish stage 2 while stages 3 and 4 remain open. Work can proceed
in parallel only with disjoint ownership; integration and release remain serial.

The selected Private STT (`v2:base.en`), Gemini coaching provider and software stack
stay fixed. Model/provider competitions and infrastructure expansion are deferred
unless separately selected. Existing broader obligations remain visible.

### Release contract and evidence rules

- Open Mic, full Focus and partial Focus remain in the acceptance inventory. Supported
  device/browser versions, pilot participants, named observation owners, free-only
  versus paid pilot, and quality thresholds still need an explicit release decision.
  Until then, no narrower scope is treated as approved.
- Keep **15 automated practice cases**, **six human/device records**, the existing
  **151 requirements**, and billing lifecycle/paid-value obligations as distinct
  inventories. A short pilot check cannot close #1788 or its remaining cases.
- State speech-quality and coaching-usefulness thresholds before measuring. Record
  real-speech provenance, task, device, duration, opening/trailing speech preservation,
  saved/reopened transcript, groundedness, specificity, actionability, latency and
  failure handling. Synthetic evaluator proxies are supporting evidence only.
- For each result retain source head, observed frontend, backend and schema identity,
  account role, product, same accepted target and saved-session binding, test method,
  reviewer, actual outcome and limitations. Keep source, mocked, real-engine,
  authoritative database, provider-received and human observations separate.
- Missing evidence is NOT RUN, NOT MEASURED, UNKNOWN or HOLD as appropriate, never
  zero or PASS. Observed metric movement is not causal proof that advice worked.
- A free pilot still needs its applicable safety, useful-practice and device evidence.
  Payment activation additionally needs buckets 7 and 8. Neither pilot nor payment
  activation is authorized by this map.

### Test effectiveness belongs inside the ten PRs

Every receiving PR includes a risk-proportionate causal test-effectiveness contract:
the customer or safety claim; the responsible code boundary; an independent oracle;
a passing baseline; an equivalent-source control that stays green where applicable;
the intended semantic fault that makes the designated assertion fail; and a
byte-identical restored pass with unchanged test collection. A setup failure, timeout,
crash, missing test or skipped assertion is not evidence that the test detects the
intended defect. String-only source checks cannot prove runtime or product behavior;
bucket 1's structural document checks prove only the document contract. This tests
whether a control catches its fault, not whether coaching caused a customer to improve.

Each PR reports exact-source evidence as PASS, FAIL, NOT RUN, NOT MEASURED, UNKNOWN or
HOLD without converting missing or contradictory evidence to success. Fault injection
uses isolated permitted fixtures; live or destructive effects retain their separate
authorization. These obligations stay in the ten buckets. The forthcoming consultant
review may identify a residual cross-cutting gap, but it does not create an eleventh
PR without a separate decision.

| Bucket | Required defect-sensitive proof within its own PR |
|---|---|
| 1 | Missing/duplicated outcome, dropped retained requirement or falsely completed evidence is detected; preserved history and inventory denominators remain unchanged. |
| 2 | Wrong model/readiness/served type, lost speech boundary or unpreserved transcript fails the appropriate assertion; source serving tests do not imply measured speech quality. |
| 3 | Unsupported advice, wrong saved-session context, unusable recommendation or hidden failure is rejected by the declared oracle; human judgments stay separate from deterministic proxies. |
| 4 | Wrong accepted target, unrelated/latest-session substitution, cross-account/product linkage or missing durable reference cannot pass; explicitly incomparable content cannot receive a delivery-metric success label. |
| 5 | Stale/split release identity, wrong oracle source, missing case, setup-only execution or incomplete receipts fail closed; the complete intended-release oracle is qualified before an authorized journey run. |
| 6 | Wrong-owner review, lost partial Focus detection and discarded correction show baseline/equivalent-green, intended-red and restored-green; actual-device faults remain actual-device evidence. |
| 7 | Wrong billing identity, synthetic rather than genuine event delivery, lifecycle omission or unsettled cleanup cannot produce acceptance. |
| 8 | Substituting a free/trial user, another paid identity, unrelated repeat or nonpersistent result fails the same-paid-identity value-loop proof. |
| 9 | Partial/ambiguous credentials, unauthorized account access, missing consent, unsafe recovery/deletion or unintended privilege cannot pass; intended identity remains bound before mutation. |
| 10 | Stale release identity, missing evidence, fabricated monitoring readiness or unverified rollback fails the release decision; historical results cannot stand in for current execution. |

### Retained requirement, telemetry and efficacy crosswalk

[#1539](https://github.com/relativityE/speaksharp/issues/1539) retains the
requirement-level authority. Each of its 151 requirement IDs needs the original
requirement and source, one primary outcome below, current owner, exact test/oracle,
source/runtime identity, evidence class, actual result and explicit disposition.
Dependencies are cross-links, not duplicate outcomes. **HOLD: the complete 151-row
receiving matrix has not yet been independently verified.** The family-level map
below prevents silent scope loss; it is not a claim that each requirement is complete.

The [retained instrumentation contract](https://github.com/relativityE/speaksharp/pull/1713#issuecomment-6429115381)
contains thirteen families. Receive their still-applicable requirements as follows:

| Retained family | Primary outcome and dependencies | Required evidence boundary |
|---|---|---|
| Recording intent and preparation | STT reliability (2); practice journeys (5) | Selected intent, acquisition, cancellation/supersession and actual recording latency on the same attempt. |
| Recording control | STT reliability (2); supported devices (6) | Runtime/control state, exactly-one Stop and settlement. |
| Focus transition | Practice journeys (5); supported devices (6) | Selected setup, intended arrival and actual recording, with truthful failure/unavailable reason. |
| Provisional stability | STT reliability (2) | Content-free interim/finalization and rewrite measurements; no transcript leakage. |
| Transcript authority | STT reliability (2); same-target comparison (4) | Same-attempt finalized, accepted, persisted and reopened transcript authority. |
| Coverage | Practice journeys (5); useful coaching (3) | Versioned full/partial Focus judgments, exact counts and failure states bound to saved evidence. |
| Practice Loop | Same-target comparison (4); coaching (3), paid value (8) | Current coaching contract, accepted action, linked repeat and honest generated/rendered comparison. |
| Completion/navigation | Practice journeys (5); devices (6) | Actual available action, intended route and terminal/failure outcome. |
| Share feedback | Practice journeys (5); account/privacy (9) | Older-take/no-session association, field-presence/clearing controls, storage and received acknowledgement without content. |
| Retention truth | Account/privacy (9) | Current policy, enforcement, retained history and truthful expired-content availability. |
| Runtime downselection | STT reliability (2) | Selected-model/runtime identity and locked fixed selection. Historical multi-model activation is not reauthorized. |
| Acquisition receipt | STT reliability (2) | Immutable identity, cache/download/setup evidence, completeness and settled runtime. |
| Observer integrity | Release operation (10); every producing outcome | Governed capture, positive/negative controls, observable missing/drop/backpressure and independent received proof. |

Release operation (10) owns the broader clean traffic/release baseline,
raw-to-dashboard reconciliation, alert fire/recovery and after-Beta token/cost
finish-or-decline dispositions. None is silently waived by a smaller pilot. Across
all families, correlate the same release/account/product/journey/attempt through
browser SENT, authoritative server/database and independent vendor RECEIVED evidence,
with scoped cleanup. Source totals, transport success and fabricated zero cannot
replace received proof. Preserve candidate-A current-main/named-column controls and
selected-attempt isolation from a later unsaved Start or another attempt's save.

The seven efficacy deliverables from #1539 remain required inside the ten outcomes:

| Retained deliverable | Primary receiving outcome | Completion requirement |
|---|---|---|
| Two-product journey and Private STT test inventory | Practice-journey testing (5), with STT (2) | Exact case-title/layer inventory and supported callers/replay, not test counts alone. |
| User-benefit traceability matrix | MVP acceptance (1) | Requirement-ID to customer benefit, primary outcome, owner, evidence and disposition. |
| Ground-truth instrumentation map | Release operation (10), with each producer | Same-attempt authority and received-evidence chain for the thirteen families. |
| False-green, mock-fidelity and obsolete-test register | Practice-journey testing (5) | KEEP/REPAIR/CONSOLIDATE/RETIRE/U dispositions, independent oracle/mutation and real-versus-mocked limits. |
| Severity-ranked reproducible coverage-gap register | MVP acceptance (1), fixes within the responsible outcome | Original casualty, user harm, reproduction, expected assertion, owner and evidence. |
| Authoritative RWT/release lanes versus supporting suites | Release operation (10) | Correct evidence classes, cost/flakiness, path coverage and supported replay/callers. |
| Bounded follow-ups for accepted gaps | The responsible existing outcome | Explicit scope/owner and preserved unique controls; no catch-all or eleventh PR. |

Before test retirement, account for unique privacy/auth/deployment/telemetry controls.
Retain conditional rows from the
[adopted register](https://github.com/relativityE/speaksharp/pull/1674#issuecomment-6429243358):
natural unforced expiry and disabled Practice-again reason (same-target/account outcomes),
malformed coaching references (coaching), Focus Back-history/detection and unresolved
design decisions (journeys), same-set comparison (same-target), and same-head review-event
cancellation (release operation). Preserve their trigger conditions and explicit deferrals.
Historical owners, old coaching-output shapes and model competitions are not revived.

### Coordinated transition into ten outcome PRs

**Current developer roster:** Bezos and Elon only. Bezos owns STT reliability
(outcome 2, surviving #1760; implementation paused); Elon owns practice-journey testing
(outcome 5, surviving #1788). This map assigns no additional writer.
Same-target comparison (outcome 4) remains queued until one is free
and its file ownership is confirmed. Sam coordinates acceptance and handoffs; no
additional developer assignment is inferred from older dated records below.

All seven legacy PRs are mapped below, not additional or unassigned workstreams.
#1760 and #1788 were administratively closed and subsequently reopened at the
Product Owner's direction. Both remain unmerged. Their actual published source is
preserved in their original PRs; #1798 is closed as superseded, while #1797 remains
open with distinct recovery machinery pending an explicit preserve-or-retire decision.
The Product Owner has
authorized merging the original PRs only after applicable qualification; no merge
has been performed through this transition. Other legacy PRs remain open until
their complete source, deliverables, findings and owner handoff are verified.
#1799 and #1800 are closed as duplicates of #1782 and #1795, with their duplicate
branches deleted. #1774 is closed as already integrated through #1772; its obsolete
branch is deleted. These administrative closures do not complete customer acceptance.
Other retained PRs do not create additional active developers or implementation lanes.

The transition is not yet complete. Obtain each writer's exact checkpoint, including unpublished changes,
head/tree, unresolved findings, evidence and remaining obligations. Preserve private
work in its existing approved location rather than copying it into a public ledger.
For every old PR, agree and independently verify the receiving checkpoint before closure.
Preserve unmerged source and do not claim it shipped. Then confirm one writer and one
numbered outcome PR. Mapping alone does not authorize merging unqualified source.
Delete branches associated with authorized closures only after their source and
obligations are reconciled. Do not discard unique work, transfer operational grants or
start overlapping implementations. Existing merged PRs remain immutable provenance.

| New bucket PR | Prior work to receive | Current transition |
|---|---|---|
| 1. MVP acceptance map | #1539 and this existing release record | [#1796](https://github.com/relativityE/speaksharp/pull/1796), substantive map and document controls. |
| 2. Selected speech path | Reopened #1760; retain #1789/#1790/#1794 as explicitly deferred or remaining obligations | [#1760](https://github.com/relativityE/speaksharp/pull/1760) survives; duplicate #1798 is closed. Bezos retains ownership; implementation remains paused. |
| 3. Useful current coaching | Merged #1773/#1792 evidence, no active PR to restore | Freeze scope and real-session rubric; no speculative provider change. |
| 4. Same-target outcome | Merged #1548 provenance; preserved local product preparation | Queued until Bezos or Elon is free and ownership is confirmed; no releasable implementation claimed. |
| 5. Automated practice journeys | Reopened #1788 and its exact all-15 closure contract | [#1788](https://github.com/relativityE/speaksharp/pull/1788) survives; #1797 remains open for explicit disposition of distinct recovery machinery and findings. Elon owns current work; no competing implementation. |
| 6. Supported-device journey | #1782 and retained #1539 human/device obligations | [#1782](https://github.com/relativityE/speaksharp/pull/1782) survives; duplicate #1799 is closed and its branch deleted. Actual device proof remains open. |
| 7. Testable billing | #1795 | [#1795](https://github.com/relativityE/speaksharp/pull/1795) survives; duplicate #1800 is closed and its branch deleted. Genuine billing acceptance remains open. |
| 8. Connect paid access to the same value loop | #1795's PAID-01 extension; dependencies from buckets 4 and 7 and identity controls from bucket 9 | Same paid identity through coaching → linked repeat → comparison → return; no separate implementation underway. |
| 9. Account/privacy/credentials | #1770 and #1775; retained #1539 controls and PAID-04 identity/credential controls | Both retained PRs map here; reconcile their shared workflow before one successor writer. |
| 10. One operated release | #1774 source integrated through merged #1772; canonical release evidence | #1774 is closed as superseded and its branch deleted. No unique unlanded source or new implementation receiver is required. Operational acceptance remains OPEN in this map. |

No placeholder implementation or unearned completion is implied by a planned bucket.
Each resulting PR must show its actual delivered increment, four-stage contract,
carried obligations and remaining approvals. Source delivery cannot claim stages 3–4.

### Existing PR inventory to preserve

Consolidation state was verified on 10 November 2026. The 9 November source snapshots
below remain immutable provenance, not current-head assertions. Every retained PR has
one primary bucket; dependencies
may cross buckets without creating another workstream. These are source identities,
not release identities. Re-read heads before any review, integration or operation.

| Bucket | Retained PR | Observed head | Remaining acceptance boundary / source owner |
|---|---|---|---|
| 2 | [#1760](https://github.com/relativityE/speaksharp/pull/1760), open unmerged | Historical `f99627fc85f2a9f44abe979605402970ea0fec03`; 10 November head `b504cf85fb22f9128382ed5c1782a8f5431231d3` | Surviving source; duplicate #1798 closed. Final source/release qualification and real incumbent speech quality remain separate; implementation paused. |
| 5 | [#1788](https://github.com/relativityE/speaksharp/pull/1788), open unmerged | Historical branch `2eb036766adf1a9fb3e3b618926a3494b84390c2`; earlier closed snapshot `655d229bf7b3d7dfe450a190775ee48c626cf325`; 10 November head `bf7c1bcd5246154c41e0874b8928a1663232d653` | Surviving source; #1797 at d9de83ff retains distinct recovery machinery pending explicit disposition. Preserve newer #1788 corrections, unresolved findings and all-15 contract; no whole-branch overwrite. |
| 6 | [#1782](https://github.com/relativityE/speaksharp/pull/1782) | `62b7a0d044df736cd86c81a50271e8fd565fc646` | Saved-review viewport coverage and three semantic controls; real device/human acceptance remains separate. Existing viewport-test owner. |
| 7 | [#1795](https://github.com/relativityE/speaksharp/pull/1795) | `5dc87301962252bf599963a86ebb0de6e2336462` | Draft sandbox lifecycle source; isolated entry, cleanup, genuine delivery and final qualification remain open. Sam coordinates billing implementation. |
| 9 | [#1770](https://github.com/relativityE/speaksharp/pull/1770) | `47b5974f58ff28018b3f4f3737eea43397fdbeda` | Read-only account verifier; shared workflow reconciliation and current qualification. Existing account-verifier owner. |
| 9 | [#1775](https://github.com/relativityE/speaksharp/pull/1775) | `d08055ca5165d1a1c40fe49f18366f5afad75490` | Trusted-main credential-job source; provisioning, consumer proof and fallback removal remain separately gated. Existing credential-boundary owner. |
| 10 | [#1774](https://github.com/relativityE/speaksharp/pull/1774), closed superseded, unmerged | `54c674ace88f2e22acd1c01a9a5ec2cf533193f2` | Source integrated through #1772; obsolete branch deleted. No unique unlanded source remains. Operational acceptance stays OPEN; no active schedule is established. |

Merged [#1548](https://github.com/relativityE/speaksharp/pull/1548),
[#1773](https://github.com/relativityE/speaksharp/pull/1773) and
[#1792](https://github.com/relativityE/speaksharp/pull/1792) are immutable delivery
provenance, not extra active PRs. Their unproven outcomes map to buckets 4, 3 and 3
respectively. No merged branch is restored, unique source discarded, or historical
result rewritten by this documentation increment. The observed administrative
closures above are not evidence of implementation or acceptance. New implementation
must stay within the ten outcome PRs.

**Historical preservation boundaries (9 November 2026).** STT receiver #1798 initially shares exactly
the f99627fc commit with #1760. To reopen the original without closing its receiver,
#1798 temporarily targeted `integration/stt-reliability-receiving-base-20261109`,
created at main `524c325a95874d31239203dce9ef7893331ca756`. This is a temporary
stack, not a source rebase or qualification bypass. That historical transition is
superseded by closure of duplicate #1798; continue on surviving #1760. Do not merge
into the temporary base.

For practice-journey testing, the full-tree audit of receiving carry commit
`fb751383e4998515361bfd1a1840ed5838f7af0e` against legacy `2eb03676` found
3,180 of 3,183 existing file blobs byte-identical and no deleted files. Three updates
and four additions reconcile already-landed #1792 coaching work. The next received
correction at `e3f0b94c` changes exactly five recovery/workflow/test/inventory files.
Later #1797 heads, including observed `4d791aa0`, require their own qualification;
the preservation audit is not a review of those later edits or unpublished work.

### 1. One MVP acceptance map

**Owner/handoff:** Sam maintains the map; Product Owner selects pilot scope and release.
**State:** this documentation increment supplies the map; release decisions remain open.

1. **Define:** record customer value, supported modes/devices, free/paid scope, quality
   bars, owners and explicit deferrals without shrinking full-release obligations.
2. **Close:** reconcile every open PR and retained requirement to these ten buckets,
   using this existing release record and #1539; preserve original denominators.
3. **Prove:** verify every claimed result against exact source/runtime evidence and
   review the map for missing, contradictory or falsely completed obligations.
4. **Release/learn:** use the accepted map for the go/no-go and subsequent learning;
   update it only at coherent checkpoints with actual evidence and owner decisions.

### 2. Qualify the selected speech path

**Owner/handoff:** Bezos selected; receiving checkpoint → independent review → Sam → authorized operator.
**State:** serving correction was published at `359f7efd` per the
[dated receipt](https://github.com/relativityE/speaksharp/pull/1760#issuecomment-6746204253);
the newer observed head is recorded above and requires its own qualification.
Production serving behavior and representative real-speech quality are not established.

**Outstanding source and review carryover:** retain all #1760 commits and its
all historical review threads, including the supported-window correction at
`2fd1bc27` and exact-cache-set correction at `f99627fc`; unresolved thread state does
not mean their reported corrections are absent. The
[PCM-report finding](https://github.com/relativityE/speaksharp/pull/1760#discussion_r4516450447)
was rebutted by the author's
[command-test reproduction](https://github.com/relativityE/speaksharp/pull/1760#discussion_r4516694843).
The current GitHub read shows all inline threads resolved. Preserve the rebuttal
and any unpublished regression; do not call it a code fix. Preserve final
release-review disposition, serving acceptance, final-head CI/reviews, real
selected-engine transcripts and device quality as separate unfinished obligations.
Alternative-model evaluation/adoption (#1789/#1790) and P3 (#1794) remain explicitly
deferred, with their source retained; they cannot silently expand the fixed-stack scope.

1. **Define:** keep the incumbent and fixed stack; select representative speech,
   supported devices and predeclared quality/reliability bars, including speech edges.
2. **Close:** finish #1760's serving-safety finding and remaining foundation defects;
   add only demonstrated incumbent defects to this bucket. No model switch is implied.
3. **Prove:** exact-head tests/reviews plus real selected-engine Start → Stop → final
   transcript → save → reopen; distinguish source, model quality and device evidence.
4. **Release/learn:** after separate authorization, verify the actual served headers,
   runtime/model identity and repeat reliability; preserve rollback and observed gaps.

### 3. Prove current coaching is useful

**Owner/handoff:** coaching engineering and quality → human observation owner (to select)
→ Sam. **State:** #1773/#1792 merged groundwork; real saved-session usefulness NOT PROVEN.

1. **Define:** predeclare groundedness, specificity, actionability, latency and failure
   criteria for Open Mic/full and partial Focus using the current Gemini path.
2. **Close:** evaluate authorized real saved sessions and fix only demonstrated gaps;
   use a bounded successor within this bucket if code is actually needed.
3. **Prove:** bind saved source, generated/persisted/rendered advice and human judgment
   to the same session/model/release; include failure and recovery. Synthetic grounding
   proxies, format checks and prompt parity do not establish useful advice.
4. **Release/learn:** verify the approved deployed coaching path, then observe whether
   customers understand and choose a useful action. Do not claim causal improvement or
   willingness to pay from a served suggestion.

### 4. Close the same-target outcome gap

**Owner/handoff:** queued for Bezos or Elon when free and file ownership is confirmed
→ independent code, security and product review → authorized release operator.
**State:** local preparation preserved and paused; no active implementation assignment.
#1548's generic stored-metric clarification does not close this gap.

1. **Define:** explicitly accepted advice must preserve its source, version, product
   and target through deliberate repeat, saved review and return. A target the product
   cannot measure must be explicitly not comparable.
2. **Close:** deliver durable same-target identity and truthful comparison in one
   coherent product increment. Keep unrelated filler/clarity progress separate; do not
   invent content scoring or infer advice efficacy from it.
3. **Prove:** acceptance versus display, correct target/session linkage, account/product
   isolation, save/recovery/reopen, no-change and not-comparable states, plus applicable
   schema/authorization controls. Human usefulness remains its own evidence.
4. **Release/learn:** after authorized release/schema steps, verify persistence and
   observed customer benefit. Measure accepted action, deliberate repeat, comparable
   result and return separately; completion alone is not improvement.

**Reuse existing association evidence without overstating it.**
[`progress-cross-page.e2e.spec.ts:164`](https://github.com/relativityE/speaksharp/blob/524c325a95874d31239203dce9ef7893331ca756/tests/e2e/progress-cross-page.e2e.spec.ts#L164)
seeds a mocked completed source, its linked repeat and a newer unrelated session, then
checks stored before/after values and the delivery-versus-tip disclosure after reload.
Retain it as an association/readback control, including the wrong-latest-session fault.
It does not create the accepted attempt or execute recording, save and resolution,
and therefore is not full lifecycle, real STT, database, human-usefulness or Production
proof. The bucket 4 increment needs the complete accepted-target lifecycle at the
appropriate layer in addition to this reusable control.

### 5. Execute the automated practice journeys

**Owner/handoff:** Elon selected; receiving checkpoint → security/Code review → Sam → authorized operator.
**State:** all-15 acceptance remains open. Source `655d229b` restores protected-main-only
privileged dispatch. The [owner handoff](https://github.com/relativityE/speaksharp/pull/1788#issuecomment-6746535363)
preserves outstanding disposition and environment-policy work, and the
[fresh Security receipt](https://github.com/relativityE/speaksharp/pull/1788#issuecomment-6746695318)
reports no issues on that head. Code findings, final qualification and the mismatch
between the old candidate-branch closure wording and the restored protected-source
route still need coordinated disposition. No live outcome is established.

**Outstanding source and review carryover:** retain every #1788 commit, both unresolved
review threads and the full 15-case contract. The
[open-reservation recovery P1](https://github.com/relativityE/speaksharp/pull/1788#discussion_r4515733970)
still needs disposition: the new admission check must not make the supported recovery
path unreachable. The protected-source correction and its fresh review remain source
evidence, not operational qualification. The author's linked checkpoint also retains
unpublished recovery work outside the PR; its approved private location remains the
source until the owner supplies a safe receiving patch. Do not discard it, disclose its
contents here, or infer it is already implemented. Keep final-head qualification,
environment-policy decisions, fresh bounded execution authority, actual all-15 results
and settlement as separate open requirements.

1. **Define:** retain all 15 case IDs and closure criteria; identify exact candidate,
   environment, accounts, finite effects budget, grant and execution window.
2. **Close:** finish admission/execution blockers and the security finding without
   weakening protected-source or credential boundaries; separate setup defects from
   product defects and retain prior attempts.
3. **Prove:** qualify the complete intended-release oracle, reconcile the execution
   contract with protected-main-only control code, and only under required authorization
   reach and truthfully record all 15 cases. Review tested and final source identities;
   preserve the restored main-only conditions and qualify the final head.
4. **Release/learn:** after separate landing/release decisions, bind accepted results
   to what is served and route observed product defects to their numbered bucket.
   A shorter pilot check cannot relabel the remaining cases complete.

**Release-bound numeric oracle handoff.** At `655d229b`,
[`progress-numeric.cjs`](https://github.com/relativityE/speaksharp/blob/655d229bf7b3d7dfe450a190775ee48c626cf325/tools/cloud-test/harness/draft-adapters/progress-numeric.cjs)
still requires both source and served SHA to equal
`5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2`; other bindings are refused. Before using a
different intended release, requalify the complete oracle: actual source-file bytes,
AST-selected pure functions, snapshots/provenance and hashes, owner-scoped field
projections, expected attempt/session binding, rendered route/selectors/units/precision,
the AHT-01/02/03 integration and negative controls. A constant-only repin is insufficient.
The [receiving-source record](https://github.com/relativityE/speaksharp/blob/655d229bf7b3d7dfe450a190775ee48c626cf325/tools/cloud-test/harness/draft-adapters/source/receiving-numeric-source.json)
and [offline tests](https://github.com/relativityE/speaksharp/blob/655d229bf7b3d7dfe450a190775ee48c626cf325/tools/cloud-test/harness/draft-adapters/tests/progress-numeric.offline.test.cjs)
are source evidence only. Keep wrong-release, missing evidence and contradictory
identity fail-closed. No current Production result is claimed; this work remains in
bucket 5 with bucket 4 supplying the product contract, not an additional test-gap PR.

### 6. Observe the complete supported-device journey

**Owner/handoff:** existing #1782 owner → named human/device observation owner (to select)
→ Sam. **State:** automated desktop viewport source exists; actual phone/user acceptance open.

1. **Define:** supported device/browser matrix, participant tasks and human observations
   for record → transcript → coaching → repeat → comparison → return.
2. **Close:** finish #1782's 32 saved-review observations and three named user-harm
   controls; fix observed usability/recovery defects rather than a generic UX rewrite.
3. **Prove:** real microphone denial, interrupted recording, failed saves/recovery and
   applicable phone/accessibility checks, alongside unchanged non-gamma coverage.
   Desktop Chromium viewport tests do not establish phone acceptance.
4. **Release/learn:** on the approved release, collect the actual supported-device
   observations and customer friction; preserve unsupported/unobserved cases explicitly.

### 7. Make billing genuinely testable

**Owner/handoff:** #1795 billing implementation → security/billing review → separately
authorized sandbox operator → Sam. **State:** draft source; sandbox journeys NOT RUN.

1. **Define:** reviewed isolated test-mode app/database/provider target, legitimate
   entry path, allowed effects, provider-event identity and safe settlement/cleanup.
2. **Close:** continue #1795 with the isolated entry and billing-specific cleanup;
   preserve production live-key gates and refuse unreviewed targets or credentials.
3. **Prove:** hosted Checkout → paid test invoice → genuine Stripe-delivered webhook
   → correct account access; renewal/failure/recovery and portal cancellation/expiry;
   counted cleanup and retained audit records. No synthetic webhook counts as delivery.
4. **Release/learn:** sandbox PASS is not Production paid proof. Payment activation,
   production lifecycle acceptance and rollback need their own approved release actions;
   reconcile free-pilot applicability with bucket 1 rather than silently waive billing.

### 8. Connect paid access to the same value loop

**Owner/handoff:** billing and same-target owners → quality/human observation owner → Sam.
**State:** #1795 does not prove this extension. The outcome is the same paid identity
through coaching → linked repeat → comparison → return, not generic account lifecycle.
PAID-01 remains open; bucket 9 supplies the required PAID-04 identity/credential controls.

1. **Define:** same paid identity, accepted target and exact release across coaching,
   linked repeat, target-specific comparison and return, with applicable Open Mic/Focus
   entitlement and explicit bounded effects budget separate from the 15-case allowance.
2. **Close:** add the bounded paid-value acceptance increment in the bucket 8 PR only
   after buckets 4 and 7 supply its dependencies. Receive #1795's retained PAID-01
   same-identity value-loop obligation and consume bucket 9's PAID-04 controls without
   duplicating billing or account-lifecycle implementation.
3. **Prove:** link PAID-01 to COACH-01, VALUE-01 and relevant HUM observations for that
   same identity, with bucket 9's PAID-04 evidence for atomic intended credentials,
   verified identity, pre-mutation HOLD, no fallback and truthful mutation reporting. A separate free loop
   plus a paid recording, or a test-mode transaction, cannot substitute.
4. **Release/learn:** before charging customers, verify the approved paid journey and
   access/return behavior. Assess useful repeat use and perceived value rather than
   declaring commercial success from entitlement activation.

### 9. Close account, privacy and credential gaps

**Owner/handoff:** #1770/#1775 existing owners → security review → Sam → separately
authorized operations owner. **State:** source increments open; broader controls unproven.

1. **Define:** applicable account isolation, disclosure/consent, deletion, recovery,
   credential and stress-workflow account-recreation controls for the selected release.
   This bucket owns PAID-04's atomic intended credential pair, verified identity,
   pre-mutation HOLD for missing/partial/ambiguous inputs, no credential/signup fallback
   and truthful post-write mutation reporting; bucket 8 consumes that evidence.
2. **Close:** reconcile #1770/#1775's shared workflow and current source; add a focused
   verified missing control only within this bucket. No parallel writer on shared files.
3. **Prove:** exact-head positive/negative controls and authorized runtime evidence for
   the applicable isolation, consent, safe recovery/deletion and credential consumers.
   Source environment bindings alone do not remove repository-secret fallback.
4. **Release/learn:** separately authorize credential provisioning/removal, permission,
   schema or account operations; verify effective boundaries and safe rollback before
   exposing the pilot. Keep unresolved customer-exit/global-drain requirements open.

### 10. Assemble and operate one release

**Owner/handoff:** Sam integrates accepted evidence; Product Owner authorizes release;
named release operator and observation owner execute. **State:** release HOLD; #1774's
monitoring groundwork is integrated source, not an active nightly service.

**Source disposition verified 10 November 2026:** #1774 head
`54c674ace88f2e22acd1c01a9a5ec2cf533193f2` is an ancestor of #1772 final head
`1662b08628fefbefc18f2cf63abffdf6a32e8fe9`. That final head and merged squash
`5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2` share complete tree
`a2dfb8eed17b0af867b0bb5d6fd0ab4292ede89c`; main contains the squash. No unique
unlanded source remains. #1774 was administratively closed unmerged and its obsolete
branch deleted. A new implementation receiver is not required. Retain its review
finding provenance and landed corrections; do not merge or restore its stale tree.

**Operational acceptance remains OPEN:** identified-release proof through the approved
execution route; explicit activation and credential gates for selected operations;
Case 10 origin/schedule authority if selected; rollback; clean traffic/release baseline;
raw-to-dashboard reconciliation; alert fire/recovery; received telemetry assurance;
and broader token-cost rows. Retaining these obligations does not mandate a parallel
smoke harness or revive an obsolete nightly schedule.

1. **Define:** one release manifest with exact frontend/backend/schema/configuration,
   accepted evidence, open-risk decisions, owner and rollback; select learning measures.
2. **Close:** retain #1774's integrated-source disposition and finish the outstanding
   operational obligations; assemble the smallest complete approved release without
   adding unrelated lanes.
3. **Prove:** final-head qualification, actual served identities and applicable evidence
   from buckets 1–9; verify rollback readiness and truthful monitoring/report boundaries.
4. **Release/learn:** only after separate authorization, deploy/verify, start the approved
   pilot and measure first useful session, accepted action, deliberate second session,
   comparable target result and return. Activate payment or recurring monitoring only
   after its own acceptance and permission. Record what customers found worth paying for.

### Decisions and preserved boundaries

The immediate source sequence is: acceptance-map consolidation; critical safety and
same-target product work; qualified journeys and device/quality evidence; then one
authorized release. Billing preparation may proceed with disjoint ownership. Release
date, pilot scope, observation owners and real-quality results are not yet established.

This update does not change the machine-readable currency block or its paired ROADMAP
baseline, historical served identities, pinned artifacts, acceptance results, model
selection or operational grants. It grants no merge, deployment, schema application,
credential/permission change, live test, spending, payment activation or tester invitation.

## 5 November 2026 source reconciliation and R10 hold

**HOLD.** This bounded source review supersedes the earlier current-source and active-run
statements below. It does not supersede dated deployment receipts, rewrite historical
test outcomes, or establish customer acceptance. The [verified comparison](https://github.com/relativityE/speaksharp/compare/4c85b006ac05e180521fd6e7d807f736987cafe8...8f9f9451bb6bf37ba2bca524acd92d933e2b826c)
contains 26 commits after the previous currency baseline. The unchanged currency guard
allows at most 25; advancing the paired baseline is the result of this reconciliation,
not a waiver of the guard.

| Identity | Recorded value | Evidence boundary |
|---|---|---|
| Repository `main` reconciled source baseline (12 November 2026) | `b9907d625e6d5b9810050f556d62904baa62982c` | Exact source through #1830, read from GitHub. Source ancestry does not establish deployment or acceptance. Re-read moving main before operational action. |
| Repository `main` reconciled source baseline (dated 5 November 2026) | `8f9f9451bb6bf37ba2bca524acd92d933e2b826c` | History: exact source through #1785. |
| Production served frontend `__APP_RELEASE__ =` (observed 12 November 2026) | `d401349bca036be1f5413fa50faba536fba3ed51` | Read directly from Production on 2026-11-12 after Edge release run 43157953329 and frontend release run 43158275628 (both success). A served marker, not end-to-end acceptance. Unrelated to R5, which ran on `4c85b006` (28 October receipt below). |

### Merged source in the reconciled interval

Each entry below is a merged-source checkpoint, not a declaration that its broader
parent issue, deployment or live acceptance is complete.

- [8a79eafa](https://github.com/relativityE/speaksharp/commit/8a79eafa23bd3beeee6d087270acd9ed5a16eb1e): test(#1610): prove edited-take retention on the current native chain (#1752).
- [1f9f2232](https://github.com/relativityE/speaksharp/commit/1f9f2232d90334fefbc5107c520ba797e00ab215): fix(review): bind documentation evidence scope to reviewed postimages (#1753).
- [b80657dd](https://github.com/relativityE/speaksharp/commit/b80657dd40d87895d61a8aaf52bb9f63bb784443): docs: reconcile canonical release contracts and retained evidence (#1674).
- [30caac31](https://github.com/relativityE/speaksharp/commit/30caac31a2b447d8bb55dd8e92fd7b4064f8eb96): ci(retention): prove the current owner contract on PostgreSQL 15–17 (#1755).
- [2ea69d8e](https://github.com/relativityE/speaksharp/commit/2ea69d8e4b7521d24b75febd65c5020ab22d60ed): fix(review): qualify the reviewed financial artifact receiver (#1754).
- [a71cb1d1](https://github.com/relativityE/speaksharp/commit/a71cb1d17bb2259e1fcbf643f1db5df6d99a9b66): fix(qualification): pin portable finance archive provenance (#1756).
- [556bd636](https://github.com/relativityE/speaksharp/commit/556bd6368596427e57c19f1da6e4041062e6f55f): docs(finance): include coding subscriptions and explain pricing scenarios (#1318) (#1599).
- [a297ce3a](https://github.com/relativityE/speaksharp/commit/a297ce3a8f411c45c741d721bec177b41b2bd311): fix(diagnostics): fail closed on incomplete worker evidence (#1757).
- [2c661f7f](https://github.com/relativityE/speaksharp/commit/2c661f7f0c528092883bc7a2901672277f4c6b75): fix(ci): preserve unit failures and bound full-suite runtime (#1758).
- [66328703](https://github.com/relativityE/speaksharp/commit/66328703bf47e865b730e229005411e78481d34c): fix(telemetry): bind setup failures to the accepted recording attempt (#1759).
- [2cd8c3ca](https://github.com/relativityE/speaksharp/commit/2cd8c3ca28f6d8db52c9c1f1b262238e13fe6cb3): ci(cloud-test): register the Cloud test control-plane workflow (dispatch-only, secret-free) (#1764).
- [749b76f3](https://github.com/relativityE/speaksharp/commit/749b76f399ee190084b9c611f49fea2b7bc77c25): ci(evidence): bounded batched execution + cloud-test package routing (#1762).
- [50ae485c](https://github.com/relativityE/speaksharp/commit/50ae485ca7ab9c422e6793c63e807b39503f6a7e): fix(test-accounts): read the throwaway email from its repository Variable (#1766).
- [ac5272dc](https://github.com/relativityE/speaksharp/commit/ac5272dc23a4ed4fa134973016523f67a6f82e8b): fix(goals): update the existing owner row on repeat save (#1767).
- [cadf4dfb](https://github.com/relativityE/speaksharp/commit/cadf4dfb6db5b614551d50d17e09a71aa826cfa7): feat(testing): report bound stack receipts without false-green readiness (#1761).
- [188aa034](https://github.com/relativityE/speaksharp/commit/188aa0346e69b476870eb4e95293b3ce557dc5e2): fix(ci): admit reviewed 1763 workflow transition (#1769).
- [8969998d](https://github.com/relativityE/speaksharp/commit/8969998d27b4dd891c84243b35869be726639900): fix(transcription): retain PCM boundary receipts for R5 diagnosis (#1771).
- [9e42700a](https://github.com/relativityE/speaksharp/commit/9e42700a7f06e9f41b19749d7a09eb920a0ae18f): feat(cloud-test): receive the 15-journey runner and explicit offline inputs (#1763).
- [c32319f9](https://github.com/relativityE/speaksharp/commit/c32319f9121d4fef64dc48bb40fae5464dc6b65a): Draft: LLM updater — drop-in coaching provider/model (descriptors + adapter families) (#1773).
- [5a7bf6a1](https://github.com/relativityE/speaksharp/commit/5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2): fix(cloud-test): consolidate R5 live-case remediations (#1772).
- [c6badcef](https://github.com/relativityE/speaksharp/commit/c6badcef6545a5461fc1a90255c880868aeff0e7): fix(cloud-test): bind R10 release lineage (#1779).
- [3b040043](https://github.com/relativityE/speaksharp/commit/3b040043372f47f720fcd382bdc30b90bdf67e47): test(edge): pin diagnostic IDs in leak assertion (#1780).
- [c1cc791a](https://github.com/relativityE/speaksharp/commit/c1cc791a731162879e5f7955408e7ac397d9f42c): test(cloud): bind R10 all-15 live request (#1781).
- [b9d4bc05](https://github.com/relativityE/speaksharp/commit/b9d4bc05eb3c69447fdd96acc1f0eaeb5f14f64d): test(cloud): renew one-off R10 authority window (#1783).
- [af1781ba](https://github.com/relativityE/speaksharp/commit/af1781ba6e07524c82dea3a66a1b7cb772c14e51): fix(cloud-test): R10 record-job PR permission and a deadline-bound first-use prerequisite preflight (#1784).
- [8f9f9451](https://github.com/relativityE/speaksharp/commit/8f9f9451bb6bf37ba2bca524acd92d933e2b826c): fix(cloud-test): R10 token compatibility and exact failed-run recovery (short-lived) (#1785).

The interval includes frontend goal-save, recording-failure and PCM-diagnostic changes,
coaching provider/adapter source, current-contract retention tests, documentation/finance
receiving, and CI/evidence qualification changes. It also introduces the Cloud Test
control plane and R10 runner, then corrects release binding, occurrence authority,
record permissions, first-use prerequisites and token/never-reserved recovery.
These are different evidence classes: source instrumentation is not a measured live result,
synthetic qualification is not product acceptance, and a retained finance model is not
validated pricing or authorization to spend.

### R10 outcome and remaining work

[Run 41960376782](https://github.com/relativityE/speaksharp/actions/runs/41960376782)
on this source passed record recovery and reservation, then failed at the offline-check
step before the credential-bearing preflight and journeys. The [retained result](https://github.com/relativityE/speaksharp/pull/1783#issuecomment-6648866365)
is **0 PASS / 0 FAIL / 15 NOT RUN**, not a successful baseline. Its reservation remains
open and counted at `0909b53ff6dc767105633ddc14db520c762dff64`; a green settle job
did not establish settlement because no settle input existed. Reserved caps are not
measured usage. The reported live-job time is six runner minutes; zero product usage
is the setup-failure evidence claim to validate in the recovery, not permission to
erase the reservation or history.

[#1778](https://github.com/relativityE/speaksharp/pull/1778) is the existing integration
vehicle for the namespace/setup and recovery corrections, with unpublished work and
exact-head review tracked in its owning thread. Its source changes do not yet establish
a hosted fix, settlement or a new R10 result. No additional run, namespace-setting
change taking effect, merge, deployment or nightly activation is authorized by this
documentation update. The existing grant endpoint is 2026-11-05T18:00:00Z; it is not
a grant of another attempt.

The committed R10 request selects frontend `5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2`
and backend source `c32319f9121d4fef64dc48bb40fae5464dc6b65a`, with its recorded
source-equivalence receipt. These are request bindings, not fresh served readbacks.
The older `deployed-release` / `verified-on` machine fields and dated frontend/Edge
receipts below remain historical observations; this source-only reconciliation does
not promote a request target into observed Production identity. Obtain fresh
occurrence-bound identities before any separately authorized live action.
All unexecuted journey, human/device, customer-exit and other retained acceptance
gaps remain open. The fixed #1650 integration baseline and all lane/blocker fields
are unchanged.

## 28 October 2026 post-R5 receiving addendum

**HOLD — documentation receipt, not a new live verification.** This addendum supersedes
older current-tense deployment and queue statements below. GitHub source was read at
`4c85b006ac05e180521fd6e7d807f736987cafe8`; the earlier observations remain dated history.

| Identity | Recorded value | Evidence boundary |
|---|---|---|
| Repository `main` currency-comparison baseline (fixed) | `4c85b006ac05e180521fd6e7d807f736987cafe8` | Matches the currency block below; a fixed comparison base, not an assertion that the moving branch still points here. |
| Latest observed GitHub main during receiving | `8a79eafa23bd3beeee6d087270acd9ed5a16eb1e` | Source-only #1752 landing; no product deployment or customer acceptance inferred. Re-read before the next operational action. |
| R5 served frontend release (28 October receipt; R5 ran on this) | `4c85b006ac05e180521fd6e7d807f736987cafe8` | Sam's frontend release/readback receipt below, before R5; no fresh Production read by this documentation task. Later observations (12 November `d401349b`) are recorded separately above and do not change this R5 binding. |

Sam's release handoff reports frontend and backend on that source, from backend
[40674315502](https://github.com/relativityE/speaksharp/actions/runs/40674315502) and frontend
[40675011692](https://github.com/relativityE/speaksharp/actions/runs/40675011692), before R5.
Sam separately verified generation 6, account completion OFF and migration 129 absent.
No deployment since R5 is reported in that handoff. These are attributed release observations,
not a new production read or proof of account completion by this documentation task.

### R5 results and reviewed interpretation

The Library `R5-REPORT.html` and `R5-SUMMARY.txt` retain the original results on the
R5 served baseline `4c85b006ac05e180521fd6e7d807f736987cafe8` (the 28 October receipt above, not the 12 November observation). Their denominators must not be added together:

| Inventory | PASS | FAIL | NOT RUN | Total |
|---|---:|---:|---:|---:|
| Stable requirements | 1 | 2 | 148 | 151 |
| Journeys | 1 | 2 | 12 | 15 |
| Assertions (Sam's export audit) | 90 | 2 | 112 | 204 |

The twelve incomplete journeys are three planned-depth cases (05/06/09), two
reader-blocked cases (07/08), two allowance-interrupted cases (10/11), and five cases
without established core signals (01/04/12/13/14). Six human/device and three
accessibility records remain unexecuted. Original failures are retained, not rewritten.

Sam's later audit qualifies two analyst interpretations:

- AHT-02/03's marker oracle incorrectly requires more than one distinct index.
  At this source, `frontend/src/utils/focusCoverage.ts:228–236` chooses the first
  `!covered` row. Sam's trace review found the first two points pending while later
  points changed, so `nextIndex=0` is consistent with that selector. This neither
  establishes a product failure nor upgrades either original FAIL to PASS.
  Opening-phrase detection remains unresolved.
- The coaching 502 / 30,039 ms appears in the analyst narrative; the raw request
  receipt was not recovered in Sam's audit. Root cause is unverified. The current
  low-thinking source is not evidence of a cure, and no timeout/provider fix is selected.

Sam reports verification of all 235 evidence hashes, 15 summary digests, 75 CODE hashes
and 32 frontend identity MATCHes for r13 harness SHA256
`791847bfbb040811ed85d6bf328216d76b704fee3e156123d24e8e9bad1bffc9`.
Last cleanup was 12:21:25.126Z, before the 13:43 hard stop, with no owned processes or
errors in summaries. This specialist read the report but could not materialize
`R5-FINAL-REPORT.zip`; the hash audit is attributed to Sam, not independently repeated.
The expected ZIP SHA256 is
`e9dc79aef61032bc4e0a301b2456a4a6445a3265a3c335fff2b3a99a8c30a6bf`.

Exports reconcile 2,085 run requests, 14 Starts, nine takes and 32 identity reads.
The cumulative 5,529 is conservative accounting from assumed prior 3,406 + 2,085 + 32
+ six reported account probes, not an exact audited historical total. Identity use
94/98 leaves four. No new live window, counter reset or budget increase is authorized.

### Remaining source and acceptance boundaries

- [#1752](https://github.com/relativityE/speaksharp/pull/1752) merged at
  14:56:33 UTC on 28 October, verified by GitHub's pull-request readback:
  `8a79eafa23bd3beeee6d087270acd9ed5a16eb1e`, from head
  `4564ab172660dc09289b5c4356aa21f459ea5a38`. This repository-only tooling landing
  does not change the served `4c85` product baseline.
  Native [40701123752](https://github.com/relativityE/speaksharp/actions/runs/40701123752)
  completed SUCCESS; CI [40701123759](https://github.com/relativityE/speaksharp/actions/runs/40701123759)
  completed FAILURE. Sam's audit attributes the latter to missing exact-head review
  qualification, not engineering failure. The subsequent PR receipt records
  independent Code/Security qualification PASS and trusted qualification run
  [40706864771](https://github.com/relativityE/speaksharp/actions/runs/40706864771)
  SUCCESS; the original CI failure remains historical evidence.
  The native artifact is 12820988420, SHA256
  `72bd40782bf60ce72555f8a7eb1facb8ff81efa7bffb2e260a8d8972cb4c3d4e`.
  It is current-chain authenticated-actor/lock/edit-retention/cleanup evidence, not
  Production or PostgreSQL 15/16 matrix proof. #1610's matrix and bootstrap obligations
  remain open; no branch or historical proof is replaced by this note.
- Jensen owns #1488's bounded privacy-observer implementation. No privacy PASS, merge
  or deployment is established by that assignment.
- The [33-group receiving register](https://github.com/relativityE/speaksharp/pull/1674#issuecomment-6460190223)
  and its [nine-wrapper](https://github.com/relativityE/speaksharp/pull/1674#issuecomment-6459908560)
  and [four-wrapper](https://github.com/relativityE/speaksharp/pull/1674#issuecomment-6459850817)
  transfers remain acceptance obligations. Administrative closure, source credit and
  incomplete journeys do not establish completed requirements. Keep paid journeys,
  human/device/accessibility, feedback storage/association, lease/privacy/account,
  and all unproven residuals open.
- Historical executed R4C and R0/R1/R2 originals remain unavailable. Sam owns recovery
  and explicit unavailable-evidence disposition. Historical tag chronology also needs
  Sam's explicit administrative disposition; no tag deletion or rename is selected.
- The documentation link audit on 28 October could not retrieve twelve historical
  workflow runs linked below or by retained evidence (GitHub returned 404). Those links
  preserve their original identifiers; they are not newly verified receipts. The accepted
  #1588 files remain hash-bound despite run 38104864048 being unavailable. Sam owns
  recovery or explicit unavailable-evidence disposition; no original result is upgraded.

### Owner gate before another Cloud run

The post-merge main CI run [40710933078](https://github.com/relativityE/speaksharp/actions/runs/40710933078)
is completed/success at `8a79eafa23bd3beeee6d087270acd9ed5a16eb1e` in the GitHub readback;
Sam reports all required gates passed. This does not change the served `4c85` product.
The later R5/r14 report remains under independent review. A newly supplied R4C addendum
distinguishes campaign R4 from true campaign 3-R4C; until the correct originals and
identities are bound, overlay labels do not establish a baseline regression. No original
R5 outcome is rewritten by this attributed update.

All documentation must be complete and all PRs, including successors, must be landed
or explicitly dispositioned without losing requirements before another Cloud GO.
At the 28 October GitHub readback after #1752 landed, four PRs remained open:
#1674, #1599, #1610 and #1488. This is a dated queue count, not authorization to close
them. Jensen receives the remaining non-documentation requirements with their original
IDs, evidence, acceptance controls, next actions and dependencies. Cloud retains separate
harness ownership. Documentation completion, PR merge eligibility and product acceptance
are separate decisions; no new run, spending or deployment is authorized here.

### PR-associated documentation and closure receiving

This is the 28 October documentation receiving map. The original PR heads and their
reported tests are dated evidence, not qualification of Jensen's current prototypes.
The documentation checkpoint `faf5a543` is preserved. No successor PR number or
publication route has been selected for its changes.

| PR / receiving lane | Documentation changes and evidence boundary | Preserved obligation and closure action |
|---|---|---|
| [#1488](https://github.com/relativityE/speaksharp/pull/1488) privacy observer | This addendum and ROADMAP retain Jensen's bounded ownership; QUALITY's boundary-debugging controls and OPERATIONS_AND_SECURITY's canary scope separate observer assertions from deployed evidence. The old PR body reports 55/55 focused tests and quality exit 0 for a historical tree; those results do not qualify the current prototype. | Preserve exact started/saved take identity, authoritative attribution, the pre-Start through saved-terminal observation window, worker/late-event settlement, fail-closed unsupported/opaque transport controls and content-free receipts. A prototype or offline classifier pass is not native execution, a live take or privacy PASS. Jensen supplies the exact successor and its actual evidence; Sam reviews each residual and selects landing/supersession. Retain unresolved review casualties and the finite-observer/covert-encoding limit rather than closing them by association. |
| [#1610](https://github.com/relativityE/speaksharp/pull/1610) edited-take retention | This addendum distinguishes landed #1752 native proof from the original PostgreSQL matrix; ARCHITECTURE's completion/retention and database-proof sections preserve the acceptance boundaries. The original body reports matrix 38433654685 on PostgreSQL 15/16/17 and separate 40 wiring tests; these belong to its old source. | #1752's authenticated actors, observed lock, edited marker, retention and cleanup receipt do not close the full current-version matrix/bootstrap requirements. Preserve unique throwaway-database cleanup, NOSUPERUSER function ownership, database-scoped wait observation, fail-closed pipe handling, edited row-version interleavings and deferred trigger/dependency-surface P2 r4262556505. Jensen maps each residual to a reviewed receiving implementation or explicit deferral; Sam may then disposition the original PR. No offline result substitutes for native/live obligations or proves Production. |
| [#1599](https://github.com/relativityE/speaksharp/pull/1599) finance | ROADMAP directs readers to the existing planning candidate. Proposed review-note and PR-body corrections are prepared locally for that owner's branch, including pinned low thinking, nullable diagnostic usage, three-attempt ceiling and distinct October 18/21 receipts. Workbook bytes and accepted formula correction remain untouched. | Preserve unmeasured cost/demand assumptions and unavailable original October 21 raw receipts; reported LibreOffice controls are historical, not a new recalculation or Excel proof. Sam selects the prose publication route and reviews the exact resulting diff/evidence before finance PR disposition. No successor is automatically necessary and no formula repair is repeated. |
| [#1674](https://github.com/relativityE/speaksharp/pull/1674) documentation receiver | RELEASE_PROCESS and OPERATIONS_AND_SECURITY separate ordinary CI/full-evidence qualification from default-OFF proof; all 14 canonical documents are accounted for, 43 substantive receiving sections are drafted, and the evidence index binds the 50 consolidated sources. The handback retains exact clause/source hashes, negative controls, 151 requirements and 33 finding groups. | Sam reviews r4348541064/r4348541054 individually and selects the existing PR or a successor carrier. Required repository checks remain outstanding in a supported pinned-pnpm environment. Jensen must migrate protected readers before any selected source removal. Preserve all missing historical inputs and unresolved acceptance obligations; closing transferred wrappers or this documentation PR does not mark them complete. |

A documentation successor, if selected, must name #1674 as its receiving predecessor,
carry the complete reviewed patch and requirement/evidence mapping, and obtain its own
exact-head checks and independent review. Its creation would add an open PR until it
lands; it does not itself close #1674. The same rule applies to any #1488 or #1610
successor: explicit residual transfer first, reviewed landing and administrative
supersession afterward. #1752 is already a landed bounded successor, not an omnibus
closure. The owner gate above continues to cover every such carrier.

## 19 October 2026 bounded source/coordination addendum (historical)

This addendum supersedes earlier present-tense queue and model-phase instructions, while retaining every historical outcome. GitHub main was independently read as c9d46b2d4ffef7530cb0cccaa533b5818d200320;24issues and11PRs were open in this reconciliation. App/CLI/Browser PM have personally acknowledged their assigned queues. The [35-item directive](https://app.slack.com/archives/C0C9RE8KNHG/p1792432639622239) and [current coordinator](https://github.com/relativityE/speaksharp/issues/1593) own later moving dispositions; these counts/pins are dated, not evergreen assignments.

The exact main commit's Vercel status was FAILURE at2026-10-19T14:20:06Z: “Deployment rate limited — retry in24hours.” This status text is not a promised recovery time. No fresh served frontend SHA or new production canary was observed by this documentation correction. Source-main identity is not served identity. Full useful Open Mic/Focus, received telemetry and human/device acceptance remain HOLD/unexecuted where not evidenced.

The1662/1666/1667/1668 release queue and case10 correction remain separate qualification/integration boundaries. Copy1254's current receiver aac368a7 is source-accepted; Analytics1472's receiver ee9c9c42 has independently executed64-control client/PGlite parity evidence, not hosted migration/application or deployed proof. Neither patch is claimed shipped. Canonical-target continuity1548 and customer-exit1643 remain open beyond narrow landed1636 labels and1611 backend staging.

Routine account deletion follows [PO policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298): durable pending for the verified confirmed account, no new admission, settlement of accepted saves/coaching/billing, then verified DB/storage/Auth final state. Other users continue; global shutdown/termination is not the routine contract. Historical global-drain claims below do not override this policy. Existing operational configuration/legacy-cutover guards remain until a reviewed successor replaces them.202 pending and timeout are not deleted; cancellation remains distinct. No migration, runtime/provider/account mutation or activation is authorized here.

## Disposition

**HOLD — full useful Open Mic/Focus RWT and complete customer/MVP acceptance remain unfinished.**
Source acceptance, local tests, CI qualification, merge, deployment identity, migration application, live proof and human acceptance are distinct evidence classes. None substitutes for another. This snapshot grants no operational authority.

| Identity | Recorded value | Evidence boundary |
|---|---|---|
| **Repository `main` reconciled source baseline (dated 28 October 2026)** | `250cffcc5b134bdb14682b52461114a4794c03f3`, verified remote main after #1749 | The 26-commit range `d6be063f..250cffcc` is merged source. #1749's exact candidate passed native/engineering/review qualification; main run [40634248412](https://github.com/relativityE/speaksharp/actions/runs/40634248412) then failed the unchanged documentation-currency guard. No backend release or customer acceptance follows from the merge. The fixed #1650 integration base below is unchanged. |
| **Repository `main` integration / qualification baseline (fixed)** | `5f5f465a93a5c582ca0f2553a0781ecb5eb9dfbf`, the reviewed integration base after #1650 | [Sam's bounded identity-label disposition](https://github.com/relativityE/speaksharp/pull/1648#issuecomment-6242262333). This records the base integrated into #1648, not an evergreen branch-pointer or deployed-release claim; re-read moving identities before operational decisions. |
| **Deployed product release (dated 28 October 2026 observation)** | `__APP_RELEASE__ = a4dc9b70afddf6f601b8791a3077785a72d7f577`, frontend release [40627177619](https://github.com/relativityE/speaksharp/actions/runs/40627177619), [served receipt 12789587973](https://github.com/relativityE/speaksharp/actions/runs/40627177619/artifacts/12789587973) and independent canonical readback at 03:35:47 UTC | Frontend identity only. Backend still has source `492c128f5191df15bda99baa4f5bd77defac5593`; #1740 is not backend-deployed. This supersedes the dated `613a026e` frontend observation retained below, not the unfinished full RWT/human acceptance. |
| **Canary** | [39066400126](https://github.com/relativityE/speaksharp/actions/runs/39066400126), SUCCESS; active-trial product lane passed | [Post-merge receipt](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240476368) confirms runtime migration readiness and product execution after 118/119. This replaces the earlier migration HOLD, not the full two-product RWT requirement. |
| **Release line** | `v0.9.0-rc`; package version remains `0.9.0-rc0` | This is not a selected new tag or permission to tag. Any release-tag choice remains a separate disposition. |
| **Documentation scope** | First bounded #1318 current-state correction: this file and `ROADMAP.md` | [Sam's assignment](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6234300137). This is not final reconciliation of all 14 canonical documents or closure of #1318. |

### Component/source reconciliation `d6be063f` → `250cffcc` — 28 October 2026

This bounded correction records existing receipts; it does not deploy, apply migrations,
change permissions, invoke a provider or run customer journeys. Historical snapshots below
remain dated evidence. Source delivery, qualified source, deployed components and independent
customer acceptance are separate.

- **Source:** local complete history and the remote main read agree on the 26 first-parent
  merges from `d6be063f` through `250cffcc`. #1749 is merged after the protected guard;
  [candidate CI 40632705524](https://github.com/relativityE/speaksharp/actions/runs/40632705524)
  and [native proof 40632705525](https://github.com/relativityE/speaksharp/actions/runs/40632705525)
  passed on `716b06fc`, whose tree equals the merge tree. Native evidence includes historical
  states 0–6 and separate post-127/128 catalogs, drift refusals, rollback restoration and
  cleanup. It is disposable-database proof, not Production execution.
- **Frontend:** release `a4dc9b70` is served. It includes #1743's truthful account-scoped
  Goals state, #1744's wrapped microphone-denial guidance and #1745's default-off completion
  caller. These are deployed source facts, not new Cloud PASS results or completed account exit.
- **Backend:** source remains `492c128f`. The selected #1740 backend attempt
  [40623613966](https://github.com/relativityE/speaksharp/actions/runs/40623613966)
  failed its read-only prerequisite before authority invalidation or any upload.
  Account-closure remains version 3, bundle SHA256
  `34639d8bd39e461853f10d629b664671320180005da023d1818b2c5b4ce08523`.
  Sam's [04:41:08 UTC read-only check](https://app.slack.com/archives/C0C9RE8KNHG/p1793162508359209)
  confirms the unchanged component/schema state. No new backend success is claimed.
- **Schema/configuration:** migrations 127/128 are installed; 129 and the Goals privilege
  correction are not applied. Completion is OFF, generation is 4, and scope/binding remain
  unbound. Source staging does not authorize activation, restore privileges or prove deletion.
  The intended privilege policy remains a separate question from the corrected fixture setup.
- **Next release:** main CI failed the currency assertion at 26 commits behind its limit of
  25. This two-file currentization preserves that test/threshold. A newly qualified actual
  main and immediate operational checks are required before the separately selected backend
  retry. #1747's native-evidence tooling and #1742's coaching candidate are not landed or
  deployed by association. Low thinking has no live improvement proof.
- **Acceptance:** the final component-bound Cloud campaign remains unexecuted for this
  combined release. Keep all 15 journeys, six human/device observations and 151 traceable
  requirements distinct; a deployment, native proof or local green suite closes none of them.

### Mainline reconciliation `1c293255` → `d6be063f` — 26 October 2026 (App Dev, read-only)

Twenty-six commits follow `1c293255` in `1c293255..d6be063f`, all first-parent squash merges, ending at #1725 (`d6be063f`); the guard counts every commit in that range. Main CI on `d6be063f` ([40351467447](https://github.com/relativityE/speaksharp/actions/runs/40351467447)) failed only this file's currency guard, at 26 commits behind against its limit of 25. The limit is unchanged. Source, qualification and deployment are recorded separately below; none of them is RWT, human or customer acceptance.

**Source (merged to `main`):**
- Frontend source (`frontend/src`): #1687, #1707, #1699, #1711, #1716, #1718, #1719, #1722, and #1702 (telemetry schema module plus checks).
- Backend source: #1696 (migration `20261024083000_account_coaching_unknown_fence_1643.sql`) and #1714 (migration `20261025021046_content_free_retention_evidence.sql`).
- #1687 bounds ProfileGuard provisioning retries across identity changes (source; frontend-released with `fb30674e`).
- #1707 receives #1683's reviewed account-deletion page byte-identically and routes it at `/account/delete` outside ProfileGuard. It adds the Account page's "Delete account" link and scrubs the emailed deletion token before router, Sentry or PostHog start (source; frontend-released with `d1a58f88`). This supersedes the 23 October text that UI #1683 is "inactive and unrouted". Entry and navigation are source facts only; completed account deletion and customer exit remain unproven and open.
- Backend migration files and the DB proof workflow (#1696, #1714) are source delivery, not applied-database evidence. #1705's offline account-closure context tooling and #1702's telemetry readback/qualifier checks do not establish live acceptance.
- Docs, test, harness and evidence tooling only: #1688, #1690, #1691, #1692, #1693, #1694, #1695, #1703, #1705, #1709, #1689, #1721, #1720, #1685, #1725.

**Qualification (push `ci.yml` on each first-parent `main` SHA):**
- SUCCESS on 23 of 26.
- FAILURE on `79fcd5b5` (#1695, [40052992791](https://github.com/relativityE/speaksharp/actions/runs/40052992791)), `4527e119` (#1702, [40330157809](https://github.com/relativityE/speaksharp/actions/runs/40330157809)) and `d6be063f` (this guard).
- The next main SHA after each of the first two failures passed. A green main run is per-SHA source evidence, not release-gate or acceptance evidence.

**Deployed (`production-release.yml`; frontend unless stated):**
- [40059856307](https://github.com/relativityE/speaksharp/actions/runs/40059856307): Edge release of `fb30674e`.
- Frontend releases:
  - `fb30674e`: [40060391056](https://github.com/relativityE/speaksharp/actions/runs/40060391056)
  - `19aed5d7`: [40106664206](https://github.com/relativityE/speaksharp/actions/runs/40106664206)
  - `d1a58f88`: [40214197134](https://github.com/relativityE/speaksharp/actions/runs/40214197134)
  - `d9a55454`: [40225077581](https://github.com/relativityE/speaksharp/actions/runs/40225077581)
  - `9de26334`: [40227951041](https://github.com/relativityE/speaksharp/actions/runs/40227951041)
  - `266bd9b2`: [40232725339](https://github.com/relativityE/speaksharp/actions/runs/40232725339)
  - `2c4f5f39`: [40251982861](https://github.com/relativityE/speaksharp/actions/runs/40251982861)
  - `d1f0acde`: [40319113835](https://github.com/relativityE/speaksharp/actions/runs/40319113835)
  - `9c648649`: [40325029007](https://github.com/relativityE/speaksharp/actions/runs/40325029007)
  - `613a026e`: [40340909599](https://github.com/relativityE/speaksharp/actions/runs/40340909599)
- All of these runs succeeded.
- The latest release, `613a026eb8ec819c326043ebf68e03f388b6400a`, was read back by App Dev as `window.__APP_RELEASE__` at 2026-10-26 14:37:01 UTC.
- `c8623640`, `94a5c7c0` and `d6be063f` (#1720, #1685, #1725: test and tooling only) are not released.
- Production application of the #1696 and #1714 migrations is UNVERIFIED in this addendum.

**Documented correction:** the `deployed-release` field moves from the historical `bc1ea8ea` (17 October observation, still named in the earlier dated text below) to the verified `613a026e`, and `verified-on` becomes 2026-10-26.

**Unchanged and still open:** the `release-blocker`, the fixed #1650 integration base, and every unresolved acceptance gap: RWT L1–L15, human H1–H6, account-exit completion, and production schema/Edge verification.

### Mainline source reconciliation `5f5f465a` → `1c293255` — 23 October 2026 (App Dev, read-only)

The 19 October addendum above read main at `c9d46b2d`. Twelve first-parent merges followed: frontend runtime #1671, #1677, #1675, #1679, #1681; backend #1675 (two migrations) and #1684 (Edge functions and four migrations); #1673, which disabled push-triggered Edge deployment (the `deploy-supabase-edge-release.yml` caller's job is `if: ${{ false }}`) and introduced the manually dispatched `production-release.yml`; test/tooling #1672, #1676, #1678, #1680, #1686. Dated supersessions of the 19 October text, which stays as history:

- #1662, #1666, #1667 and #1668 closed unmerged on 22 October; [#1671](https://github.com/relativityE/speaksharp/pull/1671) integrated their reviewed heads and #1254's `aac368a7` copy.
- #1472's analytics change landed as source in #1675. #1548 continuity (#1681) landed as source. #1684 delivered #1643 backend source wiring completion-status read/issue/ACK, not completion execution: `completePendingAccount` stays inactive, `accountClosureCurrentFacts.mjs` still fails closed, so the [producer boundary](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6247490788) stands, and UI #1683 was then inactive and unrouted (superseded 26 October: #1707 routes it; see the 26 October addendum). Customer exit is not complete; both issues remain open.
- Served identity: App Dev's HTTP read of `window.__APP_RELEASE__` on the canonical app returned `29d7c7e54e5a58acacfaf405c469aacc796eee8d` (#1677) at 2026-10-23 03:13–04:20 UTC. That is an App-reported observation, not deployment or canary acceptance, and no deployment receipt is recorded here. #1675, #1679 and #1681 are later mainline commits than `29d7c7e5`. `deployed-release` and `verified-on` stay unchanged pending the owner's decision.
- Effective runtime and schema state is UNVERIFIED for #1675's and #1684's migrations and #1684's Edge functions. Skipped Edge run [39893612755](https://github.com/relativityE/speaksharp/actions/runs/39893612755) shows only that that run did not deploy.
- Edge release route: since #1673, an Edge-path merge to `main` does not deploy production. The selected deliberate frontend/Edge promotion route is a separately authorized manual dispatch of `production-release.yml` on `main`, requiring `deploy_production=true`, the exact qualified current-main SHA as `expected_head_sha` and an allowing production-policy check; for an Edge release it also requires the `edge-functions` operation and the typed confirmation `RELEASE edge-functions AT <exact SHA>` (a frontend release uses `frontend` with its matching confirmation). Product Owner authorization for the specific release is still required, and other backend operations keep their own separate authorization.
- The 17 October sentence below stating that the "machine baseline fields now record #1650's `5f5f465a` base" describes the field's pre-reconciliation value.

Machine fields:
- **Historical merged checkpoints:** `task-*`, `task-1360-recovery-copy` and `lane-1467/1469/1481/1483/1493`. `lane-practice-loop: merged` records #1493, merged 17 September, at the 20 September documentation checkpoint; #1474 and #1548 remain open. `lane-1475: merged` is the historical G12 signed-out homepage source delivery via [#1487](https://github.com/relativityE/speaksharp/pull/1487#issuecomment-5721979182) (head `82bc2c2fdcdad5a45a19ebdd60b50e4eba675f8d`, squash `b2b0cea9cb86f34bb290d08b4e8c19ae517fe676`, 17 September 22:17:31 UTC). It does not close #1475, which #1499 kept open for PO verification.
- **Retained owner sequencing:** `retention-campaign` (guarded off-critical-path), [`lane-stage-b`](https://github.com/relativityE/speaksharp/issues/1391#issuecomment-5488291020), and `lane-billing` (historical test-mode lifecycle, not live activation).
- **Open acceptance, which does not imply missing code:** `release-blocker` (final exact-release acceptance is not established; historical PASS/FAIL/HOLD/not-run outcomes remain retained), `lane-telemetry` (#1259 received telemetry), `lane-retention-copy` (#1254 rendered cross-surface acceptance), `lane-1474` (final served campaign/human/device evidence) and [`lane-test-identity-roles`](https://github.com/relativityE/speaksharp/issues/1495#issuecomment-6243867940) (#1495 provider/environment/cleanup proof).
- **Evidence gap, no distinct current disposition recorded:** `lane-design-brief`, and [`lane-canary-rotation`](https://github.com/relativityE/speaksharp/issues/1513#issuecomment-5751001873), where the one-time repair is separate from durable renewal.
- **Returned, as preserved historical negative evidence:** `lane-1258-journey` is the 4 September human Production test at `c4665156212dd03cd6d7b91c49bed90dea868b5a`, in which both Open Mic and Focus failed ([dated record](https://github.com/relativityE/speaksharp/blob/81a53d304f106640ad1d8eaeadb457e8d5585aa5/product_release/RELEASE_STATUS.md#L31-L76), which binds the release, not a new raw human-session receipt). Later #1593 source repairs are separate; #1258 stays open, final exact-release acceptance is not established, and historical PASS/FAIL/HOLD/not-run outcomes remain retained. `lane-moonshine` is the September #1263 [bounded RETURN](https://github.com/relativityE/speaksharp/issues/1263#issuecomment-5683573477) at `7552d78532b857bf1e36a078393feaed2fa2514e`: the default and speculative-off manifests both record fail/repetition_loop (runtime 0.1.5, 95.3815 s, 278 reference words). Later October sequence review is separate; Moonshine is deferred until after RWT/MVP and is not an RWT gate.

### Historical snapshot and subsequent receipts — 17 October 2026

The dated 21:54 UTC repository-main observation was `bc1ea8eaec3d410865b832319a0e855b299693e3`, after [#1649](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240433326). That observation and the last-observed served receipt above remain historical evidence; the fixed integration / qualification baseline and machine baseline fields now record #1650's `5f5f465a` base. This bounded label correction performs no new deployment read or canary run.

The earlier observations remain history: repository main was `9316cbf174f65870b2af6b15a3669bc4fdadc0be` at 19:38 UTC; [App Dev reported served `cc2dc6a2c6268b29aada26900f76c1abdc78244f` at 19:16 UTC](https://github.com/relativityE/speaksharp/pull/1646#issuecomment-6239375719); [canary39061658233 was HELD](https://github.com/relativityE/speaksharp/pull/1646#issuecomment-6239366116) before 118/119 application. These are not the current identity rows or currency-block values. The following subsequent receipts supersede their unresolved-state interpretation; they are owner-reported evidence, not new Production queries by Browser PM:

- **118→119 applied and verified at 19:38–19:40 UTC**, bound to `9316cbf1`, under the PO's separate App Dev session permission. [Application/postflight receipt](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6239793870): exact-apply runs [39063324737](https://github.com/relativityE/speaksharp/actions/runs/39063324737) and [39063414068](https://github.com/relativityE/speaksharp/actions/runs/39063414068) succeeded in order; disabled-state postflights passed. The former migration-permission/application blocker is resolved for those two exact migrations. Deletion remains disabled; this did not deploy Edge functions or establish global drain.
- **#1611 reconciled to `2ebac6f71a37ae160dc49fee502fa2ecf29d0c78`, then returned at 20:12.** Its historical qualification did not resolve [the checkout-fence defect](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6240251570). [Sam's later SOURCE ACCEPT at `736107f5eec9e8e019ddf85dae015fde806f7eee`](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6241637169) accepts the bounded recovery repair and disposable proof, not a landing. Migration 120 remains unapplied and must pass a separate migration-only prerequisite/application before the corrected ten-Edge release; applied 117–119 must not be rewritten. CLI Dev prepares source/qualification; App Dev remains the eventual approved operational executor. Full customer deletion remains open.
- **Later served/canary receipt:** [#1649](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240476368) reports `bc1ea8eaec3d410865b832319a0e855b299693e3` served at 20:24:30 UTC and product canary [39066400126](https://github.com/relativityE/speaksharp/actions/runs/39066400126) PASS, no longer held on 118/119. Its opener source is integrated; the earlier unwired finding below is history. The [rebound save/retry packet](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6240521807) still requires specific authorization naming that release; a canary is not full useful RWT or human/device acceptance.

### Post-snapshot owner-reported receipts — not independently Production-verified

The following addenda are later owner-reported history, outside the 17 October 21:54 UTC snapshot verification above. Browser PM read the linked receipts; their operational claims have not been independently checked against Production here. Each receipt records its own execution/observation time. They supersede the corresponding earlier pending-state instructions without changing the fixed historical identities or machine-readable currency block; re-read moving identities before any new operation.

**Subsequent disposition:** #1651 integrated migration120 and its operational wiring; authorized application/postflight are now verified by the owner receipt. The earlier pending120 state is historical. The then-remaining work was current-main reconciliation and qualification of #1611's backend/ten-Edge release, subsequently reported complete in the next receipt. [App Dev's merge/application/postflight receipt](https://github.com/relativityE/speaksharp/pull/1651#issuecomment-6243007189) binds the authorized execution to `123651494b96b9c8d050458a0f94d5ef0258336a`; [exact-apply run39078485396](https://github.com/relativityE/speaksharp/actions/runs/39078485396) is SUCCESS. This does not authorize Edge deployment, deletion activation or complete customer-exit acceptance.

**Subsequent backend disposition — 18 October, 00:31–00:37 UTC:** #1611 is source-landed as `52623c6bc6f065fdf43633ed99d48b7b643e63e6`; its [separate merge/invalidation/deployment/canary/served receipt](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6243801709) supersedes the earlier future #1611 reconciliation/landing instructions. [Edge release39083093961](https://github.com/relativityE/speaksharp/actions/runs/39083093961) and [active-trial canary39083093960](https://github.com/relativityE/speaksharp/actions/runs/39083093960) are reported SUCCESS. The invalidation summary records generation1 and `activationAuthorized:false`; three changed functions deployed and seven reported unchanged. App Dev reports the same source SHA served at 00:36:56 UTC. Browser PM read the owner receipt, not a new Production query. Existing effective nonsecret function/configuration/generation/default-disabled readbacks remain distinct from workflow acknowledgements; CLI Dev owns evidence verification and App Dev retains assigned operations. No repeated deployment, migration, activation or customer/provider mutation is commissioned here. Global-drain and complete customer-exit acceptance remain HOLD; fixed historical baseline/served snapshots above are preserved.

**Subsequent frontend disposition — 18 October 2026, 09:20–09:23 UTC:** [App Dev's #1652 landing/canary/served receipt6248196339](https://github.com/relativityE/speaksharp/pull/1652#issuecomment-6248196339) reports squash merge `3540103e8d86b5a284265443312c61e643bf5304` at 09:20:24 UTC after full-lane PR CI [39111739476](https://github.com/relativityE/speaksharp/actions/runs/39111739476) SUCCESS and clean exact-head Code/Security qualification. Canary [39114943038](https://github.com/relativityE/speaksharp/actions/runs/39114943038) is reported SUCCESS, including read-only migration readiness and active-trial checks. At 09:22:46 UTC App Dev observed `VITE_VERCEL_GIT_COMMIT_SHA = 3540103e8d86b5a284265443312c61e643bf5304` in the served bundle. This records delivered #1652 source/deployment and supersedes its earlier repair/deployment assignment; do not repeat that repair or deployment. It is a dated owner receipt, not a new Production read by Browser PM or a guarantee of the moving served identity. Final campaign release binding, specifically authorized full useful Open Mic/full and partial Focus RWT, received evidence/cleanup and human/device acceptance remain open. The Products-menu/dialog race remains open with CLI Dev. No live campaign or customer-exit acceptance follows.

<!-- CURRENCY-BLOCK
baseline: b9907d625e6d5b9810050f556d62904baa62982c
deployed-release: d401349bca036be1f5413fa50faba536fba3ed51
verified-on: 2026-11-12
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

The currency guard checks local committed-file consistency and recent ancestry. It **cannot read a moving GitHub branch or Production deployment**. The source checkpoints in the block do not close their parent issues or qualify an unobserved deployed journey.

## Source and landing queue at the 19:38 snapshot

| Work | Verified source state at this snapshot | Remaining boundary / owner |
|---|---|---|
| #1627 Start/next-take; #1634 round-two corrections; #1636 measured-target labels; #1639 durable retry; #1640 recovered Review | Merged source; receipts are indexed in the [accepted readiness packet](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6233782501) | These are not a complete current-release live pass. App Dev owns affected RWT execution; Sam owns review; human/device acceptance remains separate. The narrow #1636 display change does not close broader #1548 usefulness. |
| [#1641](https://github.com/relativityE/speaksharp/pull/1641) next-take oracle | Merged as `e7497b6a9240312890af3a8342e5c44e74e7d616` | Corrects the premature next-ID oracle. Source repair does not convert prior live failures to PASS. |
| [#1642](https://github.com/relativityE/speaksharp/pull/1642) Focus first-take oracle | Merged as `1936772dfec394c5fd7f01a9a8359ec992895268` | Keeps the finite first-take save check separate from a later legitimate take. No full Focus/live acceptance follows from the merge. |
| [#1644](https://github.com/relativityE/speaksharp/pull/1644) rendered-review harness | Merged as `92a3172dfc473486586e9f06c8db122f4a80c01e` | Test-only. Strict slot stability and the missing correction opener are explicit unmet requirements; expected-failure trackers are not acceptance. |
| [#1646](https://github.com/relativityE/speaksharp/pull/1646) malformed feedback reference oracle | Merged as `cc2dc6a2c6268b29aada26900f76c1abdc78244f`, from requalified head `1755cb4514a1b58615fa24966525a38e5442b94e`; [full CI 39060497788](https://github.com/relativityE/speaksharp/actions/runs/39060497788) passed | [Landing receipt](https://github.com/relativityE/speaksharp/pull/1646#issuecomment-6239361314). Deferred-P2 test repair; not a new RWT gate. The earlier Draft-lane rejection does not negate the later full qualification. |
| [#1647](https://github.com/relativityE/speaksharp/pull/1647) MicCard progress display | Merged at 19:36:37 UTC as `9316cbf174f65870b2af6b15a3669bc4fdadc0be`, from `e0143bfbb76ae8c8d45bcc38610e6260be44cf15`; [full CI 39062162599](https://github.com/relativityE/speaksharp/actions/runs/39062162599) passed | [App Dev's exact-head landing receipt](https://github.com/relativityE/speaksharp/pull/1647#issuecomment-6239711911) records clean Code/Security and a fresh guard under separate authorization. Frontend product change; the later served/canary read is separate above, and cold-download proof is not established by a merge receipt. |
| [#1645](https://github.com/relativityE/speaksharp/pull/1645) review-height reservation | Draft/HOLD, head `46adb53b734cae41c6786c0acf76ae772f16153c` | [Sam's HOLD](https://github.com/relativityE/speaksharp/pull/1645#issuecomment-6236767277) and [final beta disposition](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6237252640). Browser PM owns design interpretation/opener disposition; App Dev preserves the rejected candidates as evidence. |
| [#1611](https://github.com/relativityE/speaksharp/pull/1611) backend-only staging | Open/Ready, frozen `932fc21ae1b2e9eea4d696adaafd0e8ccb5790e6`, old base `1936772d…`; behind this baseline | Earlier [full CI 39040358442 attempt 2](https://github.com/relativityE/speaksharp/actions/runs/39040358442) and source acceptance are historical qualification for that pair. CLI Dev must reconcile/requalify against then-current main. App Dev is the selected operational executor under the conditional disposition below. |
| [#1643](https://github.com/relativityE/speaksharp/issues/1643) customer-exit successor | OPEN; complete UI preserved at `cb0443a1672624d52580dd35a163bae512e53803`; accepted increments through `329931123f1eb4c6761066a83d3122783d77551a` | [Latest bounded source acceptance](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6239404211). Preserved-branch tests are not current-main integration, global-drain proof, deployed customer acceptance or permission to merge the full branch. CLI Dev consolidates against the retained nine-item contract. |

The old September list naming #1499/#1488 as current merge candidates is superseded. Current Code/Security and full-CI evidence must belong to the candidate being considered; historical reviewer-capacity exceptions are not a current review substitution.

## Database application and coupled backend release

[App Dev's 19:16 UTC exact-apply packet](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6239361034) records the following as **prepared, NOT dispatched**:

| Ordered target | Version | Reviewed file digest |
|---|---|---|
| 118 — drain persistence, first | `20261016090000` | SHA-256 `d8a5b1d153890167869b2e7d366fb1ae3dd1272a67cd26f3980e6d2cd5233145` |
| 119 — drain enforcement, only after 118 postflight succeeds | `20261016180000` | SHA-256 `2613a3921d084d008d18e94834c59d0764c108b38385afbcb280cd01760bdce1` |

That historical preparation packet was bound to `cc2dc6a2` and needed rebinding and separate session permission. The later application receipt above supersedes its NOT-dispatched state and records the authorized `9316cbf1` execution. The digests alone never authorize an apply. No schema query or apply was performed by Browser PM for this documentation edit. Earlier ledger reads remain historical observations, not a claim that September pending entries are still pending or that the current database was independently inspected here.

[Sam's #1611 conditional operational disposition](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6235256759) requires verified ordered 118→119 application/postflight, current qualification and a fresh guard before landing. Its reviewed paths couple landing to protected generation invalidation and the ten-function Edge release. That is distinct from the test-only #1644/#1646 merges. A denial is not permission to retry through another route. Registration/deletion activation, provider/account mutations and customer live proof remain outside that staging authorization.

## RWT and human/device evidence

The [accepted readiness matrix](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6233782501) and [finite journey ledger](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6224202786) retain all nine existing spec groups. Full useful Open Mic, full and partial Focus, navigation/Start, both save-loss cases, feedback association, abandonment/mutex, adverse mic/model cases and returning-user navigation retain separate outcomes. No partial-testing shortcut or new acceptance gate is introduced.

- Original request-lost and response-lost receipts on `e3fa340c…` are preserved in [#1593](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6233741274): durable save and scoped cleanup passed, downstream Review scenario failed.
- Later `a88b0dae…` diagnostics 39032621328/39033042858 reached recovered Review/Practice again but failed the premature next-ID oracle. [Sam's reconciliation](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6234300137) separates that result from #1641's later source repair.
- The [save/retry rerun packet](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6234836232) requires rebinding to the exact served release and specific authority: request-lost first, review receipt/zero residue/unchanged release, then response-lost only if those conditions still hold. No new run is claimed by this file.
- Named current-release human observations remain outstanding for Open Mic usefulness, full AND partial Focus usefulness, real spoken `uh`, real-device mic Allow/Deny, and phone Stop/saved-confirmation visibility. Automated geometry or synthetic audio does not replace those observations.
- Received telemetry, cleanup and release/configuration binding remain required where the existing contract requires them. A generated event or provider EXTERNAL outcome is not successful delivered coaching.

## Product-design and commercial acceptance

#1474 remains open. The [desktop beta matrix](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6237126670) demonstrates the conflict between fixed slot tops and visible counts. The [corrected 375px mobile matrix](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6238695518) uses 737px as the fixed-bar occlusion boundary, distinct from the 812px viewport and scroll reachability. Neither matrix is PO/device acceptance. [Browser PM's interpretation/opener disposition](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6239720648) supplied the recommendation; [Sam's subsequent ruling](https://github.com/relativityE/speaksharp/issues/1474#issuecomment-6240521998) selects natural growth with actual useful feedback visibility and reachable unobscured controls. The Share Feedback opener is integrated by #1649 and included in the served receipt above. Remaining layout/mobile/device acceptance stays separate; neither the recommendation nor opener merge qualifies #1645 or full G10.

#1643 and #1495 retain cancellation, account-bound verification, billing ownership, authoritative worker cutoff/termination/settlement, runtime/schema binding, cleanup and actual customer/provider acceptance. **#1643's authoritative registration/current-facts producer is SOURCE INCOMPLETE**, per [Sam's explicit source disposition](https://github.com/relativityE/speaksharp/pull/1648#issuecomment-6239898735), in addition to the missing authoritative global-drain/settlement evidence. This is not merely a remaining operational-test task. Backend staging is not full deletion or MVP completion. Responding-instance probes, complete provider lists and synthetic fixtures cannot establish authoritative global drain. Accepted preserved-source increments and their dated receipts remain valid within their original bounds.

**Model evaluation and current release boundaries.** Private v2 may complete MVP. Model evaluation and fallback work require a separate current selection and acknowledged file ownership. Preserved #1567/#1568 source and unresolved model obligations remain provenance, not an active writer assignment or a prerequisite for v2 MVP acceptance. Evaluation is not promotion: v4 and any fallback configuration require comparable real evidence and explicit Product Owner selection. One producer remains locked for a take; full useful Open Mic/Focus and applicable device acceptance remain required for the selected customer configuration. This document grants no model acquisition, live execution or activation authority. A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

## Evidence and deployment interpretation

### Criterion: what counts as a product-behavior release

Files and affected runtime paths determine effects, not PR titles. A change to shipped `frontend/src/` runtime code or deployed `backend/supabase/functions/` code changes the corresponding product surface. Exclude `__tests__/`, `*.test.*`, `*.spec.*` and the harness-only `frontend/src/e2e/` from that runtime classification. For example, #1357's change to `components/session/__tests__/benchmarkHarnessSurface.test.tsx` did not become product behavior merely because its path starts with `frontend/src/`.

A frontend runtime change needs a fresh served `window.__APP_RELEASE__` read; an Edge change needs verification of that function's actual deployment. A migration changes the database only when separately applied, not when its file merges. Runtime configuration and deployment callers must also be inspected for their actual effects: a script or workflow that applies a migration or deploys functions is an operational path, even when its own file is outside the runtime tree. Test-only and docs-only changes provide no new product-behavior proof. No release identity is inferred from a title, merge, trigger or moving `main` pointer.

### Retained limitations and evidence constraints

- The approximately 90-second post-Stop finalization figure for a full five-minute Private v2 recording remains a conservative planning allowance, not a measured Production p95 or a requirement to wait 90 seconds. Honest Finalizing progress and observed stop-to-final latency remain required; the former less-than-30-second requirement remains withdrawn.
- #1354's retained client-only write-ahead limitation is not closed by this currentization. If Progress evaluation and its browser obligation write both fail, reconstruction after reload requires evidence of a server-side record. Adjacent #1471/#1476 repairs must not be treated as proof of that reconstruction without their exact evidence.
- Vendor accuracy figures are reference-only. Do not rank engines by comparing vendor corpora or decode paths with our own results. #1304's comparable evidence and the stable STT contract govern any accuracy conclusion; this update makes no new ranking or promotion claim.
- Canonical Production remains the only approved URL for PO model qualification. Preview/local/internal builds and test overrides are not PO down-selection evidence. Billing activation, broad tester invitations and unrelated post-MVP debt retain their separate #1258/owner decisions.

Dated reports, archived documents, original receipts and failed observations remain immutable provenance. This file supersedes their current-status interpretation, not their historical contents. Stable procedures and artifact freshness remain governed by [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md); proof classes by [`QUALITY.md`](./QUALITY.md); current implementation order by [`ROADMAP.md`](./ROADMAP.md).

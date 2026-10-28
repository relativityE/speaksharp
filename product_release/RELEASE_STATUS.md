# Release Status

**Status:** Authoritative for the bounded 28 October 2026 component snapshot below; earlier dated snapshots remain history. Release acceptance HOLD.
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-10-28 — specialist source review and current-main receiving; exact-head qualification remains a separate gate.
**Last Verified:** 2026-10-28 — GitHub main `8a79eafa23bd3beeee6d087270acd9ed5a16eb1e` read during receiving; frontend and Edge `4c85` remain bound to Sam's retained release receipts below. No new Production query or end-to-end acceptance is claimed by this documentation change.
**Applies To:** Current production deployment + RWT/Alpha and MVP/Beta release tracks.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** the September current-status narrative and October baseline-only banner here. Historical evidence and archives remain unchanged.
**Evidence Sources:** the exact GitHub PR, issue-comment and workflow receipts linked below.

## 28 October 2026 post-R5 receiving addendum

**HOLD — documentation receipt, not a new live verification.** This addendum supersedes
older current-tense deployment and queue statements below. GitHub source was read at
`4c85b006ac05e180521fd6e7d807f736987cafe8`; the earlier observations remain dated history.

| Identity | Recorded value | Evidence boundary |
|---|---|---|
| Repository `main` currency-comparison baseline (fixed) | `4c85b006ac05e180521fd6e7d807f736987cafe8` | Matches the currency block below; a fixed comparison base, not an assertion that the moving branch still points here. |
| Latest observed GitHub main during receiving | `8a79eafa23bd3beeee6d087270acd9ed5a16eb1e` | Source-only #1752 landing; no product deployment or customer acceptance inferred. Re-read before the next operational action. |
| Latest retained frontend `__APP_RELEASE__ =` | `4c85b006ac05e180521fd6e7d807f736987cafe8` | Sam's frontend release/readback receipt below; no fresh Production read by this documentation task. Older deployed rows remain dated history. |

Sam's release handoff reports frontend and backend on that source, from backend
[40674315502](https://github.com/relativityE/speaksharp/actions/runs/40674315502) and frontend
[40675011692](https://github.com/relativityE/speaksharp/actions/runs/40675011692), before R5.
Sam separately verified generation 6, account completion OFF and migration 129 absent.
No deployment since R5 is reported in that handoff. These are attributed release observations,
not a new production read or proof of account completion by this documentation task.

### R5 results and reviewed interpretation

The Library `R5-REPORT.html` and `R5-SUMMARY.txt` retain the original results on the
served baseline above. Their denominators must not be added together:

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
baseline: 4c85b006ac05e180521fd6e7d807f736987cafe8
deployed-release: 4c85b006ac05e180521fd6e7d807f736987cafe8
verified-on: 2026-10-28
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

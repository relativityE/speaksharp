# Release Status

**Status:** Authoritative for the bounded 17 October 2026 snapshot below; release acceptance HOLD.
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-10-17 — Sam source-accepted the bounded corrections; successor review qualification remains separate.
**Last Verified:** 2026-10-17, 21:54 UTC — GitHub main plus linked owner-reported deployment/operation receipts. No new Production query or live run.
**Applies To:** Current production deployment + RWT/Alpha and MVP/Beta release tracks.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** the September current-status narrative and October baseline-only banner here. Historical evidence and archives remain unchanged.
**Evidence Sources:** the exact GitHub PR, issue-comment and workflow receipts linked below.

## Disposition

**HOLD — full useful Open Mic/Focus RWT and complete customer/MVP acceptance remain unfinished.**
Source acceptance, local tests, CI qualification, merge, deployment identity, migration application, live proof and human acceptance are distinct evidence classes. None substitutes for another. This snapshot grants no operational authority.

| Identity | Recorded value | Evidence boundary |
|---|---|---|
| **Repository `main` integration / qualification baseline (fixed)** | `5f5f465a93a5c582ca0f2553a0781ecb5eb9dfbf`, the reviewed integration base after #1650 | [Sam's bounded identity-label disposition](https://github.com/relativityE/speaksharp/pull/1648#issuecomment-6242262333). This records the base integrated into #1648, not an evergreen branch-pointer or deployed-release claim; re-read moving identities before operational decisions. |
| **Deployed product release (last owner-reported READ)** | `__APP_RELEASE__ = bc1ea8eaec3d410865b832319a0e855b299693e3`, App Dev's 20:24:30 UTC observation | [Served-release receipt](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240476368). Browser PM read back the receipt, not Production. Equality with the recorded baseline establishes no full RWT or human acceptance. |
| **Canary** | [39066400126](https://github.com/relativityE/speaksharp/actions/runs/39066400126), SUCCESS; active-trial product lane passed | [Post-merge receipt](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240476368) confirms runtime migration readiness and product execution after 118/119. This replaces the earlier migration HOLD, not the full two-product RWT requirement. |
| **Release line** | `v0.9.0-rc`; package version remains `0.9.0-rc0` | This is not a selected new tag or permission to tag. Any release-tag choice remains a separate disposition. |
| **Documentation scope** | First bounded #1318 current-state correction: this file and `ROADMAP.md` | [Sam's assignment](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6234300137). This is not final reconciliation of all 14 canonical documents or closure of #1318. |

### Historical snapshot and subsequent receipts — 17 October 2026

The dated 21:54 UTC repository-main observation was `bc1ea8eaec3d410865b832319a0e855b299693e3`, after [#1649](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240433326). That observation and the last-observed served receipt above remain historical evidence; the fixed integration / qualification baseline and machine baseline fields now record #1650's `5f5f465a` base. This bounded label correction performs no new deployment read or canary run.

The earlier observations remain history: repository main was `9316cbf174f65870b2af6b15a3669bc4fdadc0be` at 19:38 UTC; [App Dev reported served `cc2dc6a2c6268b29aada26900f76c1abdc78244f` at 19:16 UTC](https://github.com/relativityE/speaksharp/pull/1646#issuecomment-6239375719); [canary39061658233 was HELD](https://github.com/relativityE/speaksharp/pull/1646#issuecomment-6239366116) before 118/119 application. These are not the current identity rows or currency-block values. The following subsequent receipts supersede their unresolved-state interpretation; they are owner-reported evidence, not new Production queries by Browser PM:

- **118→119 applied and verified at 19:38–19:40 UTC**, bound to `9316cbf1`, under the PO's separate App Dev session permission. [Application/postflight receipt](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6239793870): exact-apply runs [39063324737](https://github.com/relativityE/speaksharp/actions/runs/39063324737) and [39063414068](https://github.com/relativityE/speaksharp/actions/runs/39063414068) succeeded in order; disabled-state postflights passed. The former migration-permission/application blocker is resolved for those two exact migrations. Deletion remains disabled; this did not deploy Edge functions or establish global drain.
- **#1611 reconciled to `2ebac6f71a37ae160dc49fee502fa2ecf29d0c78`, then returned at 20:12.** Its historical qualification did not resolve [the checkout-fence defect](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6240251570). [Sam's later SOURCE ACCEPT at `736107f5eec9e8e019ddf85dae015fde806f7eee`](https://github.com/relativityE/speaksharp/pull/1611#issuecomment-6241637169) accepts the bounded recovery repair and disposable proof, not a landing. Migration 120 remains unapplied and must pass a separate migration-only prerequisite/application before the corrected ten-Edge release; applied 117–119 must not be rewritten. CLI Dev prepares source/qualification; App Dev remains the eventual approved operational executor. Full customer deletion remains open.
- **Later served/canary receipt:** [#1649](https://github.com/relativityE/speaksharp/pull/1649#issuecomment-6240476368) reports `bc1ea8eaec3d410865b832319a0e855b299693e3` served at 20:24:30 UTC and product canary [39066400126](https://github.com/relativityE/speaksharp/actions/runs/39066400126) PASS, no longer held on 118/119. Its opener source is integrated; the earlier unwired finding below is history. The [rebound save/retry packet](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6240521807) still requires specific authorization naming that release; a canary is not full useful RWT or human/device acceptance.

<!-- CURRENCY-BLOCK
baseline: 5f5f465a93a5c582ca0f2553a0781ecb5eb9dfbf
deployed-release: bc1ea8eaec3d410865b832319a0e855b299693e3
verified-on: 2026-10-17
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

Retention activation/copy and model evaluation/promotion keep their existing separate dispositions. The current model lane is explicitly **post-MVP**: [#1304](https://github.com/relativityE/speaksharp/issues/1304) and [#1565](https://github.com/relativityE/speaksharp/issues/1565), reusing prepared [#1567](https://github.com/relativityE/speaksharp/pull/1567) evaluator and [#1568](https://github.com/relativityE/speaksharp/pull/1568) primary/fallback policy. **CLI Dev owns both implementations**; Browser PM owns plan/evidence review, and PO owns promotion/activation. Reuse [Browser PM's completed plan6233865706](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6233865706), [accepted by Sam6234300811](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6234300811); do not commission a second plan. **v2 may complete current MVP**. Closed #1462 is historical provenance, not the current lane owner or a new RWT gate. This docs edit changes no model selection, pricing, entitlement or operational authority. A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

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

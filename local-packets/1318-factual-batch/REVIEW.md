# #1318 factual correction batch

Browser PM · 18 October 2026 · source preparation for Sam's review.

Assignment: [Sam 16:24 UTC](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792340646341399?thread_ts=1792327490.973069&cid=C0C9RE8KNHG), reiterated at 16:33 UTC. Parent is accepted six-file model-phase source `cf6a59cdce6fbf0642440002625182940cecf614`; its base is `3540103e8d86b5a284265443312c61e643bf5304`. This is a review branch, not current-main qualification or a competing implementation PR. Observed main during preparation is `79d9b801f4c87b4ebfc566cd4e539d920522395a`.

The [existing 19-finding ledger](https://github.com/relativityE/speaksharp/blob/ecd2c048e05c4c536972fdd3e4b66707bc4953f6/local-packets/1318-canonical-disposition/LEDGER.md) supplies the scope. No new census, broad audit, architecture or policy is introduced.

| Selected finding | Applied factual correction | Existing authority |
|---|---|---|
| F06 | PRD, Architecture and Progress distinguish closed implementation/consolidation provenance from retained deployed acceptance. No old ticket pin becomes a new assignment. | #1471 closeout5836005989; #1476 closeout5822151239; #1473 consolidation6116504265; retained #1258/#1593, #1472/#1474/#1254. |
| F07 | Architecture retains newest-one policy, removes obsolete newest-two-as-current and #1452-open prerequisites, and routes current runtime facts to RELEASE_STATUS. Deletion remains separate. | #1452 disposition5782362326; current retention invariant in Architecture §5. |
| F08 | Progress no longer says all attempts/comparability/outcomes are absent. Existing owner-scoped accepted attempts and server-comparable directional resolution are distinguished from useful target-specific outcomes and causality. | Progress §8; recordProgress.ts record_recommendation_attempt/advance_recommendation_attempt; #1548 source reconciliation6240022121. |
| F09 | Progress links the existing canonical ROADMAP. The old missing-roadmap audit remains dated provenance. | Portal canonical authority map; retained reconciliation ledger §11. |
| F14 | Raw artifacts remain diagnostic authority; green shards/manual interpretation cannot waive a failed required aggregate/report or exact-head qualification. | Quality §7; existing release-process qualification rules. |
| F15 | Removes expired September named queues from procedural authority. Isolated assigned work and serial landing remain; actual ownership comes from current coordination. | AGENTS work/review model; selected current Sam assignments. |
| F18 | Corrects archived SCA source path; dated July evidence is not a fresh scan or current green verdict. | Actual archived path; Operations §8. |
| F19 | Corrects Private v4 administration to Tester Operations §6 and labels v4_work historical reference without a runtime posture claim. | Actual section heading and accepted post-MVP model phase. |

Exactly six canonical files are changed relative to cf6: PRODUCT_REQUIREMENTS, ARCHITECTURE, PROGRESS_AND_NEXT_ACTION, QUALITY, RELEASE_PROCESS and EVIDENCE_INDEX. The accepted model-phase paragraphs and their future qualification requirements are preserved. ROADMAP, RELEASE_STATUS, STT, TESTER_OPERATIONS, all archive/evidence files and all runtime/configuration/migration/workflow paths are untouched by this increment.

F13/F16 remain account-exit evidence HOLD. They are not waived by #1611 source/deployment or the replacement designer ZIP. Sam's later account-scoped pending→settlement→deletion clarification governs routine deletion; the specific legacy checkout cutover exception remains separate. The latest #1643 source work is not live acceptance. F10/F11 exact-label and privacy-copy review boundaries and F12/F17 unselected text are unchanged.

The Progress Last Verified date remains 2026-09-15; its obsolete routing annotation is explicitly historical rather than falsely re-verifying the whole document today. No other review/verification metadata is restamped.

## Review and qualification limits

This source changes factual routing/interpretation and references only. It does not complete #1318's full canonical/non-archive outcome. Sam reviews this bounded delta; the selected landing executor reconciles it with actual main and obtains normal exact-head qualification before a sequential PR. No merge, deployment, migration, activation or live test is performed.

Related acceptance reconciliation is in `local-packets/pm-acceptance-reconciliation/ACCEPTANCE.md` and `CASE1.md`. These are evidence records, not new release gates or runtime status authorities.

## Executed validation

- Normal unchanged `frontend/vitest.config.mjs`, existing Vitest3.2.4 dependency cache, one worker, coverage disabled for the focused run: documentationContract34 + documentationLedger7 + private-launch-playbook-contract10 = **51/51 PASS**.
- `node scripts/product-contract-guard.mjs`: PASS. `git diff --check`: PASS.
- Mechanical scope check: exactly the six selected canonical paths changed; all fenced commands, review dates, verification dates and accepted model-phase paragraphs preserved. Archive/evidence/runtime/workflow/configuration paths unchanged. Corrected archive target and Tester Operations §6 heading exist.
- `recordProgress.ts` and `loadSessionProgress.ts` have no difference between cf6 and observed main79d9b801; this is bounded source continuity, not fresh live proof.
- Environment provenance: restored checkouts pointed to an expired git worktree, so preparation used an isolated partial clone. Initial test collection lacked normal sparse-checkout dependencies; later checks lacked referenced files/history. Materializing the original tracked dependencies and ancestry resolved these failures without changing config, tests, commands or thresholds. Final51PASS is on this corrected checkout and final canonical text. No dependency installation or cache mutation.
- No full DEFAULT quality, exact-head PR CI, browser/device acceptance, deployed proof or new SCA scan is claimed. Existing cf6 model-policy evidence remains at its original provenance, not relabeled as rerun here.

# #1318 actual-main integration and retained closure checklist

Browser PM · 18 October 2026 · isolated preparation for Sam's review and the selected serial landing owner.

Assignment: [actual-main integration](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792342163505479), [source acceptance](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792342299913039). This is the requested existing-work integration, not a competing PR or a whole-issue closure claim.

## Source and scope

- Integration base: main `7163f00d9c1b3fac36fd8cc13afd476b69f4ec0a`, fetched and matched to GitHub's branch record.
- Accepted model-phase source: `cf6a59cdce6fbf0642440002625182940cecf614`; original preparation base `3540103e8d86b5a284265443312c61e643bf5304`.
- Accepted factual source: remote `f15e0fa92678a9ac30d589371c55c625cbddf087`, tree `0f4901d70c9758eb1e08dbdd0b2c32c0dd0fdd06`. Tested local `46a2680f0ee0bf75b126feb385855d9e40035c3c` has that exact tree; different commit metadata is not a source difference.
- Replayed the original accepted deltas onto actual main, rather than restoring an older branch tree. Three cherry-picks completed without conflicts. The canonical files are byte-identical to the accepted source after integration; receipt-sidecar updates are separately identified.
- Eight canonical files in the combined scope, 42 additions/26 deletions relative to the integration base: PRODUCT_REQUIREMENTS, ARCHITECTURE, STT, QUALITY, RELEASE_PROCESS, TESTER_OPERATIONS, PROGRESS_AND_NEXT_ACTION and EVIDENCE_INDEX. The original model and factual increments remain separately reviewable.
- `ROADMAP.md` and `RELEASE_STATUS.md` retain current-main bytes. #1648 is merged; this work neither reopens its two-file scope nor claims its remaining release/human outcomes complete.
- No runtime, tests, workflow, config, migration, archive or dated evidence source is changed. No review/verification date is bulk-restamped; fenced commands are preserved. The existing Progress routing annotation remains historical.
- `CASE1.md` adds the later release-check receipts and pending source/early-subset distinctions. `ACCEPTANCE.md` retains the delivered #1548/#1261 decisions unchanged. These local review records do not replace canonical status or App/Sam's execution packet.

## Bounded closure checklist

| Retained requirement | Disposition and evidence needed | Owner / home |
|---|---|---|
| Accepted model-phase corrections, F01–F05 and the selected Tester Operations model comparison wording | Replayed in this integrated source. Private v2 may complete MVP; candidate comparison remains later-phase. Full useful Open Mic/full+partial Focus and applicable physical-device proof remain required. | Sam source review; selected landing owner; #1318/#1565 |
| Selected factual F06–F09/F14–F15/F18–F19 | Replayed in this integrated source; see REVIEW.md and immutable accepted ledger for row authorities. Preserve closed-ticket provenance versus retained acceptance, newest-one policy, implemented attempt structures versus unproven usefulness, existing roadmap, exact-head aggregation and procedural ownership. | Sam source review; #1318 |
| Exact affected text, retained command/metadata and current-main reconciliation | Verify changed-path allowlist, unchanged canonical bytes versus accepted source, fenced commands and dates, unchanged ROADMAP/RELEASE_STATUS and no runtime/config impact. | Browser PM; this checkpoint's validation receipt |
| Documentation and quality qualification | Focused documentation/release/model-phase tests and repository-wide `pnpm quality`; report exact results and limitations. Later exact-head PR CI remains the landing owner's normal gate, not implied by local checks. | Browser PM local evidence; App selected serial landing |
| F10 mic-intent/exact visible labels; F11 saved-transcript/Gemini privacy wording | Still open for the already retained exact-label/privacy-copy review. Do not silently select or apply wording while integrating the accepted batch. Match real accepted product behavior and PO privacy authority. | Browser PM + PO/App; TESTER_GUIDE / #1318 |
| F12 cancellation versus permanent deletion wording | Existing approved distinction remains a separate selected wording/owner disposition; do not imply shipped UI, refund or provider policy from this source batch. | PO/Browser PM; ENTITLEMENTS_AND_BILLING; #1643/#1495 |
| F13/F16 account-exit and global registration/settlement proof | HOLD retained. Deployment, replacement designer files and local tests do not prove global worker drain, independently verified configuration/settlement or end-to-end erasure. No destructive fallback or invented producer evidence. | App/CLI technical evidence; Sam review; #1643/#1495 |
| #1548 and nine #1261 retained rows | Delivered dispositions in ACCEPTANCE.md retain useful same-target evidence and actual caller/ACL positives/negatives. Source/catalog acceptance is not their unrun dynamic proof. | Existing selected owners; #1548/#1261 |
| #1593 full campaign and six human/device rows | Updated CASE1.md keeps case1 incomplete, other unrun cases explicit and all six human/device HOLDs. Canary/source tests and the proposed zero-coaching subset do not close these outcomes. | App execution; Sam reconciliation; PO/named observers; #1258/#1593 |
| Broader canonical/non-archive closeout | Review every retained original ledger condition: incorporated with evidence, open with named owner/home, expressly superseded or deferred with its promotion condition. This bounded integration cannot close #1318 or erase unique requirements because another wrapper overlaps. | Browser PM traceability; Sam/PO disposition; #1318 |

The next handoff is exact integrated source, executed checks and remaining decisions. No competing PR, merge, deployment, migration, provider/account operation, live test or acceptance waiver is performed by preparing this branch. Landing freshness must be checked again if main advances.

## Executed checkpoint evidence

Normal unchanged repository configuration, pinned pnpm10.29.1 via the existing corepack wrapper, reused local dependency cache; no dependency installation or lockfile change.

```sh
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 \
  tests/config/documentationContract.test.ts tests/config/documentationLedger.test.ts \
  tests/release/private-launch-playbook-contract.test.ts tests/unit/humanTestPreTakeControl.test.js
pnpm quality
git diff --check
```

- Focused run: **79/79 PASS across4files** (34 documentation contract,7 retained ledger,10 Private launch procedure,28 pre-take controls).
- Mechanical reconciliation: all8 canonical files equal the accepted source byte-for-byte; their fenced commands and review/verification dates preserve integration-base values; ROADMAP/RELEASE_STATUS equal current-main base; no runtime/config/workflow/migration/test delta. PASS.
- Matrix inspection: exactly15 unique case rows and6 explicit human/device HOLD rows; historical unmatched request association and unrun subset retained. PASS.
- Repository-wide quality: result is recorded in the final handoff after the running gate finishes; a focused pass is not its substitute. The first launch stopped at missing root ESLint configuration in the sparse checkout. Unchanged tracked root configs were materialized from HEAD; no config or threshold was edited.
- Required exact-head PR CI, independent review of new receipt-sidecar text, landing and final deployed/human acceptance remain separate. No PR was opened by this checkpoint.

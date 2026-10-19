# #1472 increment 3 — independent source reconciliation

Disposition: **SOURCE ACCEPT for the bounded observed-evidence average/chart increment at ee9c9c420106310c0fab11b97ac9912fa775c192. Whole #1472 OPEN.** This review grants no merge, migration application, deployment, live proof or release acceptance.

Reviewed on 19 October 2026 by Browser PM. This is a source review; no PM local test execution is claimed. A local read/status command was not executed because automatic approval review returned the capacity error reproduced below.

## Exact provenance and latest dispositions

- Delivered original packet: https://github.com/relativityE/speaksharp/issues/1472#issuecomment-6247920206 — b6fa965e9c3c1f90e40383af8995a7a1ef631f58, base 32bde726a2c27431c8ba17c1230f62a754859d75.
- Current remote branch read: fix/1472-analytics-observed-evidence-parity at **ee9c9c420106310c0fab11b97ac9912fa775c192**, rather than the older issue pin.
- Complete delta: https://github.com/relativityE/speaksharp/compare/32bde726a2c27431c8ba17c1230f62a754859d75...ee9c9c420106310c0fab11b97ac9912fa775c192 — four commits, six changed files.
- Current main observed: ba1a9f5ad31778460a4ea9e383a08be14b3222f6. The branch is based on older 32bde726; final integration/qualification belongs to App on the selected actual main. The main-side changes since that common ancestor did not change the reviewed analytics/filler dependency files examined in the comparison.
- Existing bounded design: https://github.com/relativityE/speaksharp/issues/1472#issuecomment-6243872053.
- Sam's later Slack review at 2026-10-18 09:32 UTC accepted the bounded 13a043c9 chart correction, requested an explicit NULL-duration fixture, and retained the mixed-history average limitation. App's 09:47 UTC channel receipt reports ee9c9c42, explicit 4f/4g and author-local RPC 13/13. Channel history was read directly. The later two commits and current source were inspected; no repeat return of the already-fixed chart issue is made.

## Source checks and user impact

1. **RPC delta is bounded.** Comparing the get_analytics_summary function plus ACL text to 20260817140000_repoint_analytics_summary_flat_1306.sql finds exactly four changed lines: duration denominator, positive-duration contributor count, numerator and chart eligibility. IS NOT NULL becomes positive validated total; chart uses coalesce(total,0)>0. The signature/JSON shape, SECURITY DEFINER, search_path, auth.uid()/p_user_id guard, PUBLIC/anon revocation and authenticated/service_role grants are unchanged. The shared _ss_valid_filler_total helper is not modified.
2. **Empty is not a verified zero.** Client rate calculation now uses measuredFillerTotal(persistedFillerEvidence(session)); invalid/NULL, empty and all-zero maps do not contribute a flattering zero or chart point. Positive all-key counts remain observed even without a usable word count, so the rate does not accidentally acquire a WPM dependency. Default-tier versus all-key semantics are preserved.
3. **Trend isolation is preserved.** The shared fillerMetricEligible gate, top words and trend windows retain their previous behavior on both sides. This increment does not claim those older semantics were redesigned or that every Analytics output is fully qualified.
4. **Chart no-time boundary is fixed in the latest source.** The client condition now requires observedFillers !== null AND duration > 0, matching SQL CASE WHEN filler_eligible AND duration > 0. Old b6fa plotted 0.00 for positive counts with zero/NULL duration; that is already corrected by 13a043c9 and is not a new open finding.
5. **Consumer remains the actual server RPC path.** Current-main useAnalytics adapts the RPC rate through fillerRateContributorCount above the RPC threshold; client-only repair would not have fixed that path. Same signature and response shape avoid an API-shape break, but the new eligibility is not delivered to the server until the separately authorized migration is actually applied. Do not describe pre-apply old-server/new-client semantics as already equal.

## Tests inspected, not rerun by PM

- Case 4 independently asserts the required arithmetic: {um:6}+{}+NULL, one minute each, becomes 6.0/min and one RPC contributor.
- 4b checks empty/all-zero exclusion and a malformed client map; it does not claim malformed data was stored in a constrained database.
- 4c checks one observed chart point plus two nulls on both implementations. It checks membership/counts, not chronological point identity; no stronger ordering claim is made.
- 4d compares unchanged overall non-filler fields, top words and trend result against the old function.
- 4e explicitly stores zero duration and 4f explicitly stores NULL duration with positive counts, asserting null chart points on both sides.
- 4g records the known mixed-history average limitation: a timed {um:3} row and zero-duration {um:3} row give 6.0/min on both implementations.
- Authorization cases call the newly redefined function for foreign and missing identities; ACL case checks authenticated/service_role versus PUBLIC/anon grants.
- App reports 13/13 RPC checks on the latest head; earlier 87/87 Analytics, 176/176 ledger/manifest and quality PASS are author evidence from the original packet, not new PM results or exact-current-head CI.

## Limits and closure sequence

The zero/NULL-duration **average** numerator still includes positive counts from untimed rows while their duration contributes no time; this is pre-existing on both implementations and explicitly accepted as a residual in the narrow design. Parity alone does not establish that the average's meaning is correct. Preserve the limitation for Sam's selected successor decision; no universal parity/quality claim or new blocking return is invented here.

App remains the sole implementation/integration owner. Next: reconcile this accepted increment onto the selected current main, preserve the source/evidence claims and known residual, obtain required exact-candidate CI/security/reviews, and present the exact migration allowlist/application operation for separate approval. Then verify actual hosted RPC behavior and the applicable exact-release rendered/deployed outcomes. None of those operations was executed by this review. Keep the whole issue open until its remaining acceptance criteria or explicit retirement are recorded. Do not reopen merged #1582 increments or disturb the active RWT reliability queue.

Browser PM's next independent work is the final-source/per-case acceptance matrix and the outstanding #1318/#1261 readiness/privacy/caller-proof reconciliation, preserving existing owners and human/device limits.

## Execution and communication limitation

The local command attempt returned:

> Automatic approval review failed: Selected model is at capacity. Please try a different model.
> The action was not executed because automatic approval review could not be completed.
> This is a review failure, not a determination that the action is unsafe.
> Do not bypass the approval check; resolve the error or ask the user for guidance.

No local command or test result is inferred from that denial. Source inspection through the already-working authorized read-only connector is distinct review work. Prior Slack queue attempts were likewise explicitly not executed; this source artifact is not proof that a Slack message reached Sam.

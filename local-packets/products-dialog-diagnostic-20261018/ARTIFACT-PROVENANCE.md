# Historical failure artifact provenance

Follow-up at 2026-10-18 17:26 UTC. This corrects the artifact ID in earlier local
notes; it does not reproduce or repair the Products-menu race.

The original job is [117619774976](https://github.com/relativityE/speaksharp/actions/runs/39108537487/job/117619774976),
`e2e-shard-2`, workflow attempt1, head `b29ca81881a9152cc3702f3bf8c7972612dbd7ff`.
Its preserved job log confirms the eight-second header-click interception by the
still-open Objective setup dialog, followed by a passing retry:48 passed,1 flaky.
The log records an attached trace at
`test-results/playwright/products-menu-back-to-back-2d53d-gh-the-header-Products-menu-full-suite/trace.zip`.

The original upload receipt at07:46:18 UTC gives **artifact12129811717**, name
`shard-report-2`, size5920461 bytes, SHA256
`bdb46cc934d8dcb80ae055af1f0f93a48dd3faec444b67ac0b4041fc1e43e73d`.
Direct metadata lookup for that exact ID now returns404. Earlier IDs12130045841
and12130045841404 were incorrect; their404s did not verify the original upload's
availability. The corrected lookup does establish that the original upload is
currently unavailable through this API. Its deletion/absence cause is unknown.

The current workflow artifact list instead contains **12129769011**, also named
`shard-report-2`, created08:03:49 UTC during a later attempt. The run is now on
attempt3. This available artifact was downloaded and inspected; its ZIP SHA256 is
`ee80a6c1ae37acec10e39863d997fd92417d75b2de1388f267206723756afb07`.
It contains the later blob report and an unrelated saved-review error context;
neither the original Products trace nor its screenshot is present. It cannot be
used as the original failure trace or as evidence of repair.

No new browser repetitions, retry changes, product code, CI rerun or production
operation were performed in this follow-up. Preserve OPEN/UNKNOWN: the original
trace or a naturally captured failing trace is still needed to distinguish an
early Escape from a valid-ready dismissal failure. Existing passing diagnostics
do not close that requirement.

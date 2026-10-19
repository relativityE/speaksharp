# Case 2 bounded Start-readiness increment

Completed local checkpoint: 2026-10-19 14:13 UTC. CLI Dev is the sole writer.

Branch: `cli-dev/1593-start-readiness-20261019`; base: `83029ebb67216b2690eeff59e4ec1730d5f6ffe8`. No commit or PR yet.

Sam's 13:54 lease and CLI's personal ACK authorize only `tests/live/helpers/benchmark-utils.ts` and `tests/unit/benchmarkHarnessControls.test.ts`, plus this isolated packet. App confirmed all-branch clearance at 13:53. No new dedicated test or shared Focus caller edits.

Confirmed cause: the actual helper reads model status once and rejects `loading` before a legitimate switch warm-up can reach ready. Existing Focus-switch callers already call this helper. The original helper with nine added controls produced 9 FAIL / 35 PASS (`baseline-red.json`). The corrected helper with thirteen added controls produced 48 PASS (`focused-green.json`). Reports are initially raw; normalize before publication and retain raw originals privately.

Correction: wait at most 30 seconds while loading; accept already-running takes without a second click; preserve terminal failure and lost-observation outcomes; do not silently retry/download. Bind activation to the observed DOM node so a detached button fails instead of resolving to a later take's Start. Existing missing-control wait remains separately bounded at 8 seconds. Existing initial cold/control semantics remain covered.

No live/model/provider/account/DB operation was run. This does not establish a live case2 PASS, fix provider quota or Stop ordering, or resolve the historical Products-menu race. The 48 checks use the actual helper with jsdom/Playwright-compatible page doubles.

Completed validation: affected helper/rendered/switch suites 102/102 PASS; `pnpm quality` exit 0 (product contract, lint, frontend/live/evidence typechecks, eslint-disable guard); staged all-tracked path guard 3/3 PASS. Raw reports have been archived privately and normalized with hashes in `normalization.json`.

No process is running at this checkpoint (focused session 66309, affected session 99948, quality session 19395 and path-guard session 21511 exited 0). Next: coherent commit/PR, then exact handoff to Sam. Next active Slack update by 14:19 UTC or publication sooner. No approval request is pending. Published PRs #1665 e875ed5e and #1666 f3a02d25 remain frozen under Sam's qualification/release ownership; their same-head Draft-to-Ready reviews were refreshed at 14:09 UTC without source changes or duplicate engineering CI. Case 3's exact next-file lease was requested but no next-increment writes have begun.

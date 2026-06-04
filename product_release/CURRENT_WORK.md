# SpeakSharp Current Workboard

This file is the live traffic-control board. Keep it small and current.
Backlog priority belongs in `product_release/BACKLOG.md`; evidence belongs in
the STT reports.

## Tree Lock

```text
ACTIVE_TREE_OWNER: dev-agent
CURRENT_BRANCH: feat/private-vad-prototype
WRITE_STATUS: writing
TASK_ID: STT-P3
TASK: Private named VAD prototype flag
LAST_SAFE_MAIN: b57a585e
NEXT_OWNER: test-release-agent
NEXT_TASK: Rerun Private proof matrix after dev merges named VAD candidate
BLOCKERS: none for read-only work; write work waits for WRITE_STATUS=free
UPDATED_AT: 2026-06-04T16:34Z
UPDATED_BY: test-release-agent / Codex
```

## Active Queue

| ID | Priority | Owner | Status | Branch/SHA | Task | Evidence Needed | Next Action |
|---|---|---|---|---|---|---|---|
| STT-P3 | P0 | dev-agent | writing | `feat/private-vad-prototype` | Ship named VAD prototype flag | Flag name, defaults, changed thresholds/model/runtime metadata, unit tests | Merge to `main`, delete branch, update this board |
| STT-P1 | P0 | test-release-agent | ready | `main@b57a585e` | Private current-main human/browser proof | setup consent, `__PRIVATE_TIMING__`, trust trace, `saveCandidate`, detail equality, filler rows, app-vs-drop-in/app-vs-Native deltas | Run after tree is free or after STT-P3 if dev changes Private path |
| STT-N1 | P0 | test-release-agent | ready | `main@b57a585e` | Native real Chrome mic re-proof | `saveCandidate`, formatter telemetry, trust trace, detail transcript, truecasing/readability | Run human mic proof when browser/human slot is available |
| STT-V4 | P1 | test-release-agent | ready | `main@b57a585e` | Private v4 containment proof | resolved package version, model download/ready, decode result/error, empty/non-empty `saveCandidate`, no Cloud fallback | Run once; classify v4 only, do not fix |
| STT-C1 | P2 | test-release-agent | deferred | `main@b57a585e` | Cloud richer baseline proof | `__CLOUD_STT_TIMELINE__`, tail/readability/WER, clean `data-transcript-text-only` evidence | Defer until Native/Private blockers move |

## Status Values

```text
ready
claimed
writing
testing
review
merging
merged
blocked
invalid
done
```

## Handoff Rules

- If `WRITE_STATUS` is not `free`, do not switch the shared checkout branch or commit there.
- If another agent owns the tree, do read-only work: inspect artifacts, prepare proof scripts, review active diffs, run non-mutating tests, summarize logs.
- Every write task must have a task ID and a branch.
- Every merge updates `LAST_SAFE_MAIN`, `CURRENT_BRANCH`, `WRITE_STATUS`, `NEXT_OWNER`, and `NEXT_TASK`.
- Evidence belongs in reports, not this file.
- Completed task detail should move to the relevant evidence report; this board should stay compact.

## Report Editing Protocol

| Agent | Permission |
|---|---|
| test-release-agent | Owns current verdicts, latest evidence, pass/fail classification |
| dev-agent | Appends only under `## DEV → TEST AGENT` or targeted handoff blocks |
| product owner | Owns priority, scope, release classification, paid/free positioning |

## Branch Protocol

Before write work:

```bash
git status --short
git branch --show-current
git rev-parse --short HEAD
```

Preferred flow:

```text
claim task
update CURRENT_WORK.md
create branch from latest main
commit focused changes
run validation
merge to main
push
delete branch
update CURRENT_WORK.md
release lock
```

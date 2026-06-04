# SpeakSharp Current Workboard

This file is the live traffic-control board. Keep it small and current.
Backlog priority belongs in `product_release/BACKLOG.md`; evidence belongs in
the STT reports.

## Tree Lock

```text
ACTIVE_TREE_OWNER: none
CURRENT_BRANCH: main
WRITE_STATUS: free
TASK_ID: none
TASK: none
LAST_SAFE_MAIN: f69cf44e
NEXT_OWNER: test-release-agent
NEXT_TASK: Confirm flag-OFF Private path unchanged on current main + run Native/Private proof gates. Full RMS-vs-VAD A/B waits for STT-P5 (engine).
BLOCKERS: none for read-only work; write work waits for WRITE_STATUS=free
UPDATED_AT: 2026-06-04T16:56Z
UPDATED_BY: test-release-agent / Codex
```

## Active Queue

| ID | Priority | Owner | Status | Branch/SHA | Task | Evidence Needed | Next Action |
|---|---|---|---|---|---|---|---|
| STT-P3 | P0 | dev-agent | merged | `main@8c7ef391` | Named VAD prototype flag (scaffold) | Flag `?privateVad=1` / `window.__PRIVATE_VAD_PROTOTYPE__`; OFF by default; `PRIV_STT_VAD` thresholds (speechProb 0.5, frame 512, minSpeech 250ms, minSilence 300ms, preroll 300ms); model `silero-vad`; runtime `@ricky0123/vad-web`; telemetry `window.__PRIVATE_VAD_TELEMETRY__`; 6 unit tests | Merged. RMS path byte-identical (flag off). Test: confirm no Private regression + wire harness to telemetry contract |
| STT-P5 | P1 | dev-agent | blocked | none | VAD ENGINE: lazy Silero backend (`@ricky0123/vad-web`) + `PrivateWhisper` onset/silence gate injection (swap 2 booleans behind flag) + telemetry wiring | unit (mock VAD + RMS-fallback) + RMS-vs-VAD browser A/B | Needs dep install + **duplicate-ORT decision** (vad-web bundles its own onnxruntime-web vs existing @xenova ORT). Start after STT-P3 proof + ORT decision |
| STT-P1 | P0 | test-release-agent | ready | `main@f69cf44e` | Private current-main human/browser proof | setup consent, `__PRIVATE_TIMING__`, trust trace, `saveCandidate`, detail equality, filler rows, app-vs-drop-in/app-vs-Native deltas | Run after tree is free; include flag-OFF confirmation after STT-P3 scaffold |
| STT-N1 | P0 | test-release-agent | ready | `main@f69cf44e` | Native real Chrome mic re-proof | `saveCandidate`, formatter telemetry, trust trace, detail transcript, truecasing/readability | Run human mic proof when browser/human slot is available |
| STT-V4 | P1 | test-release-agent | done | `actions@de0e6f1e` / run `26966053435` | Private v4 containment proof | Browser path produced `saveCandidateReason=empty`, `selectedForSaveLength=0`, `finalWordCount=0`; no useful saved transcript | Recorded in Private report. Keep v4 off release A/B; future work only after browser decode branch proves non-empty output |
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

# SpeakSharp Current Workboard

This file is the live coordination board. Keep it small, current, and branch-based.
Backlog priority belongs in `product_release/BACKLOG.md`; evidence belongs in the STT reports.

## Integration Baseline

```text
INTEGRATION_MAIN: main@18299067
MERGE_LOCK: free
UPDATED_AT: 2026-06-04T17:05Z
UPDATED_BY: test-release-agent / Codex
```

`main` is the stable integration/evidence baseline. Agents should not experiment directly on
`main`. Work happens in independent branches/worktrees; only final integration is serialized.

## Active Branches And Proofs

| ID | Priority | Owner | Branch / SHA | Base SHA | Status | Purpose | Merge Gate / Next Action |
|---|---|---|---|---|---|---|---|
| STT-P5 | P0 | dev-agent | `dev/private-vad-silero-engine` | `551b1a80` | coding | VAD engine: lazy Silero backend (`@ricky0123/vad-web`) + `PrivateWhisper` onset/silence gate injection behind named flag | Branch must declare touched files, expected behavior, tests, telemetry, duplicate-ORT decision, and rollback plan. Merge only after local tests plus product/test approval for proof. |
| STT-P1 | P0 | test-release-agent | `test/proof-private-current-main` or workflow artifacts | `main@18299067` | ready | Private current-main human/browser proof | Capture setup consent, `__PRIVATE_TIMING__`, trust trace, `saveCandidate`, detail equality, filler rows, app-vs-drop-in/app-vs-Native deltas. |
| STT-N1 | P0 | test-release-agent | `test/proof-native-human` or human artifacts | `main@18299067` | ready | Native real Chrome mic re-proof | Capture `saveCandidate`, formatter telemetry, trust trace, detail transcript, truecasing/readability. |
| STT-V4 | P1 | test-release-agent | `actions@de0e6f1e` run `26966053435`; `actions@18299067` run `26966654691` | listed runs | done | Private v4 containment proof | Browser path produced empty `saveCandidate` / zero saved words in both runs. Keep v4 off release A/B; future work only after a browser decode branch proves non-empty output. |
| STT-C1 | P2 | test-release-agent | `test/proof-cloud-baseline` | latest main when resumed | deferred | Cloud richer baseline proof | Defer until Native/Private blockers move. Baseline only; keyterms/default-filler A/B is stopped. |

## Branch Status Values

```text
coding
ready
testing
blocked
merge-approved
merged
abandoned
done
```

## Required Branch Declaration

Every active branch or proof must state:

```text
Branch:
Base SHA:
Files touched:
Expected behavior change:
Tests run:
Proof needed:
Rollback plan:
```

## Worktree Model

Each agent should use an independent worktree or isolated branch whenever possible.

| Agent | Preferred workspace |
|---|---|
| dev-agent | dev-owned worktree / `dev/...` branches |
| test-release-agent | test-owned worktree / `test/...` or `docs/...` branches |
| integration | original repo or clean main worktree only |

Agents may test another agent's branch before it merges. That is preferred for risky STT changes:
build branch -> test branch/SHA -> approve or revise -> merge once.

## Merge Rules

- Only one merge to `main` at a time.
- Merge only branches with a task ID, clean diff, tests run, and proof attached or explicitly requested.
- Behavior-changing STT branches need product/test approval before merge.
- Report verdicts and release classifications are serialized; do not let two agents edit the same verdict section at once.
- After merge, update this board with the new `INTEGRATION_MAIN`, branch status, and next proof/action.

## Report Editing Protocol

| Agent | Permission |
|---|---|
| test-release-agent | Owns current verdicts, latest evidence, pass/fail classification |
| dev-agent | Appends only under `## DEV → TEST AGENT` or targeted handoff blocks |
| product owner | Owns priority, scope, release classification, paid/free positioning |

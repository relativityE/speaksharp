# Orch app v4.6.17 incremental review packet

**Status:** local source candidate published for independent review; not a complete C4 repair and not accepted or installed.

## Frozen source identity

- Source branch: `fix/rwt-orch-successor-6060194201`
- Source commit: `cc12ad4ed813c413ab87856aeb5bdca45917fa6d`
- Source tree: `bb48607aaf5881d5f09ef09e8fb79a310998dafe`
- Parent: `f1df24d3ed87f8eb9235e283b3449d2789ffd9db`
- Parent tree: `79b722398e026fb56d6a16d2286ee4f160ed0563`
- The complete source snapshot is in `source/`; its `TEST_RECEIPT.md` records the per-file SHA-256 values and test limits.

## Change in this increment

The app identifies itself as v4.6.17. PM can route an explicitly typed, read-only receipt/checkpoint/release request to CLI Dev for a task in `waiting` or `review`. The delivery binds the task owner, assignment generation, branch, worktree, HEAD and tree. It uses Claude Code Plan mode and does not grant edits, task mutation, publication, or lease actions. Stable action IDs deduplicate replay across enqueue, claim and restart; distinct authorized follow-ups remain distinct. Queue selection now claims atomically and returns uninvoked claims to the queue after restart.

This addresses the reported delivery-235 inability to bind a read-only checkpoint to a waiting task, plus duplicate same-action delivery in this narrow route. It does not claim live external actor receipt; worker output is only a reported signal.

## Verification

- 280 offline Python tests passed across 12 modules.
- Dashboard smoke passed; Python byte-compilation, schema JSON, shell syntax, and `git diff --check` passed.
- Five host/loopback tests remain HOLD pending the candidate-bound host lease and any required bind permission. One test that invokes the live GitHub CLI was excluded.
- No installation/restart or live migration, PR lifecycle operation, merge, deployment, or Production action was performed.

## Required review and remaining acceptance

Browser PM: review the exact source snapshot and report findings against this commit. CLI Dev continues the remaining package-1 repairs and the complete R01–R42/F01–F16 plus subsequent-findings closure matrix on the same isolated lineage. External notification transport and actual participating-agent delivery/receipt/action proof remain explicit blockers. All matrix items not directly fixed and evidenced by this increment remain OPEN; this packet is not an install candidate.

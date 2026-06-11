# Release Evidence Index

This directory stores dated release-proof artifacts and historical STT/UX reports.
It is an evidence archive, not the current coordination board.

## Current Truth Source

- Exhaustive backlog: `product_release/BACKLOG.md`
- Active work subset: `/private/tmp/ACTIVE_COORDINATION.md`
- Current release verdicts should point at the newest validated artifact and the
  commit SHA under test.

## Evidence Rules

- Dated JSON/Markdown files are retained as audit trail.
- Older reports may contain superseded conclusions; do not treat them as current
  release policy without checking `BACKLOG.md`.
- `test_reports/` files are historical running reports. They are useful for
  root-cause archaeology, but not authoritative after newer proof exists.
- `*.latest.json` and `*.latest.md` names are rolling snapshots. They are not
  stable proof references unless copied to a dated artifact.
- Any STT proof from mock auth, `localhost:5173`, bad fixtures, or wrong CDP tab
  is invalid for release evidence unless explicitly labeled mocked diagnostic.

## Inventory Snapshot

As of 2026-06-08:

- Tracked evidence files: 25
- Disk footprint: approximately 460 KB
- `test_reports/`: 4 historical Markdown reports
- Ignored local debris observed: `.DS_Store`

This folder is not a repository-size blocker. The release risk is stale or
contradictory interpretation, so new findings should update the backlog rather
than rewriting historical evidence.

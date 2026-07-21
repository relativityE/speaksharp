# Product Release Archive

> **HISTORICAL / SUPERSEDED.** Every file under `archive/` is retained as historical evidence only and is not current release truth. Commit SHAs cited in these files predate the **2026-07-15 attribution history sanitation**; map old→new SHAs via `../attribution-sanitation-crosswalk.md`.

This folder keeps historical release evidence, audits, rehearsal notes, and second-opinion packets.

Archived Markdown is useful context, but it is not current release truth. If an archived file conflicts with an active release document, use:

- `../RELEASE_STATUS.md` for current ship posture, blockers, and latest run IDs.
- `../RC_GATES.md` for maintained release gate definitions.
- `../RC_TEST_INVENTORY.md` for counted workflow/test inventory.
- `../SOFT_RELEASE_TESTER_INSTRUCTIONS.md` for current human tester steps.

Archive subfolders:

- `audits/`: forensic or point-in-time release audits.
- `recovery/`: superseded recovery doctrine retained for context.
- `rehearsals/`: historical soft-release rehearsal notes.
- `release-status/`: older go/no-go packets and release matrices.
- `stt/`: Native/Private/Cloud STT evidence packets and reviewer reports.
- `workflows/`: older workflow audits and overhaul trackers.

Archived in the 2026-07 SSOT reconciliation (product baseline `e9040464`, post-#1007/#1008):
- `stt/GATE_B_IDENTITY_FAILURE_ANALYSIS.md` — PostHog STT A/B identity failure, ✅ RESOLVED 2026-06-12 (root cause: PostHog bot-filtering of the automation browser, not an app defect).
- `audits/FREE_BASIC_PRO_AUDIT.md` — point-in-time Free/Basic/Pro audit (2026-05-27); Basic tier remains future-reserved.
- `audits/V4_UX_RELEASE_DISPOSITIONS.md` — closed reviewer dispositions for v4 UX items #75 / BL-3 (closed without code).

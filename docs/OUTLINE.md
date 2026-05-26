**Last Reviewed:** 2026-05-26
**Last Updated:** 2026-05-26

# SpeakSharp Documentation Outline

This file is a navigation map. It is not a release-status document.

## Current Source Of Truth

| Need | Use |
|---|---|
| Current go/no-go posture, blockers, latest run IDs | `product_release/RELEASE_STATUS.md` |
| Release doc inventory and archive pointers | `product_release/content_list.md` |
| Release gate definitions | `product_release/RC_GATES.md` |
| Counted test/workflow inventory | `product_release/RC_TEST_INVENTORY.md` |
| Human tester protocol | `product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md` |
| Product contract | `product_release/PRD.operational.md` |
| Architecture invariants | `product_release/ARCHITECTURE.operational.md` |
| Roadmap/risk tracker | `product_release/ROADMAP.operational.md` |

## Documentation Rules

- Do not copy current run IDs or current release decisions into multiple Markdown files.
- Update `product_release/RELEASE_STATUS.md` for changing release posture, blockers, and latest workflow evidence.
- Update operational docs only when stable product promises, architecture invariants, or risk categories change.
- Use `product_release/archive/` for historical packets, audits, reviewer notes, and superseded matrices.

## Historical Docs

The other files in `docs/` are archived references. They may lag the current codebase and launch process. They should point readers to the current `product_release/` sources rather than carry independent release state.

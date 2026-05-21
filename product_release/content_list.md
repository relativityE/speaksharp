**Owner:** [unassigned]
**Last Reviewed:** 2026-05-19
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-19

# Operational Release Artifacts (product_release/)

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-19)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `69ad3f13` (`Fix E2E final transcript projection`). |
| CI/Test Audit | PASS: GitHub run `25994869503` on `main`. |
| Production canary | PASS: GitHub run `26085357729` on `main` schedule; push canary `25994869500` also passed. |
| Edge Function deploy | PASS: GitHub run `25994869506` on `main`. |
| Scheduled soak | PASS: GitHub run `26083232887` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Tester instructions | Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`: fresh account, one-use 60-minute promo, Private STT first, Cloud optional, save/history check required. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

This directory contains the authoritative release control artifacts for the SpeakSharp production launch.

### 📜 Requirements & Invariants
- **[PRECEDENCE.md](./PRECEDENCE.md)**: The authoritative hierarchy of truth. Defines the precedence order for all release decisions.
- **[PRD.operational.md](./PRD.operational.md)**: The contract-oriented release gate. Defines user-visible guarantees and failure behaviors.
- **[ARCHITECTURE.operational.md](./ARCHITECTURE.operational.md)**: The structural invariants and authoritative sources of truth. Defines the non-negotiable technical rules.
- **[ROADMAP.operational.md](./ROADMAP.operational.md)**: The release risk tracker and launch triaging tool. Tracks launch-critical risks vs. deferred features.
- **[BACKLOG.md](./BACKLOG.md)**: Deferred known issues, tech debt, and workflow cleanup that should not interrupt active P0/P1 stabilization unless promoted.

### ✅ Verification Gates
- **[LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md)**: The runtime configuration verification gate. Ensures environment variables and secrets are correctly set.
- **[MANUAL_HARDWARE_VALIDATION.md](./MANUAL_HARDWARE_VALIDATION.md)**: Manual hardware/browser test protocols. Validates the "Hardware Blindspot" (Safari/Microphone/Bluetooth).
- **[LIVE_TEST_COMBINATIONS.md](./LIVE_TEST_COMBINATIONS.md)**: Production-browser validation matrix for tier, STT engine, cache state, browser, analytics, export, and benchmark combinations.
- **[GITHUB_WORKFLOWS_AUDIT.md](./GITHUB_WORKFLOWS_AUDIT.md)**: GitHub Actions workflow utility/status audit and repair order.
- **[RC_GATES.md](./RC_GATES.md)**: Release candidate gate definitions and evidence requirements.
- **[TESTER_RELEASE_MATRIX.md](./TESTER_RELEASE_MATRIX.md)**: Controlled tester matrix and evidence rollup.
- **[SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./SOFT_RELEASE_TESTER_INSTRUCTIONS.md)**: Copy/paste tester invite, Private-first test path, promo-code prerequisites, and feedback questions for the controlled soft release.

### 🛠️ Decision & Recovery
- **[RELEASE_READINESS.md](./RELEASE_READINESS.md)**: The master "Go/No-Go" gate for the production release decision.
- **[PUBLIC_LAUNCH_LEDGER.md](./PUBLIC_LAUNCH_LEDGER.md)**: Broad public-launch gate ledger and public evidence tracker.
- **[RELEASE_DECISION.md](./RELEASE_DECISION.md)**: Controlled tester release decision and caveats.
- **[RELEASE_RECOVERY.md](./RELEASE_RECOVERY.md)**: The launch-window forward-fix recovery playbook and emergency triage table.
- **[RECOVERY_STRATEGY.md](./RECOVERY_STRATEGY.md)**: Supporting recovery doctrine. If it conflicts with `RELEASE_RECOVERY.md`, use `RELEASE_RECOVERY.md` during launch.

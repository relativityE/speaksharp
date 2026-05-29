**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Operational Release Artifacts (product_release/)

> Directory inventory, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This directory contains both current release controls and historical evidence packets. The most important cleanup rule is simple: do not treat every file in this directory as equally authoritative.

## Canonical Current Artifacts

| Artifact | Current Role | Redundancy Status |
|---|---|---|
| [RELEASE_STATUS.md](./RELEASE_STATUS.md) | Current go/no-go posture, blockers, latest run IDs, and current STT release claims. | Single source of truth for changing release status. |
| [PRECEDENCE.md](./PRECEDENCE.md) | Defines truth hierarchy and conflict resolution. | Canonical. |
| [PRODUCT_FEATURES.operational.md](./PRODUCT_FEATURES.operational.md) | Working inventory of current capabilities, product gaps, future feature candidates, and product-claim boundaries. | Canonical product-feature inventory. |
| [RC_GATES.md](./RC_GATES.md) | Defines release gates, evidence freshness, SAST/DAST/SCA terms, and STT corpus policy. | Canonical procedure; current run state belongs in `RELEASE_STATUS.md`. |
| [RC_TEST_INVENTORY.md](./RC_TEST_INVENTORY.md) | Maps counted tests/workflows to RC gates. | Canonical inventory. |
| [SOFTWARE_QUALITY.operational.md](./SOFTWARE_QUALITY.operational.md) | Defines quality evidence sources, generated artifact rules, and interpretation of coverage/Lighthouse/bundle/flaky metrics. | Canonical quality-evidence interpretation. |
| [SERVICE_LEVELS.operational.md](./SERVICE_LEVELS.operational.md) | Defines SLO/SLC/SLA terms, soft-release service targets, stress/endurance evidence, and industry comparison. | Canonical service-level interpretation. |
| [SPEAKSHARP_SESSION_SCORE.operational.md](./SPEAKSHARP_SESSION_SCORE.operational.md) | Defines the research-backed proprietary 0.0-10.0 Session Score, references, weights, formula, and shared implementation source of truth. | Canonical score-model interpretation. |
| [SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./SOFT_RELEASE_TESTER_INSTRUCTIONS.md) | Copy/paste human tester protocol. | Canonical tester-facing copy. |
| [OPS_HEALTH_DASHBOARD.md](./OPS_HEALTH_DASHBOARD.md) | Simple vendor/tool health dashboard scope. | Canonical ops monitoring scope. |
| [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md) | Runtime secrets/config checklist. | Canonical for env/config only; snapshot is older and should not be used for ship status. |
| [PUBLIC_LAUNCH_LEDGER.md](./PUBLIC_LAUNCH_LEDGER.md) | Broad public-launch evidence ledger. | Canonical for broad public launch only, not soft tester status. |

## Historical Or Superseded Artifacts

These are intentionally retained because they contain useful evidence, root-cause analysis, or reviewer context. They are redundant as current launch-status sources.

| Artifact | Why It Is Historical/Superseded |
|---|---|
| [archive/release-status/RELEASE_READINESS.md](./archive/release-status/RELEASE_READINESS.md) | Older master gate that conflicts with `RELEASE_STATUS.md` and `RC_GATES.md`. |
| [archive/release-status/TESTER_RELEASE_MATRIX.md](./archive/release-status/TESTER_RELEASE_MATRIX.md) | Older tester evidence rollup. Current tester protocol lives in `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`; current go/no-go lives in `RELEASE_STATUS.md`. |
| [archive/release-status/LIVE_TEST_COMBINATIONS.md](./archive/release-status/LIVE_TEST_COMBINATIONS.md) | Older live-test matrix; useful context, but current STT posture lives in `RELEASE_STATUS.md`, `RC_GATES.md`, and `RC_TEST_INVENTORY.md`. |
| [archive/workflows/GITHUB_WORKFLOWS_AUDIT.md](./archive/workflows/GITHUB_WORKFLOWS_AUDIT.md) | Older workflow audit; current workflow health is visible through RC gates, CI/canary, and ops health. |
| [archive/audits/release_audit.md](./archive/audits/release_audit.md) | Forensic audit snapshot. Useful history, not current ship signal. |
| [archive/rehearsals/SOFT_RELEASE_REHEARSAL_BUG_INVENTORY.md](./archive/rehearsals/SOFT_RELEASE_REHEARSAL_BUG_INVENTORY.md) | Rehearsal bug ledger; many items are closed or superseded. |
| [archive/stt/](./archive/stt/) | Native/Private/Cloud reviewer reports and browser evidence packets. Cite them for rationale, not current release status. |

## Legacy Index

The sections below are kept for navigation, but the canonical/historical split above controls precedence.

### 📜 Requirements & Invariants
- **[PRECEDENCE.md](./PRECEDENCE.md)**: The authoritative hierarchy of truth. Defines the precedence order for all release decisions.
- **[PRD.operational.md](./PRD.operational.md)**: The contract-oriented release gate. Defines user-visible guarantees and failure behaviors.
- **[PRODUCT_FEATURES.operational.md](./PRODUCT_FEATURES.operational.md)**: The product feature inventory. Use it to vet current offering, product gaps, future feature candidates, and product-claim boundaries.
- **[SOFTWARE_QUALITY.operational.md](./SOFTWARE_QUALITY.operational.md)**: The software quality evidence guide. Defines how coverage, Lighthouse, bundle metrics, flaky counts, and generated quality artifacts should be interpreted.
- **[SERVICE_LEVELS.operational.md](./SERVICE_LEVELS.operational.md)**: The service-level guide. Defines SLO/SLC/SLA terminology, soft-release service targets, stress/endurance evidence, and current measurement gaps.
- **[SPEAKSHARP_SESSION_SCORE.operational.md](./SPEAKSHARP_SESSION_SCORE.operational.md)**: The proprietary coaching score guide. Defines score references, formula, labels, confidence levels, and the shared source of truth for Session, Analytics, and PDF surfaces.
- **[ARCHITECTURE.operational.md](./ARCHITECTURE.operational.md)**: The structural invariants and authoritative sources of truth. Defines the non-negotiable technical rules.
- **[ROADMAP.operational.md](./ROADMAP.operational.md)**: The release risk tracker and launch triaging tool. Tracks launch-critical risks vs. deferred features.
- **[BACKLOG.md](./BACKLOG.md)**: Deferred known issues, tech debt, and workflow cleanup that should not interrupt active P0/P1 stabilization unless promoted.

### ✅ Verification Gates
- **[LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md)**: The runtime configuration verification gate. Ensures environment variables and secrets are correctly set.
- **[MANUAL_HARDWARE_VALIDATION.md](./MANUAL_HARDWARE_VALIDATION.md)**: Manual hardware/browser test protocols. Validates the "Hardware Blindspot" (Safari/Microphone/Bluetooth).
- **[RC_GATES.md](./RC_GATES.md)**: Release candidate gate definitions and evidence requirements.
- **[SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./SOFT_RELEASE_TESTER_INSTRUCTIONS.md)**: Copy/paste tester invite, Private-first test path, trial-access prerequisites, and feedback questions for the controlled soft release.

### 🛠️ Decision & Recovery
- **[RELEASE_STATUS.md](./RELEASE_STATUS.md)**: The current go/no-go gate for controlled tester release decisions.
- **[PUBLIC_LAUNCH_LEDGER.md](./PUBLIC_LAUNCH_LEDGER.md)**: Broad public-launch gate ledger and public evidence tracker.
- **[RELEASE_RECOVERY.md](./RELEASE_RECOVERY.md)**: The launch-window forward-fix recovery playbook and emergency triage table.

### 🗄️ Historical Context
- **[archive/](./archive/)**: Historical evidence and superseded release packets, grouped by audits, recovery, rehearsals, release status, STT, and workflows.

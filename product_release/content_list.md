**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-07

# Operational Release Artifacts (product_release/)

This directory contains the authoritative release control artifacts for the SpeakSharp production launch.

### 📜 Requirements & Invariants
- **[PRECEDENCE.md](./PRECEDENCE.md)**: The authoritative hierarchy of truth. Defines the precedence order for all release decisions.
- **[PRD.operational.md](./PRD.operational.md)**: The contract-oriented release gate. Defines user-visible guarantees and failure behaviors.
- **[ARCHITECTURE.operational.md](./ARCHITECTURE.operational.md)**: The structural invariants and authoritative sources of truth. Defines the non-negotiable technical rules.
- **[ROADMAP.operational.md](./ROADMAP.operational.md)**: The release risk tracker and launch triaging tool. Tracks launch-critical risks vs. deferred features.

### ✅ Verification Gates
- **[LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md)**: The runtime configuration verification gate. Ensures environment variables and secrets are correctly set.
- **[MANUAL_HARDWARE_VALIDATION.md](./MANUAL_HARDWARE_VALIDATION.md)**: Manual hardware/browser test protocols. Validates the "Hardware Blindspot" (Safari/Microphone/Bluetooth).
- **[GITHUB_WORKFLOWS_AUDIT.md](./GITHUB_WORKFLOWS_AUDIT.md)**: GitHub Actions workflow utility/status audit and repair order.

### 🛠️ Decision & Recovery
- **[RELEASE_READINESS.md](./RELEASE_READINESS.md)**: The master "Go/No-Go" gate for the production release decision.
- **[RELEASE_RECOVERY.md](./RELEASE_RECOVERY.md)**: The launch-window forward-fix recovery playbook and emergency triage table.
- **[RECOVERY_STRATEGY.md](./RECOVERY_STRATEGY.md)**: Supporting recovery doctrine. If it conflicts with `RELEASE_RECOVERY.md`, use `RELEASE_RECOVERY.md` during launch.

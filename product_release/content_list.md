**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-06

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

### 🛠️ Decision & Recovery
- **[RELEASE_READINESS.md](./RELEASE_READINESS.md)**: The master "Go/No-Go" gate for the production release decision.
- **[RECOVERY_STRATEGY.md](./RECOVERY_STRATEGY.md)**: The service restoration and forward-fix playbook. Defines procedures for rapid recovery and data integrity.

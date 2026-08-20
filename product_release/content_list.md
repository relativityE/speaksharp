# Product Release — Document Index

> Directory index, **not** release status. Current ship/deployment posture, blockers, and run IDs live only in [RELEASE_STATUS.md](./RELEASE_STATUS.md). Precedence on conflict: [PRECEDENCE.md](./PRECEDENCE.md).
> Product baseline at last reconcile: `main` `65e58a62` (the #1010 CORS config fix on top of the `e9040464` #1007/#1008 UX milestone). Not every file here is equally authoritative — the sections below control precedence.

## Current SSOT / status
- [RELEASE_STATUS.md](./RELEASE_STATUS.md) — current go/no-go, deployment posture, latest run IDs.
- [ACTIVE_COORDINATION.md](./ACTIVE_COORDINATION.md) — current working board (open draft + current/next task).
- [BACKLOG.md](./BACKLOG.md) — unfinished work only (completion lives in git history).
- [PRECEDENCE.md](./PRECEDENCE.md) — truth hierarchy / conflict resolution.

## Developer breadcrumb map
- [CODEBASE_MAP.md](./CODEBASE_MAP.md) — product intent → code path → protecting test → doc. Start here as a new developer.

## Product / architecture contracts
- [PRD.operational.md](./PRD.operational.md) — user-visible guarantees and failure behaviors.
- [PRODUCT_FEATURES.operational.md](./PRODUCT_FEATURES.operational.md) — capability inventory + product-claim boundaries.
- [ARCHITECTURE.operational.md](./ARCHITECTURE.operational.md) — structural invariants + authoritative sources of truth.
- [STT_BASELINE_CONTRACTS.operational.md](./STT_BASELINE_CONTRACTS.operational.md) — vendor/reference STT behavior + proof tests.
- [SPEAKSHARP_SESSION_PROGRESS.operational.md](./SPEAKSHARP_SESSION_PROGRESS.operational.md) — the canonical Session Progress contract (Part A: approved Personal Progress direction; Part B: legacy 0.0–10.0 score implementation on a staged retirement path).
- [SERVICE_LEVELS.operational.md](./SERVICE_LEVELS.operational.md) — SLO/SLC/SLA terms and targets.
- [SOFTWARE_QUALITY.operational.md](./SOFTWARE_QUALITY.operational.md) / [QUALITY_METRICS.md](./QUALITY_METRICS.md) — quality-evidence interpretation + digest.

## Release / test procedures
- [RC_GATES.md](./RC_GATES.md) — release gate definitions + evidence requirements.
- [RC_TEST_INVENTORY.md](./RC_TEST_INVENTORY.md) — counted tests/workflows mapped to gates.
- [MANUAL_HARDWARE_VALIDATION.md](./MANUAL_HARDWARE_VALIDATION.md) — manual hardware/browser protocols.

## Operator / security runbooks
- [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md) / [ENV_INVENTORY.md](./ENV_INVENTORY.md) — runtime env/secrets/config (env only, not ship status).
- [SECRET_ROTATION_RUNBOOK.md](./SECRET_ROTATION_RUNBOOK.md) · [PAID_OPS_HARDENING_RUNBOOK.md](./PAID_OPS_HARDENING_RUNBOOK.md) · [RELEASE_RECOVERY.md](./RELEASE_RECOVERY.md) — rotation, paid-ops, recovery.
- [OPS_HEALTH_DASHBOARD.md](./OPS_HEALTH_DASHBOARD.md) — vendor/tool health scope.
- [SCA_EXCEPTIONS.md](./SCA_EXCEPTIONS.md) — dependency-scanner exceptions.

## Tester / operator copy
- [SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./SOFT_RELEASE_TESTER_INSTRUCTIONS.md) — plain-language tester guide (what you send testers).
- [INTERNAL_TEST_PROTOCOL.md](./INTERNAL_TEST_PROTOCOL.md) — operator/dev acceptance protocol (not for testers).

## Public launch (broad, separately gated)
- [PUBLIC_LAUNCH_LEDGER.md](./PUBLIC_LAUNCH_LEDGER.md) — broad public-launch evidence ledger (not soft-tester status).

## Historical evidence / lower-authority (retained, cite for rationale not current status)
- [attribution-sanitation-crosswalk.md](./attribution-sanitation-crosswalk.md) — old→new SHA crosswalk (2026-07-15 history sanitation).
- [ENTITLEMENT_PRO_LIMIT_EVIDENCE.md](./ENTITLEMENT_PRO_LIMIT_EVIDENCE.md) — entitlement audit evidence (has an open ops-verification item; overlaps active BACKLOG P1.3).
- [RELEASE_CLOSEOUT_LEDGER.md](./RELEASE_CLOSEOUT_LEDGER.md) · [ROADMAP.operational.md](./ROADMAP.operational.md) — older closeout/risk trackers (stale; superseded by BACKLOG + RELEASE_STATUS; archiving deferred pending cross-reference cleanup).
- [PRIVATE_STT_ACCURACY_LEVERS.md](./PRIVATE_STT_ACCURACY_LEVERS.md) · [stt-perf-proof-protocol.md](./stt-perf-proof-protocol.md) — STT accuracy/perf reference material.
- [archive/](./archive/) — historical evidence and superseded packets (audits, recovery, rehearsals, release-status, stt, workflows). See [archive/README.md](./archive/README.md).

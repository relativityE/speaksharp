**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-15

# Operational Precedence Hierarchy

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

This document defines the authoritative hierarchy of truth and priority for SpeakSharp. In the event of a conflict between documentation, code, or stakeholder requests during the launch window, this hierarchy MUST be followed strictly.

---

## 🏛️ The Hierarchy of Truth

| Level | Domain | Scope |
| :--- | :--- | :--- |
| **1** | **User Trust & Legal Promises** | PRD + Billing + Privacy + Security |
| **2** | **Runtime Truth** | Deployed Code + DB Schema + Edge Functions + Env Config |
| **3** | **Data Integrity Invariants** | ACID Compliance + Atomicity + Schema Consistency |
| **4** | **Security Invariants** | RLS + JWT Validation + CSRF + Rate Limiting |
| **5** | **Operational Survivability** | Availability + Latency + Error Recovery |
| **6** | **Tests/CI Evidence** | E2E + Unit + Integration + Static Analysis |
| **7** | **Architecture Intent/Docs** | ARCHITECTURE.md + Design Docs |
| **8** | **Roadmap/Status/Triage** | Current Status + Backlog + Triage Notes |

---

## 🧠 Strategic Rationale

### 1. Data Integrity vs. Operational Survivability
**Principle**: Silent data corruption is categorically worse than a system crash.
- **Rule**: If a feature cannot guarantee data integrity (e.g., usage tracking atomicity), it MUST be disabled or fail-closed, even if this results in a service outage (Operational Survivability).
- **Goal**: Preserve the trust established in Level 1.

### 2. Runtime Truth as the Primary Anchor
**Principle**: The system is what it *does*, not what we *say* it does.
- **Rule**: If `ARCHITECTURE.md` (Level 7) says a service is environment-agnostic, but the Deployed Code (Level 2) contains test-specific branches, the reality is the code. The audit MUST treat the doc as "Drift" and the code as "Vulnerability."

### 3. Separation of Runtime Truth and Survivability
**Principle**: Identifying the state of the system is distinct from the system's ability to recover.
- **Rule**: We first establish exactly what is happening in the runtime (Level 2) before attempting to restore survivability (Level 5).

---

## 🚦 Enforcement Protocol

### During "Go/No-Go" Decision
- Any violation of Level 1 (User Trust) or Level 3 (Data Integrity) is an **AUTOMATIC NO-GO**.
- Violations of Level 7 (Architecture Intent) are "Launch Polish" unless they directly cascade into Levels 1-4.

### During P0 Incident Response
- All recovery actions (Level 5) MUST respect the Data Integrity invariants (Level 3).
- **Shortcut Prohibited**: Never bypass a Security Invariant (Level 4) to restore Survivability (Level 5).

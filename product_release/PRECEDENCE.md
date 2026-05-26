**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Operational Precedence Hierarchy

> Precedence contract, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

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

## Canonical Release Artifact Rule

Release status may only be taken from `RELEASE_STATUS.md`.

Older reports, bug inventories, second-opinion packets, and forensic audits remain useful evidence, but they are historical. If they conflict with `RELEASE_STATUS.md`, current workflow results, or deployed runtime behavior, the newer canonical source wins.

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

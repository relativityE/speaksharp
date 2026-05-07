**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-06

# Release Readiness Checklist (Launch Gate)

This document serves as the final authoritative gate for the SpeakSharp production launch. All P0 and P1 items must be marked ✅ before the verdict transitions to **READY**.

## 🔴 Current Verdict: BLOCKED

---

## 🛠️ Critical Launch Gates (P0)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **G1** | **Fail-Closed Usage Logic** | Financial | 🔴 **BLOCKED** |
| **G2** | **Usage-Aware Token Issuance** | Revenue | 🔴 **BLOCKED** |
| **G3** | **Non-Negative Duration Constraint**| Integrity | 🔴 **BLOCKED** |
| **G4** | **Promo Rate Limiting** | Security | 🔴 **BLOCKED** |
| **G5** | **Production Secret Audit** | Security | 🟡 IN REVIEW |

---

## 📈 Quality & Performance Gates (P1)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **Q1** | **Pro Session Warning UI** | UX | 🔴 **BLOCKED** |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🔴 **BLOCKED** |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (91) |
| **Q4** | **Lighthouse Perf Score > 95**| Performance| ✅ READY (96) |

---

## 🏗️ Post-Launch Operational Debt (P2)

| ID | Task | Impact | Status |
| :--- | :--- | :--- | :--- |
| **D1** | **Purge Test-Aware Branches** | Architectural Integrity | 🔴 PLANNED |
| **D2** | **WPM Rolling Window Fix** | Logic Accuracy | 🔴 PLANNED |
| **D3** | **Sync PRD Coverage Table** | Transparency | 🔴 PLANNED |

---

## 📋 Evidence Registry

- **Audit Report**: [release_audit.md](./release_audit.md)
- **Architecture**: [ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- **Product Specs**: [PRD.md](../docs/PRD.md)
- **Infrastructure Probe**: [infra.probe.e2e.spec.ts](../tests/e2e/infra.probe.e2e.spec.ts)

---

## ✍️ Auditor Final Comments
*The core transcription technology is production-grade. The blocking issues are concentrated in the 'Economic Perimeter'—the logic that protects the business from cost overruns and abuse. Resolving these 4-5 backend items will transition the product from a liability to a launchable asset.*

**Owner:** [unassigned]
**Last Reviewed:** 2026-02-05

# 📚 SpeakSharp Documentation Outline

This outline explains the structure and purpose of all project documentation.
It serves as a **map** to help developers, contributors, and stakeholders quickly find the right information.

---

## 🚨 Documentation Maintenance Mandate 🚨

**This is a strict requirement for all contributors, including AI agents.**

With every commit, you **must** review the following eight documents to ensure they are synchronized with your changes. If no updates are needed for a file, you must still verify it. This is not optional.

1.  `README.md`
2.  `AGENTS.md`
3.  `docs/OUTLINE.md` (this file)
4.  `docs/PRD.md`
5.  `docs/ARCHITECTURE.md`
6.  `docs/ROADMAP.md`
7.  `docs/CHANGELOG.md`

This process ensures our documentation remains a reliable Single Source of Truth (SSOT).

---

## ✅ Final Buckets & What Goes Where

This section defines the canonical location for every type of documentation.

*   **[`README.md`](../README.md)**
    *   **Content**: Entry point, quick start, repo structure, high-level links.
    *   **Best fit for**: Installation/setup guides, onboarding notes.

*   **[`AGENTS.md`](../AGENTS.md)**
    *   **Content**: Overview of all AI agents, their roles, capabilities, and integrations.
    *   **Best fit for**: Agent-specific instructions, capabilities, and limitations.

*   **[`OUTLINE.md`](./OUTLINE.md)** (this file)
    *   **Content**: Map of all docs, cross-links, and this content strategy.
    *   **Best fit for**: Index of documentation, navigation guide.

*   **[`PRD.md`](./PRD.md)**
    *   **Content**: Vision, goals, success metrics, requirements, user stories, product-level revision history.
    *   **Best fit for**:
        *   **Testing strategy** (from a *product quality requirement* perspective).
        *   Any product constraints or acceptance criteria related to testing.

*   **[`ARCHITECTURE.md`](./ARCHITECTURE.md)**
    *   **Content**: Current system design snapshot.
    *   **Best fit for**:
        *   **Testing framework/tools in use** (technical implementation details, not strategy).
        *   Integration points for QA/test automation in the system.

*   **[`ROADMAP.md`](./ROADMAP.md)**
    *   **Content**: Forward-looking milestones, phases, features in pipeline.
    *   **Best fit for**:
        *   Planned **testing improvements** (e.g., “Expand coverage to 90% in Phase 2”).
        *   Planned **tech debt paydowns** tied to roadmap deliverables.

*   **[`CHANGELOG.md`](./CHANGELOG.md)**
    *   **Content**: Rolling history of major changes.
    *   **Best fit for**:
        *   Timestamped note when **tech debt items are closed**.
        *   Logging when **known issues** are resolved.
        *   Summaries of major testing shifts (e.g., “Added end-to-end testing suite”).
---

## ⚖️ Rule of Thumb for Ambiguous Leftovers

Use this guide to categorize documentation that doesn't neatly fit into one bucket.

*   **Testing (Strategy vs. Execution):**
    *   Strategy → `PRD.md`
    *   Framework/implementation → `ARCHITECTURE.md`
    *   Progress/closure → `CHANGELOG.md`

*   **Tech Debt:**
    *   Future cleanup work → `ROADMAP.md`
    *   Closure → `CHANGELOG.md`

*   **Known Issues:**
    *   Active → temporarily logged in `PRD.md` (as constraints/risks)
    *   Resolved → `CHANGELOG.md`

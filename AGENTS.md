# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment Rules

* ⏱️ **7-Minute Timeout Constraint**
  Every script or command must complete within 7 minutes. If longer, split the work into multiple runs.

* ❌ **Avoidance of CI Scripts**
  You may see scripts like `./ci-run-all.sh`. These are **forbidden** in this environment due to timeout risk.

  * Instead, run targeted unit, integration, or E2E tests individually.
  * Do not attempt to run the full CI pipeline locally.

* ⚠️ **Recovery Script Warning**
  `./vm-recovery.sh` may reset or alter the dev environment.
  👉 **Always ask the user before running it.** Never execute without explicit approval.

---

## ⚡ Quick Reference – Non-Negotiable Rules

1. ✅ **Status & Pre-Check-In** – Run lint, type check, and unit/E2E tests before any commit or PR.
2. 📄 **Documentation Before Review** – Update PRD, Architecture, Roadmap, and Changelog before review.
3. ❌ **No Code Reversals Without Consent** – Never undo or revert user work without approval.
4. ⏱️ **Status Updates** – Provide updates every 5 minutes if tasks run long.

Think like a **senior engineer**: safe, evidence-based, and long-term decisions.

---

## 🚦 Pre-Check-In List (MANDATORY)

You must complete all items **before any commit/PR**:

1. **Lint & Type Check**

   * Run `pnpm lint:fix` and `pnpm type-check`.
   * All errors and warnings must be resolved.

2. **Run Tests**

   * Run `pnpm test:unit` and targeted E2E tests.
   * Do **not** run `./ci-run-all.sh` in this environment.

3. **Documentation**

   * Update: `README.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.
   * Ensure alignment with SSOT rules.

4. **Traceability**

   * Link every change to PRD/Architecture/Roadmap.

5. **Security & Dependencies**

   * Run `pnpm audit` after dependency changes.
   * Document decisions in `ARCHITECTURE.md`.

6. **Branch & Commit Hygiene**

   * Branch names: `feature/...`, `fix/...`, `chore/...`.
   * Commit messages summarize actual changes.

7. **Final User Confirmation**

   * Ask:

     > "All checks complete. May I run the validation script (`./ci-run-all.sh`) or recovery script (`./vm-recovery.sh`)?"
   * Proceed **only after explicit approval**.

---

## 🚨 Absolute Non-Negotiables

* ❌ **Never run `./ci-run-all.sh` or `./vm-recovery.sh` without asking first.**
* ❌ **Never exceed the 7-minute runtime per command.**
* ❌ **Never undo or destroy user work without consent.**
* 📄 **Docs before code review — always.**
* 🔐 **Security first — no leaks, no unsafe shortcuts.**
* 🧩 **No unapproved dependencies.**
* 💰 **No cost-incurring services without consent.**
* 🧠 **Think like a senior engineer — long-term, safe, evidence-driven.**

---

## 🔍 Task Workflow

1. **Contextual Review** – Read docs in `/docs` before acting.
2. **Codebase Deep Dive** – Inspect actual code, not assumptions.
3. **Strategic Consultation** – Present root cause + 2–3 solution paths before major changes.
4. **Implementation** – Follow coding standards + architecture principles.
5. **Validation** – Complete Pre-Check-In List.
6. **Submission** – Ask user before running any final validation or recovery scripts.

---

## 📢 Escalation Protocol

If blocked:

* Summarize the problem.
* List what you tried.
* Provide hypotheses.
* Offer 2–3 solution paths with pros/cons.
* **Pause and wait for user guidance.**

---

✅ This version:

* Explicitly **forbids `ci-run-all.sh` in dev**.
* Makes **user consent mandatory** before `./vm-recovery.sh`.
* Embeds the **7-minute timeout constraint** into every step.
* Reorganizes into a **tight checklist-style format** to minimize ambiguity.

---

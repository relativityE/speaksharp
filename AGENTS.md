# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment Rules

* ⏱️ **7-Minute Timeout Constraint**
  Every script or command must complete within 7 minutes. If longer, split the work into multiple runs.

### ⚠️ Environment Stabilization (Updated)

* **Do not run `./env-stabilizer.sh` automatically before every task.**
  Use it **only when needed**, based on observed instability:

  **Signs that it may be necessary:**

  * Tests hang or timeout unexpectedly
  * Vite, Node, or Playwright processes are stuck or unresponsive
  * Port conflicts on 5173 or 9323
  * Cache corruption or dependency errors

* **Recommended workflow:**

  1. Attempt the task normally.

  2. If issues occur (sluggishness, failures, zombie processes), run:

     ```bash
     ./env-stabilizer.sh
     ```

  3. Retry the task after stabilization.

  4. If still failing, escalate **before** using more aggressive recovery (`./vm-recovery.sh`).

* **Quick sanity check:** Ensure Vite starts and critical ports are free after running `./env-stabilizer.sh`.

---

📖 **Read the README.md Before Running Anything**
The agent must read README.md to understand the correct setup and workflow. This prevents mistakes like using `pnpm install` directly instead of the required `pnpm setup:dev`.

* ✅ **Local Audit Script (Read From README.md)**
  Always use the **designated local audit script** (documented in `README.md`) to run lint, type-checking, and unit/E2E tests.

  * Do **not** invent your own runner.
  * If the README’s script fails or is missing, stop and escalate.
  * Current runner: `./scripts/e2e-run.sh` (check README.md first).

* ⚠️ **Recovery Scripts Hierarchy**

  1. Run `./env-stabilizer.sh` **only if needed**.
  2. If stability still fails, **ask before running `./vm-recovery.sh`**. Never execute without explicit approval.

---

## ⚡ Quick Reference – Non-Negotiable Rules

1. ✅ **Environment Stabilization** – Run `./env-stabilizer.sh` **selectively**, only when signs of instability are present.
2. ✅ **Codebase Context**

   * Run `pnpm setup:dev` (❌ never `pnpm install`).
   * Inspect `/src`, `/tests`, `/contexts`, and `/docs` before acting.
   * Read `README.md` first to ground yourself in current scripts and workflows.
3. ❌ **No Code Reversals Without Consent** – Never undo or revert user work without approval.
4. ⏱️ **Status Updates** – Provide updates every 5 minutes if tasks run long.

Think like a **senior engineer**: safe, evidence-based, long-term stable.

---

## 🚦 Pre-Check-In List (MANDATORY)

Complete all items **before any commit/PR**:

1. **Run Local Audit Script**

   * Use the script defined in `README.md` (`./test-audit.sh`).
   * It runs linting, type-checking, and core unit tests.
   * All errors must be resolved.

2. **Documentation**

   * Update: `README.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.
   * Ensure alignment with SSOT rules.

3. **Traceability**

   * Link every change to PRD/Architecture/Roadmap.

4. **Security & Dependencies**

   * Run `pnpm audit` after dependency changes.
   * Document in `ARCHITECTURE.md`.

5. **Branch & Commit Hygiene**

   * Branches: `feature/...`, `fix/...`, `chore/...`.
   * Commit messages summarize actual changes.

6. **Final User Confirmation**
   Ask:

   > "All checks complete. May I run the environment recovery script (`./vm-recovery.sh`)?"

   Proceed **only after explicit approval**.

---

## 🚨 Absolute Non-Negotiables

* ❌ Never run `./vm-recovery.sh` without asking first.
* ❌ Never exceed the 7-minute runtime per command.
* ❌ Never undo or destroy user work without consent.
* 📄 Docs before code review — always.
* 🔐 Security first — no leaks, no unsafe shortcuts.
* 🧩 No unapproved dependencies.
* 💰 No cost-incurring services without consent.
* 🧠 Think like a senior engineer — long-term, safe, evidence-driven.

---

## 🔍 Task Workflow

0. **Contextual Review** – Read `/docs` and `README.md` before acting.
1. **Stabilize** – Run `./env-stabilizer.sh` **only if signs of instability appear**.
2. **Grounding** – Read `README.md` and `/docs`.
3. **Codebase Deep Dive** – Inspect actual code, not assumptions.
4. **Strategic Consultation** – Present root cause + 2–3 solution paths before major changes.
5. **Implementation** – Follow coding standards + architecture principles.
6. **Validation** – Complete Pre-Check-In List.
7. **Submission** – Ask user before running any recovery scripts.

---

## 📢 Escalation Protocol

If blocked:

* Summarize the problem.
* List what you tried.
* Provide hypotheses.
* Offer 2–3 solution paths with pros/cons.
* **Pause and wait for user guidance.**

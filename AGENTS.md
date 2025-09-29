# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment Rules

* ⏱️ **7-Minute Timeout Constraint**
  Every script or command must complete within 7 minutes. If longer, split the work into multiple runs.

* ❌ **Avoidance of CI Scripts**
  The script `./ci-run-all.sh` is **forbidden** in this environment due to timeout risk.

  * Instead, use the new local audit script: `./test-audit.sh`. This script is designed to run quickly and provide fast feedback.
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

1. **Run Local Audit Script**

   * Run `./test-audit.sh`.
   * This script will run linting, type-checking, and core unit tests in a fail-fast sequence.
   * All errors must be resolved.

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

## 🤖 Debugging E2E Test Failures

The E2E test suite uses a custom Playwright fixture (`/tests/setup/verifyOnlyStepTracker.ts`) that provides robust, automated logging for CI environments where filesystem access is unavailable. You do not need to manually add logging to tests.

When a test fails, analyze the CI logs for the following markers to diagnose the issue:

1.  **`---STEP_START---{Step Name}---STEP_END---`**
    *   This marker indicates the beginning of an automated step (e.g., `Click`, `Fill`, `Goto`, `Expect`). These are logged for every action.

2.  **`---LAST_SUCCESSFUL_STEP---{Step Name}---LAST_SUCCESSFUL_STEP_END---`**
    *   This marker **only appears on test failure**.
    *   It tells you the last action that completed successfully. The error occurred on the *next logical step* in the test code. This is your primary clue for locating the failure.

3.  **`[browser]`, `[pageerror]`, `[requestfailed]`**
    *   These prefixes capture console logs, runtime errors, and failed network requests from the browser, providing context for the failure.

4.  **`---DEBUG_SCREENSHOT_BASE64_START---{Base64 String}---DEBUG_SCREENSHOT_BASE64_END---`**
    *   This marker **only appears on test failure**.
    *   It contains a base64-encoded PNG of the page at the moment of failure. You can parse this string to visually inspect the state of the UI without needing to access a saved file.

### Workflow for Debugging a Failed Test:
1.  Scroll to the bottom of the test log and find the `---LAST_SUCCESSFUL_STEP---` marker.
2.  Open the corresponding test file and locate the code for that step.
3.  The failure occurred in the code immediately following that step.
4.  Examine the surrounding logs for page errors or failed requests that might explain why the next step failed.
5.  If necessary, parse the base64 screenshot to see what the UI looked like at the time of the error.

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

# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment Rules (Non-Negotiable)

1. ⏱️ **7-Minute Timeout Constraint**

   * Every script or command must complete within 7 minutes.
   * If longer, split the work into smaller runs.

2. ❌ **No Background Execution**

   * **Absolutely forbidden:** Running tasks in the background (e.g., with `&`, `nohup`, detached sessions).
   * All tasks must run in the **foreground** so the user can see **real-time progress, errors, and logs**.
   * Violation of this rule is unacceptable.

3. 📢 **Full Debug Logging Requirement**

   * During **testing or bug investigation**, all debug logs **must be enabled** and shown in real time.
   * Never hide logs, buffer logs, or defer log output.
   * Debug logs are required for efficient collaboration with the user.

4. ⚠️ **Recovery Script Warning**

   * `./vm-recovery.sh` may reset or alter the dev environment.
   * **Always ask the user before running it. Never execute without explicit approval.**

---

## ⚡ Mandatory Testing Rules

1. ✅ **Default Test Command**

   * Always run:

     ```bash
     ./test-audit.sh
     ```
   * This runs linting, type-checking, and core unit tests in a fail-fast sequence.

2. ⚠️ **If Debugging or Timeout Issues Occur**
   Run the commands inside `test-audit.sh` individually:

   ```bash
   pnpm typecheck
   pnpm build
   pnpm test:unit:full
   ```

3. 🧪 **End-to-End Tests**

   * Run only when **explicitly requested**:

     ```bash
     pnpm test:e2e
     ```
   * ⚠️ These tests are known to be unstable and may time out. They are **not valid for verification**.

---

## 🚦 Pre-Check-In Checklist (MANDATORY)

Before any commit or PR:

1. **Run Tests** – Execute `./test-audit.sh` (or its components individually if debugging).
2. **Documentation** – Update:

   * `README.md`
   * `docs/OUTLINE.md`
   * `docs/PRD.md`
   * `docs/ARCHITECTURE.md`
   * `docs/ROADMAP.md`
   * `docs/CHANGELOG.md`
3. **Traceability** – Link every change to PRD/Architecture/Roadmap.
4. **Security & Dependencies** – Run `pnpm audit` after dependency changes. Document outcomes in `ARCHITECTURE.md`.
5. **Branch & Commit Hygiene** –

   * Branch names: `feature/...`, `fix/...`, `chore/...`.
   * Commit messages must summarize **actual changes** clearly.
6. **Final Confirmation** – Always ask the user:

   > "All checks complete. May I run the validation (`./test-audit.sh`) or recovery script (`./vm-recovery.sh`)?"

   * Proceed **only with explicit approval**.

---

## 🧠 Senior Engineer Standards

All agents must operate at the level of a **Senior Software Engineer Fellow**:

1. 🔍 **Expert Debugging Skills**

   * Always perform a **deep dive into the actual code**.
   * Do not guess. All options must be informed by the repository.

2. 🎯 **Present Options, Not Just Answers**

   * For any non-trivial issue, present **2–3 solution paths**.
   * Each must include **pros, cons, and tradeoffs**.

3. 📊 **Evidence-Based Reasoning**

   * Use logs, code inspection, and tests as evidence.
   * Never propose changes without justification.

4. 🧩 **Safe, Long-Term Decisions**

   * Prioritize maintainability, clarity, and stability.
   * Shortcuts or unsafe hacks are forbidden.

---

## 🚨 Absolute Non-Negotiables

* ❌ Never run tasks in the background.
* ❌ Never suppress or hide logs during testing/debugging.
* ❌ Never run `./vm-recovery.sh` without explicit approval.
* ❌ Never exceed the 7-minute runtime per command.
* ❌ Never undo or destroy user work without consent.
* 📄 Always update documentation before review.
* 🔐 Always prioritize security (no leaks, no unsafe shortcuts).
* 🧠 Always think and act like a **Senior Engineer**.

---

## 🔍 Task Workflow

1. **Contextual Review** – Read docs in `/docs` before acting.
2. **Codebase Deep Dive** – Inspect actual code, not assumptions.
3. **Strategic Consultation** – Present root cause + multiple solution paths.
4. **Implementation** – Follow standards + architecture principles.
5. **Validation** – Run `./test-audit.sh` (or its components individually).
6. **Submission** – Request explicit user approval before final validation or recovery.

---

## 📢 Escalation Protocol

If blocked:

* Summarize the problem clearly.
* Show what you tried (with logs/evidence).
* Provide hypotheses.
* Offer 2–3 solution paths with pros/cons.
* Pause and wait for user guidance.

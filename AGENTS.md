**Owner:** [unassigned]
**Last Reviewed:** 2025-10-19

# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment & Workflow Rules

### 1. Mandatory Pre-flight Check (Start Here)

To address persistent environment instability, a new automated pre-flight check has been created. This is now the **mandatory** first step for all sessions.

**Your first action in every session MUST be to execute this script:**

```bash
./scripts/preflight.sh
```

This script will:
1.  Terminate any lingering processes.
2.  Install all dependencies (`pnpm install`).
3.  Install all required browser binaries (`pnpm exec playwright install --with-deps`).
4.  Run a smoke test to verify the environment is stable.

Do not proceed until this script completes successfully.

### 2. The Local Audit Script (Single Source of Truth for Testing)

The primary runner for all local validation is `./test-audit.sh`. This script is the SSOT for running lint, type-checking, and all tests.

*   **Always use this script for validation.** Do not invent your own runners or call `pnpm test` or `pnpm lint` directly for final validation.
*   The audit script automatically runs the `preflight.sh` check, ensuring a stable environment for the test run.

### 3. Selective Use of `env-stabilizer.sh`

The `./env-stabilizer.sh` script is a powerful tool for recovering a broken environment, but it should be used selectively.

*   Run `preflight.sh` first.
*   If instability persists (e.g., hanging tests, port conflicts), then run `./env-stabilizer.sh`.
*   Escalate to the user **before using** `./vm-recovery.sh`.
*   Always read `README.md` to understand setup, workflow, and scripts.

### 4. Handling Silent Crashes in E2E Tests

The E2E test environment has a critical incompatibility with the `onnxruntime-web` library, which is used for on-device speech recognition. This library is loaded via a dynamic import.

*   **Symptom:** When a test runs that triggers this import, the browser will crash instantly and silently, resulting in a blank screenshot and no console or network errors. This is a fatal, untraceable error.
*   **Solution:** A source-code-level guard is in place. A `window.TEST_MODE = true` flag is injected by the test setup. The application code (`src/services/transcription/TranscriptionService.ts`) checks for this flag and conditionally skips the dynamic import of the module that causes the crash.
*   **Implication:** Do not remove this flag or the corresponding check in the application code. If you encounter a similar silent crash, investigate for other dynamic imports of heavy, WebAssembly-based libraries.

---

## ⚡ Quick Reference – Non-Negotiable Rules

1.  ✅ **Pre-flight Check** – Always start with `./scripts/preflight.sh`.
2.  ✅ **Codebase Context** – Inspect `/src`, `/tests`, `/docs` before acting.
3.  ❌ **No Code Reversals Without Consent** – Never undo user work.
4.  ⏱️ **Timeout Constraint** – Every command must complete within 7 minutes.
5.  ✅ **Approved Scripts** – Use the following `package.json` scripts when necessary for targeted tasks (but use `./test-audit.sh` for full validation):

   ```json
   "dev": "vite",
   "build": "vite build",
   "preview": "vite preview",
   "lint": "eslint 'src/**/*.{js,jsx,ts,tsx}' 'tests/**/*.{js,jsx,ts,tsx}' --report-unused-disable-directives --max-warnings 0",
   "typecheck": "tsc --build --verbose",
   "test": "pnpm test:unit:full",
   "test:ci": "./test-audit.sh all",
   "test:audit": "./test-audit.sh",
   "test:unit:full": "vitest run --coverage",
   "test:e2e": "playwright test --reporter=list",
   "test:e2e:smoke": "playwright test --grep @smoke"
   ```
6. ✅ **Foreground Logging** – All E2E tasks must run in the foreground with live logs (`tee`) for traceability.

---

## 🔍 Task Workflow

1. **Contextual Review** – Read `/docs` and `README.md` before acting.
2. **Stabilize Environment** – Run `./env-stabilizer.sh` only if instability signs appear.
3. **Grounding** – Review current workflows, scripts, and audit runners.
4. **Codebase Deep Dive** – Inspect actual code, not assumptions.
5. **Strategic Consultation** – Present root cause + 2–3 solution paths **before major changes**.
6. **Implementation** – Follow coding standards, architecture principles, and scripts.
7. **Validation** – Complete Pre-Check-In List (see below).
8. **Submission** – Ask user **before running recovery scripts** (`./vm-recovery.sh`).

---

## 🚦 Pre-Check-In List (MANDATORY)

*Complete before any commit or PR:*

1.  **Run Local Audit Script**
   ```bash
   ./test-audit.sh all
   ```
   Must pass lint, typecheck, and all unit/E2E tests.

2.  **Documentation (SSOT)**
   *   Review and update the seven mandatory documents as per `docs/OUTLINE.md`: `README.md`, `AGENTS.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.

3.  **Branch & Commit Hygiene**
   *   Branches: `feature/...`, `fix/...`, `chore/...`.
   *   Commit messages must clearly summarize the changes and their impact.

---

## 📢 Escalation Protocol

If blocked:

1.  Summarize the problem.
2.  List what you tried.
3.  Provide hypotheses.
4.  Offer 2–3 solution paths with pros/cons.
5.  **Pause and wait for user guidance** before proceeding.

---

## 🔐 Absolute Non-Negotiables

*   ❌ Never run `./vm-recovery.sh` without asking first.
*   ❌ Never exceed the 7-minute runtime per command.
*   ❌ Never undo or destroy user work without consent.
*   📄 Documentation first.
*   🧠 Think like a senior engineer — prioritize evidence-based, long-term stability.

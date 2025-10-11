# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment Rules

* ⏱️ **7-Minute Timeout Constraint**
  Every script or command must complete within 7 minutes. If longer, split the work into multiple runs.

* **Node Version Enforcement**
  Node must match project requirement (`22.12.x`). Verify before running tasks:

  ```bash
  node -v | grep '^v22\.12\.' || echo "[WARN] Node version mismatch. Consider switching with nvm."
  ```

* **Playwright Browsers**
  Ensure browsers are installed once per environment:

  ```bash
  pnpm exec playwright install --with-deps
  ```

  Only rerun if Phase 1/2 fails due to missing binaries.

* **Do not run `./env-stabilizer.sh` automatically before every task.**
  Use it **only when needed**, based on observed instability:

  * Tests hang or timeout
  * Vite, Node, or Playwright processes stuck
  * Port conflicts on `5173` or `9323`
  * Cache corruption or dependency errors

* **Recommended stabilization workflow**:

  1. Attempt the task normally.
  2. If issues occur, run: `./env-stabilizer.sh`
  3. Retry the task.
  4. Escalate **before using** `./vm-recovery.sh`.

---

## 📖 Read README.md Before Acting

* Always read `README.md` to understand setup, workflow, and scripts.
* Use designated runners; **never invent your own**.
* Current audit runner: `./test-audit.sh`

---

## ⚡ Quick Reference – Non-Negotiable Rules

1. ✅ **Environment Stabilization** – Run `./env-stabilizer.sh` selectively.
2. ✅ **Codebase Context** – Inspect `/src`, `/tests`, `/contexts`, `/docs` before acting.
3. ❌ **No Code Reversals Without Consent** – Never undo user work.
4. ⏱️ **Status Updates** – Provide updates every 5 minutes for long-running tasks.
5. ✅ **Scripts** – Use approved `package.json` scripts:

   ```json
   "setup:dev": "pnpm install && pnpm exec playwright install --with-deps",
   "dev": "vite",
   "build": "vite build",
   "preview": "vite preview",
   "lint": "eslint 'src/**/*.{js,jsx,ts,tsx}' 'tests/**/*.{js,jsx,ts,tsx}' --report-unused-disable-directives --max-warnings 0",
   "lint:fix": "eslint 'src/**/*.{js,jsx,ts,tsx}' 'tests/**/*.{js,jsx,ts,tsx}' --fix",
   "typecheck": "tsc --build",
   "test:audit": "./test-audit.sh",
   "test:unit:full": "vitest run --coverage",
   "test:unit:core": "vitest run --reporter verbose --pool=threads --poolOptions.threads=2",
   "test:e2e": "playwright test --reporter=list",
   "test:e2e:shard": "playwright test --shard=$1/2",
   "test:e2e:ui": "playwright test --ui",
   "test:e2e:smoke": "playwright test --grep @smoke",
   "test:e2e:smoke:headless": "playwright test --grep @smoke --headed=false",
   "test:screenshots": "playwright test --grep @visual",
   "playwright:install": "playwright install"
   ```
6. ✅ **Foreground Logging** – All E2E tasks must run in foreground with live logs (`tee`) for agent traceability.

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

1. **Run Local Audit Script**

   ```bash
   ./test-audit.sh
   ```

   Must pass lint, typecheck, unit/E2E tests.

2. **Documentation**

   * Update: `README.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.
   * Ensure alignment with SSOT rules.

3. **Traceability**

   * Link every change to PRD/Architecture/Roadmap.

4. **Security & Dependencies**

   * Run `pnpm audit` after dependency changes.
   * Document results in `ARCHITECTURE.md`.

5. **Branch & Commit Hygiene**

   * Branches: `feature/...`, `fix/...`, `chore/...`.
   * Commit messages summarize actual changes.

6. **Final User Confirmation**

   > "All checks complete. May I run the environment recovery script (`./vm-recovery.sh`)?"

---

## ⚠️ Phase-Specific Guidelines

### Phase 1: Dev Server

* Ensure `5173` port is free.
* Run Vite dev server in foreground with live logging.
* Timeout: 5 minutes.

### Phase 2: DOM Inspection

* Use `playwright eval` scripts.
* Capture output in `./logs/auth-dom.json`.
* Browser: headless Chromium by default.

### Phase 7: Visual Verification

* Run `playwright test --grep @visual`.
* Convert screenshots to base64 or save `.png` to `./logs`.
* Live log output required.

---

## 📢 Escalation Protocol

If blocked:

1. Summarize the problem.
2. List what you tried.
3. Provide hypotheses.
4. Offer 2–3 solution paths with pros/cons.
5. **Pause and wait for user guidance** before proceeding.

---

## 🔐 Absolute Non-Negotiables

* ❌ Never run `./vm-recovery.sh` without asking first.
* ❌ Never exceed 7-minute runtime per command.
* ❌ Never undo or destroy user work without consent.
* 📄 Documentation first.
* 🔐 Security first — no leaks or unsafe shortcuts.
* 🧠 Think like a senior engineer — evidence-based, long-term stability.

---

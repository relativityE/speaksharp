**Owner:** [unassigned]
**Last Reviewed:** 2026-02-12

# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment & Workflow Rules

### 1. Mandatory Pre-flight Check (Start Here)

To address persistent environment instability, a new automated pre-flight check has been created. This is now the **mandatory** first step for all sessions.

**Your first action in every session MUST be to execute this script:**

```bash
./scripts/preflight.sh
```

This script performs a fast, minimal sanity check of your environment to ensure Node.js, pnpm, and all dependencies are correctly installed.

Do not proceed until this script completes successfully. If it fails, follow the instructions in the `README.md` to stabilize your environment.

### 2. The Local Audit Script (Single Source of Truth for Testing)

The primary runner for all local validation is `./scripts/test-audit.sh`, which is accessed via `pnpm` scripts. This script is the SSOT for running lint, type-checking, and all tests.

*   **Always use this script for validation.** Do not invent your own runners or call `pnpm test` or `pnpm lint` directly for final validation.
*   The audit script automatically runs the `preflight.sh` check, ensuring a stable environment for the test run.

### 3. Selective Use of `scripts/env-stabilizer.sh`

The `./scripts/env-stabilizer.sh` script is a powerful tool for recovering a broken environment, but it should be used selectively.

*   Run `preflight.sh` first.
*   If instability persists (e.g., hanging tests, port conflicts), then run `./scripts/env-stabilizer.sh`.
*   Escalate to the user **before using** `./scripts/vm-recovery.sh`.
*   Always read `README.md` to understand setup, workflow, and scripts.

### 4. Handling Silent Crashes in E2E Tests

The E2E test environment has known incompatibilities with heavy WebAssembly-based speech recognition libraries used for on-device transcription. These libraries are loaded via dynamic imports.

*   **Symptom:** When a test triggers the import of these heavy WASM modules, the browser can crash instantly and silently, resulting in a blank screenshot with no console or network errors. This is a fatal, untraceable error.
*   **Solution:** A source-code-level guard is in place. A `window.TEST_MODE = true` flag is injected by the test setup. The application code (`frontend/src/config/TestFlags.ts`) checks for this flag and conditionally skips mocks if `VITE_USE_REAL_DATABASE` is true to prevent "Identity Hijack" in live tests.
*   **Implication:** Do not remove this flag or the corresponding check in the application code. If you encounter a similar silent crash, investigate for other dynamic imports of heavy, WebAssembly-based libraries.

### 5. CI Robustness: Standard Subshell Pattern
To prevent directory drift in CI background processes (e.g., during Lighthouse CI), always use subshells `()` for backgrounded tasks:
```bash
(cd frontend && timeout 10 pnpm preview --port 4173 &)
```
This ensures the main CI shell's working directory remains stable for subsequent commands (like `node scripts/generate-lhci-config.js`).

---

## ⚡ Non-negotiable rules

No destructive reverts without user approval. If you reverted something, immediately report which files/lines and why.
Always provide ≥2 solutions for any non-trivial problem (fast fix + robust fix).
Every claim must include file path and exact line numbers and a 2–5 line code snippet as evidence.
No escalation until Diagnostic Protocol completed (see §4).
Code MUST be tested locally AND verified via CI (or explicitly waived by user) before merging/pushing to main. Agents must not check in code that is not built or tested.

---

## ⚡ Code Quality Standards (Strict)

- **No `eslint-disable`**: We now have a "Zero Tolerance" policy. The `check-eslint-disable.sh` script will fail the build if any `// eslint-disable` comments are found in the source code.
- **No `any`**: Strict TypeScript usage is enforced to ensure type safety.
- **Testing "Gold Standard"**: Mandates that all unit tests must use proper wrappers (like `QueryClientProvider`) and avoid "green illusions" (tests that pass but test nothing).
- **Fail Fast, Fail Hard**: Tests should never hang. Use aggressive timeouts and explicit assertions to surface failures immediately.
- **Print/Log Negatives, Assert Positives**: Only log errors and warnings. Use assertions for success verification (no `console.log("✅ Success")` noise).
- **Event-Based Waits > Timeouts**: Arbitrary timeouts are forbidden unless for failsafes or specific UX timing. Always prefer `waitForSelector`, `vi.waitUntil`, or similar event-driven checks.

___

## ⚡ Quick reference (most-common tasks)

Use page.addInitScript() to set flags that must exist before app JS runs:
await page.addInitScript(() => { window.__USE_MOCK_DATA__ = true; });

For MSW: prefer handler-driven mocks over brittle query-param hacks.
For flaky SPA navigation: prefer user-style navigation (clicks) or verify with waitForSelector() on a stable DOM marker.
___

## ⚡ Diagnostic Protocol — mandatory (follow exactly)

Before asking questions or escalating, do the following in order:
Read the error literally — copy/paste exact failing command + error.
Reproduce minimal case — run the single failing test and capture artifacts:
pnpm exec playwright test tests/e2e/that-test --workers=1 |& tee run.log
Attach run.log, trace.zip, screenshot(s).
Trace to code — open implicated files and cite filename:line-range and a short snippet (3–8 lines).
Example: frontend/src/mocks/handlers.ts:35-40 with the snippet that returns [].
Form 2 hypotheses (A and B). For each, state:
What you expect to observe in logs/trace if true.
One quick check that will falsify it (grep, console.log, DOM dump).
Run quick checks (console logs, DOM dump, unzip trace, grep network entries). Attach outputs.
Propose fixes (≥2) with:
Code diff (file + line numbers)
Pros / cons / risk level
Confidence % (e.g., 90%)
If you tried both fixes (or cannot), then escalate with the exact artifacts and choices tried.
If any step is skipped, escalation will be rejected.

___

## ⚡ Evidence & PR expectations

Any PR or patch must include:
One-paragraph problem summary (plain English).
Exact failing command and raw error.
File:line snippets used as evidence.
Two options (fast + robust) with code snippets and risks.
Artifacts: trace.zip path, run.log, screenshot(s).
PRs missing these will be returned for more detail.

___

## ⚡ Quick Reference – Non-Negotiable Rules

6. ✅ **Phase 2 Hardening Protocols** – All agents MUST strictly follow these new stability patterns:
    *   **Disposable Pattern**: Every class/hook that creates event listeners or long-lived resources MUST implement and call a `.dispose()` or `.terminate()` method. See `MicStream.ts` or `TranscriptionService.ts` for examples.
    *   **Race Condition Mitigation**: Use `useRef` to capture the "Lately Captured State" for callbacks passed to long-lived services. This prevents stale closures in async operations. See `useSpeechRecognition_prod.ts` (Lines 174-183) for the implementation.
    *   **Atomic SQL Operations**: Use single-statement atomic increments for usage counters. Avoid `SELECT` -> `UPDATE` cycles. See `20260212000000_database_hardening.sql` for the `update_user_usage` function.
    *   **Constant-Time Secrets**: Use `safeCompare` (XOR-based) for all secret/token comparisons in Edge Functions to prevent timing attacks.
2.  ✅ **Codebase Context** – Inspect `/frontend/src`, `/tests` (E2E), `/frontend/tests/integration` (Real DB), `/docs` before acting.
3.  ❌ **No Code Reversals Without Consent** – Never undo user work.
4.  ⏱️ **Timeout Constraint** – Every command must complete within 7 minutes.
5.  ✅ **Approved Scripts** – Use the following `package.json` scripts for validation and development. The `ci:local` script runs the EXACT same pipeline as GitHub CI.

    ```json
     "test:all": "./scripts/test-audit.sh local",
     "ci:local": "./scripts/test-audit.sh ci-simulate",
     "test:health-check": "./scripts/test-audit.sh health-check",
     "test": "cd frontend && vitest --coverage",
     "dev": "cd frontend && vite",
     "build": "cd frontend && vite build",
     "pw:install": "playwright install chromium --with-deps",
     "pw:install:all": "playwright install --with-deps"
    ```
    
    **Playwright Browsers:** Browser installation is NOT automatic. After `pnpm install`, run `pnpm pw:install` to install Chromium for E2E testing.
    
    **Terminology Clarification:**
    - `test:health-check`: Runs a fast validation suite (Preflight + Unit Tests + Mock E2E).
    - **"Healthcheck passed!"**: This log message comes from the Lighthouse CLI and refers to its internal environment check, NOT the project's health check script.
    - **Mock Smoke Test**: Refers specifically to `tests/e2e/mock.smoke.e2e.spec.ts`.
    
    **CRITICAL:** `ci:local` is NOT a simulation - it runs the exact same commands as GitHub CI (frozen lockfile, same build, same shards). If it passes locally, CI will pass.
    
    **New Configuration Scripts (2025-11-28):**
    - `build.config.js` - Centralized port configuration (DEV: 5173, PREVIEW: 4173)
    - `generate-lhci-config.js` - Dynamic Lighthouse CI config generation
    - `process-lighthouse-report.js` - Robust JSON parsing (replaces `jq`)

6. ✅ **Foreground Logging** – All E2E tasks must run in the foreground with live logs (`tee`) for traceability.

---

## 🔍 Task Workflow

1. **Contextual Review** – Read `/docs` and `README.md` before acting.
2. **Stabilize Environment** – Run `./scripts/env-stabilizer.sh` only if instability signs appear.
3. **Grounding** – Review current workflows, scripts, and audit runners.
4. **Codebase Deep Dive** – Inspect actual code, not assumptions.
5. **Strategic Consultation** – Present root cause + 2–3 solution paths **before major changes**.
6. **Implementation** – Follow coding standards, architecture principles, and scripts.
7. **Validation** – Complete Pre-Check-In List (see below).
8. **Submission** – Ask user **before running recovery scripts** (`./scripts/vm-recovery.sh`).

---

## 🚦 Pre-Check-In List (MANDATORY)

*Complete before any commit or PR:*

1.  **Run Local Audit Script**
    ```bash
    pnpm test:all
    ```
    Must pass lint, typecheck, all unit tests, and the full E2E suite.

2.  **Mandatory Pre-Push Validation**
    Before pushing to `main`, you MUST run:
    ```bash
    pnpm run ci:local
    ```
    This runs the EXACT GitHub CI pipeline locally (frozen lockfile, sharded E2E, lighthouse). If it fails, DO NOT PUSH. Fix the issues first.

3.  **Documentation (SSOT)**
    *   Review and update the seven mandatory documents as per `docs/OUTLINE.md`: `README.md`, `AGENTS.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.

4.  **Branch & Commit Hygiene**
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

Escalation format (required)

If you must escalate, submit a single message with:
One-line result (what you attempted and outcome).
Attached artifacts (trace.zip, run.log, screenshots).
File evidence list (path:lines + snippets).
Two actionable next steps (with diffs) and the one you recommend.

---

## Behavioral checklist (short)

Think like a senior: diagnose → propose → try → attach evidence → escalate.
No “try one quick thing and ask” — do work first.
Be concise, factual, and cite code.

___


## 🔐 Absolute Non-Negotiables

*   ❌ Never run `./scripts/vm-recovery.sh` without asking first.
*   ❌ Never exceed the 7-minute runtime per command.
*   ❌ Never undo or destroy user work without consent.
*   ❌ Never use `git checkout --theirs/--ours`. Always manually resolve conflict markers.
*   📄 Documentation first.
*   🧠 Think like a senior engineer — prioritize evidence-based, long-term stability.

---

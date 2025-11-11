**Owner:** [unassigned]
**Last Reviewed:** 2025-11-01

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

The primary runner for all local validation is `./test-audit.sh`, which is accessed via `pnpm` scripts. This script is the SSOT for running lint, type-checking, and all tests.

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

## ⚡ Non-negotiable rules

No destructive reverts without user approval. If you reverted something, immediately report which files/lines and why.
Always provide ≥2 solutions for any non-trivial problem (fast fix + robust fix).
Every claim must include file path and exact line numbers and a 2–5 line code snippet as evidence.
No escalation until Diagnostic Protocol completed (see §4).

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
Example: src/mocks/handlers.ts:35-40 with the snippet that returns [].
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

1.  ✅ **Pre-flight Check** – Always start with `./scripts/preflight.sh`.
2.  ✅ **Codebase Context** – Inspect `/src`, `/tests`, `/docs` before acting.
3.  ❌ **No Code Reversals Without Consent** – Never undo user work.
4.  ⏱️ **Timeout Constraint** – Every command must complete within 7 minutes.
5.  ✅ **Approved Scripts** – Use the following `package.json` scripts for validation and development. The `test:all` scripts are the canonical way to run tests.

   ```json
    "test:all": "./test-audit.sh",
    "test:all:fast": "SKIP_FULL_E2E=true ./test-audit.sh",
    "test:all:health": "pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e:health",
    "test": "vitest --coverage",
    "test:unit": "vitest --coverage",
    "dev": "vite",
    "build": "pnpm build:prod",
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
   ./test-audit.sh
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

*   ❌ Never run `./vm-recovery.sh` without asking first.
*   ❌ Never exceed the 7-minute runtime per command.
*   ❌ Never undo or destroy user work without consent.
*   📄 Documentation first.
*   🧠 Think like a senior engineer — prioritize evidence-based, long-term stability.

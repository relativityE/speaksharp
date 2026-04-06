**Owner:** [unassigned]
**Last Reviewed:** 2026-03-24


# Agent Instructions for SpeakSharp Repository

---




To ensure 100% CI reliability, the following surface areas were **FROZEN** during the stabilization sprint. As of v0.6.0, stabilization is finalized and the project is in **Phase 5 (Finalization)**.

### 📍 Stabilization Roadmap:
*   Deterministic Navigation (Eliminate `networkidle`) ✅
*   STT Engine Contract Enforcement (Abstract Base Class) ✅
*   Heartbeat Stability (Non-silent recovery) ✅
*   Observability Hardening (CI-blocking lint & Global handlers) ✅
*   Analytics Decoupling (Non-blocking readiness) ✅

### 🚫 BLOCKED Areas:
*   **STT Engines**: No new engines or logic changes to existing ones.
*   **Routing/Layout**: No navigation changes or structural layout shifts.
*   **Test Helpers**: No modifications to `tests/e2e/helpers.ts` except for contract alignment.
*   **Env Bridge**: No changes to `TestFlags.ts` or `env.ts` (Frozen Strangler).
*   **Engine Routing**: No changes to `PrivateSTT.ts` (Frozen Gate).

### ✅ ALLOWED Areas:
*   **Contract Enforcement**: Transitioning to `STTEngine` abstract base and `data-route-ready`.
*   **Test Harness Fixes**: Aligning Playwright fixtures with atomic readiness.
*   **Observability**: Adding structured logging and error escalation.



---

## 🚨 Critical Environment & Workflow Rules


### 1. Mandatory Pre-flight Check (Start Here)

To address persistent environment instability, a new automated pre-flight check has been created. This is now the **mandatory** first step for all sessions.

**Your first action in every session MUST be to execute this script:**

```bash
pnpm preflight
```

This script performs a fast, minimal sanity check of your environment to ensure Node.js, pnpm, and all dependencies are correctly installed.

Do not proceed until this script completes successfully. If it fails, follow the "Dead Environment Trap" troubleshooting in `README.md` to stabilize your environment via `pnpm reset:clean`.

---

## 🛡️ Project Manifesto & Standards

All coding principles, hardening patterns, and governance rules have been moved to the unified **[.agent/workflows/coding-standards.md](file:///.agent/workflows/coding-standards.md)**. 

Consult that document before making any architectural or implementation decisions.

### 🏗️ SpeakSharp Architecture Patterns

### 💎 Commenting Rules
*   **No Branding/Numbering**: Never include "Fix #", "Step #", "Expert #", or cryptic numbering like "(T7)" in source code comments. Use only descriptive, functional comments that explain the *why* or the *what*.

### Hardening Patterns (2026-02-12)

The remediation strategy focuses on "defense in depth," addressing vulnerabilities across the frontend, edge functions, and database layers.

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    HARDENING ARCHITECTURE OVERVIEW (v3.5.4.1)           │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────┐         ┌─────────────────────────────┐
  │ CLIENT LAYER (React/Zustand)│         │ LOGIC LAYER (Edge Functions)│
  │                             │         │                             │
  │  ┌───────────────────────┐  │         │  ┌───────────────────────┐  │
  │  │ LocalErrorBoundary    │  │         │  │ safeCompare (const-T) │  │
  │  └──────────┬────────────┘  │         │  └──────────┬────────────┘  │
  │             │               │         │             │               │
  │        (Isolation)          │         │        (Security)           │
  │             ▼               │         │             ▼               │
  │  ┌───────────────────────┐  │         │  ┌───────────────────────┐  │
  │  │ useSessionLifecycle   │──┼────┐    │  │ apply-promo (Admin)   │  │
  │  └───────────────────────┘  │    │    │  └──────────┬────────────┘  │
  │  ┌───────────────────────┐  │    │    │             │               │
  │  │ useTransService Hook  │  │    │    │        (Integrity)          │
  │  └───────────────────────┘  │    │    │             ▼               │
  │             │               │    │    │  ┌───────────────────────┐  │
  │        (Isolation)          │    │    │  │ update_user_usage RPC │  │
  │             ▼               │    │    │  └──────────┬────────────┘  │
  │  ┌───────────────────────┐  │    │    │             │               │
  │  │ Single-Chain Service  │  │    │    └─────────────┼───────────────┘
  │  └──────────┬────────────┘  │    │                  │
  │             │               │    │                  │ (Atomic)
  │        (Stability)          │    │                  ▼
  │             ▼               │    │   ┌───────────────────────────────────┐
  │  ┌───────────────────────┐  │    │   │      DATA LAYER (Supabase)        │
  │  │ Triple-Tracing Proxy  │──┼────┘   │                                   │
  │  └───────────────────────┘  │        │  ┌─────────────────────────────┐  │
  └─────────────────────────────┘        │  │   FOR UPDATE Row Locking    │  │
                                         │  └─────────────────────────────┘  │
                                         │           ▲                       │
                                         │           │ (Cleanup)             │
                                         │  ┌─────────────────────────────┐  │
                                         │  │     ON DELETE CASCADE       │  │
                                         │  └─────────────────────────────┘  │
                                         └───────────────────────────────────┘

These core patterns were established during the Hardening cycle and refined in v3.6.0 to ensure system-wide stability and security.


---

### 2. The Local Audit Script (Single Source of Truth for Testing)

The primary runner for all local validation is `pnpm test:all:local` (which calls `./scripts/test-audit.sh`), which is accessed via `pnpm` scripts. This script is the SSOT for running lint, type-checking, and all tests.

*   **Always use this script for validation.** Do not invent your own runners or call `pnpm test` or `pnpm lint` directly for final validation.
*   The audit script automatically runs the `pnpm preflight` check, ensuring a stable environment for the test run.

### 3. Selective Use of `scripts/env-stabilizer.sh`

The `./scripts/env-stabilizer.sh` script (via `pnpm reset:env`) is a powerful tool for recovering a broken environment in CI, but it is **DESTRUCTIVE** in dev mode (it runs `git restore .`).

*   Run `pnpm preflight` first.
*   If instability persists (e.g., hanging tests, port conflicts), run **`pnpm reset:clean`**. This kills stale processes and wipes Vite caches without touching your code.
*   **NEVER** run `pnpm reset:env` in dev mode if you have uncommitted changes.
*   Escalate to the user **before using** `./scripts/vm-recovery.sh` or `pnpm reset:env ci`.
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

The core non-negotiable rules for environment stability, testing integrity, and PR submission have been moved to **[.agent/workflows/coding-standards.md](file:///.agent/workflows/coding-standards.md#%E2%9A%A1-non-negotiable-rules)**.

Consult that document for:
- Environment Setup & Restoration
- Diagnostic Protocol
- PR Expectations
- Absolute Non-Negotiables

___

## ⚡ Quick Reference – Non-Negotiable Rules

6. ✅ **Hardening Protocols** – All agents MUST strictly follow these new stability patterns:
    *   **STT Engine Contract Enforcement**: All engines MUST extend the `STTEngine` abstract base class, ensuring a deterministic lifecycle (`start`, `stop`) and heartbeat monitoring. See `STTEngine.ts` or `PrivateSTT.ts`.
    *   **Analytics Decoupling**: Telemetry events MUST be buffered via `AnalyticsBuffer` to prevent blocking the UI thread or readiness signals. See `AnalyticsBuffer.ts`.
    *   **Constant-Time Secrets**: Use `safeCompare` (XOR-based) for all secret/token comparisons in Edge Functions to prevent timing attacks.
2.  ✅ **Codebase Context** – Inspect `/frontend/src`, `/tests` (E2E), `/frontend/tests/integration` (Real DB), `/docs` before acting.
3.  ❌ **No Code Reversals Without Consent** – Never undo user work.
4.  ⏱️ **Timeout Constraint** – Every command must complete within 7 minutes.
5.  ✅ **Approved Scripts** – Use the following `package.json` scripts for validation and development. The `ci:full` script runs the EXACT same pipeline as GitHub CI.

    ```json
     "test:full": "pnpm run test:full",
     "ci:full": "pnpm run ci:full",
     "test": "pnpm test:core",
     "dev": "pnpm run dev",
     "build": "pnpm run build",
     "pw:install": "pnpm run pw:install",
     "pw:install:all": "pnpm run pw:install:all"
    ```
    
    **Script Taxonomy:** All test scripts follow `test:<level>:<env>[:<mode>]`. See `ARCHITECTURE.md` for the full reference.
    
    **Playwright Browsers:** Browser installation is NOT automatic. After `pnpm install`, run `pnpm pw:install` to install Chromium for E2E testing.
    
    **Terminology Clarification:**
    - **Core System Probe**: Refers specifically to `tests/e2e/core.e2e.spec.ts`. This is the authoritative T=0 environment probe, performing a "Deterministic, Single-Path" validation (Preflight + 1 E2E Journey).
    
    **CRITICAL:** `ci:full` is NOT a simulation - it runs the exact same commands as GitHub CI (frozen lockfile, same build, same shards). If it passes locally, CI will pass.
    
    **New Configuration Scripts (2025-11-28):**
    - `build.config.js` - Centralized port configuration (DEV: 5173, PREVIEW: 4173)
    - `generate-lhci-config.js` - Dynamic Lighthouse CI config generation
    - `process-lighthouse-report.js` - Robust JSON parsing (replaces `jq`)

6. ✅ **Foreground Logging** – All E2E tasks must run in the foreground with live logs (`tee`) for traceability.

---

## 🔍 Task Workflow

1. **Contextual Review** – Read `/docs` and `README.md` before acting.
    - **Handling Secrets**: Critical credentials (like `ASSEMBLYAI_API_KEY`) are managed via **GitHub Secrets**, not `.env` files. Run `gh secret list` to verify available secrets.
    - **Cloud Execution**: Consult `tests/TEST_PLAYBOOK.md` to understand how tests are dispatched to the GitHub Cloud via YAML scripts (e.g., `ci:dispatch:soak`).
2. **Stabilize Environment** – Run **`pnpm reset:clean`** if instability signs (port conflicts, hanging tests) appear. Only use `reset:env` if instructed by the user and you have no uncommitted work.
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
    pnpm test:full
    ```
    Must pass lint, typecheck, all unit tests, and the full E2E suite.

2.  **Mandatory Pre-Push Validation**
    Before pushing to `main`, you MUST run:
    ```bash
    pnpm run ci:full
    ```
    This runs the EXACT GitHub CI pipeline locally (frozen lockfile, sharded E2E, lighthouse). If it fails, DO NOT PUSH. Fix the issues first.

3.  **Supabase Migration Protocol**
     Required for any PR containing a database migration:
     - [ ] Ran: `pnpm supabase gen types typescript --local > frontend/src/types/database.types.ts`
     - [ ] Updated mock factories in `tests/support/factories/` to include new columns
     - [ ] Ran contract tests: `pnpm test -- --grep "Mock Parity"`
     - [ ] Verified mock headers match PostgREST spec for any new .single() queries
 
 4.  **Documentation (SSOT)**
    *   Review and update the seven mandatory documents as per `docs/OUTLINE.md`: `README.md`, `AGENTS.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.

5.  **Branch & Commit Hygiene**
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

## ⚡ Behavioral checklist (short)

Think like a senior: diagnose → propose → try → attach evidence → escalate.
No “try one quick thing and ask” — do work first.
Be concise, factual, and cite code.

___

## 🔐 Absolute Non-Negotiables

Moved to **[.agent/workflows/coding-standards.md](file:///.agent/workflows/coding-standards.md#%F0%9F%94%90-absolute-non-negotiables)**.

---

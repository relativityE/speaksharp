# SpeakSharp Test Playbook
**Version 3.5.3** | **Last Reviewed: 2026-03-01**

This document provides the definitive, step-by-step instructions for executing the SpeakSharp test suite. Follow these steps to ensure repeatability and consistency across different environments.

---

## 🛠️ Environment Prerequisites

Most tests (except for basic Unit and E2E Mock) require real backend credentials.

- **Cloud Environment Lifecycle**: In GitHub Actions, the `.env.development` file is **dynamically generated** from repository secrets by the deployment YAML scripts. It is ephemeral and is **automatically deleted** immediately after the test job completes (or on failure) to prevent secret leakage.
- **Local Path**: Uses your local `.env.development`. If placeholders like `mock_anon_key` are used, integration tests will report connectivity failures. **Note**: Locally, you must provide your own credentials in this file if you wish to run against real APIs.
  - **Cloud Path**: Authoritative tests **MUST** execute on GitHub Cloud to access secure production secrets.
- **Secret Tailing**: You can verify secret presence without reading them:
  ```bash
  gh secret list
  ```

---

## 🔐 Security & Secret Auditing

1.  **Zero-Persistence Policy**: Never commit `.env` or `.env.development` files.
2.  **Dispatcher Security**: Remote tasks (`test:soak:remote`) pass secrets directly to the GitHub runner memory, bypassing local file systems.
3.  **Auditor Verification**: The `gh run view --log` command allows you to verify that secrets were injected (look for masked `***` values) without ever exposing them to your terminal.

---

## 🚀 Execution Guide

### 1. The Full Sweep (`ci:local:full`)
**Command**: `pnpm ci:local:full`
**Description**: This is the authoritative "Pre-Flight" check. It verifies that the current local code satisfies all CI gates (Lint, Type, Unit) and integrates correctly with sharded E2E tests, Live DB, and Canary smoke checks. It ensures that any "local logic" doesn't break the "remote reality."

**Steps**:
1.  **Installs**: Syncs dependencies using the frozen lockfile.
2.  **Builds**: Creates a fresh `build:test` bundle.
3.  **Audits**: Runs `lint`, `typecheck`, and `vitest`.
4.  **E2E (Mocked)**: Runs all 4 Playwright shards.
5.  **Integration**: Executes `test:live` (Real DB).
6.  **Smoke**: Executes `test:canary` (Prod Health).

### 2. Backend Load Test (`test:soak:api`)
**Command**: `pnpm test:soak:api`
**Description**: To verify that the Supabase Edge network and RLS policies can handle concurrent traffic without connection pool exhaustion or significant latency spikes. Bypassing the browser allows for 10x higher concurrency at 1% of the resource cost.

**Custom Load**:
```bash
NUM_FREE_USERS=20 NUM_PRO_USERS=10 pnpm test:soak:api
```

### 3. UI Soak Memory Test (`test:soak:memory`)
**Command**: `pnpm test:soak:memory`
**Description**: Focuses on **Browser Stability (OOM/Memory Leaks)**. Orchestrates multiple tabs to ensure the application does not crash under extended use. Detects memory pressure and garbage collection patterns using `performance.memory` APIs.

#### 🧩 Terminology & Configuration
- **`SOAK_MEMORY_DURATION_MS`**: The module-level **"Source of Truth"** in `tests/constants.ts`. Update this single value to scale the test duration globally.
- **`SESSION_DURATION_MS`**: The configuration key inside `SOAK_CONFIG` consumed by the test runner.

**Duration Guidance**:
- **CI Stability**: 10 minutes (Source of Truth in `tests/constants.ts`).
- **Release Readiness**: 30 minutes or 2 hours. Update the `SOAK_MEMORY_DURATION_MS` value in `tests/constants.ts` before running.
  ```typescript
  // Example: Setting to 2 hours in tests/constants.ts
  const SOAK_MEMORY_DURATION_MS = 7200000;
  ```

#### 🛠️ Script Lifecycle & Orchestration

The soak suite uses a tiered script structure in `package.json` to ensure a clean and modular environment:

1.  **`pretest:soak`**: Runs automatically before any soak command.
    *   **Action**: `npx kill-port 5173 || true`.
    *   **Why**: Ensures port 5173 (Vite) is free so Playwright can spin up a fresh server or take ownership without "Port in use" conflicts.
2.  **`test:soak:api`**: Standalone Backend Stress.
    *   **Action**: `dotenv -e .env.development -- tsx tests/soak/backend-api-stress-test.ts`.
    *   **Why**: Executes the "Thundering Herd" auth and RPC stress test without browser overhead. Essential for backend latency benchmarks.
3.  **`test:soak:verify`**: Post-Run Data Audit.
    *   **Action**: `dotenv -e .env.development -- tsx tests/soak/verify-users.ts`.
    *   **Why**: Verifies that the records created during the soak session (e.g., transcripts) are present and accurate in Supabase, acting as a data integrity gate.
4.  **`test:soak:memory`**: Unified Coordinator.
    *   **Action**: The main coordinator (`soak-test.spec.ts`) that orchestrates both the API stress and the UI memory check in sequence.

##### A. Local Verification (RAM Intensive)
1. **Sync Duration**: Ensure `tests/constants.ts` has the desired `SOAK_MEMORY_DURATION_MS`.
2. **Setup Credentials**: Create a local `.env.development` with valid Supabase keys (if running against live DB).
3. **Execute**:
   ```bash
   pnpm test:soak:memory
   ```

##### B. Authoritative Cloud Execution (Recommended)
This uses the repository's GitHub Cloud infrastructure and secrets.
1. **Trigger Remote Run**:
   ```bash
   gh workflow run soak-test.yml
   ```
2. **Monitor Progress**:
   ```bash
   gh run watch
   ```
3. **View Final Logs**:
   ```bash
   gh run view --log
   ```

### 4. Integration Suite (`test:live`)
**Command**: `pnpm test:live`
**Description**: Validates that the application logic correctly handles real third-party integrations (Supabase DB, AssemblyAI, Stripe).
**Cloud Context**: This test is part of the `ci.yml` workflow. In the cloud, it uses the dynamically generated `.env.development`. If running locally, ensure your environment variables match the names in `env.required`.

### 5. STT Test Architecture & Skip Justifications

> **For AI agents**: This section documents every STT test, where it runs, and why some are conditionally skipped.

#### E2E Tests (CI — All Passing ✅)

7 tests using **MockEngine** via TestRegistry. Fast, deterministic, headless.

| File | Tests | What It Verifies |
|---|---|---|
| `e2e/private-stt.e2e.spec.ts` | 5 | Download progress, cache hit, Pro visibility, auto-load, Start/Stop regression |
| `e2e/diag-private-stt.e2e.spec.ts` | 1 | Mock profile injection pipeline |
| `e2e/priv-stt-mock-fallback.e2e.spec.ts` | 1 | Optimistic Entry Pattern (fallback while downloading) |

#### Live Tests (Manual — Conditional Skips)

Excluded from GitHub CI (`ci.yml` only runs `tests/e2e`). Run via `pnpm test:live` (headed Chrome).

| File | Skip Condition | Justification |
|---|---|---|
| `live/stt-integration.live.spec.ts` | `!process.env.REAL_WHISPER_TEST` | Loads real Whisper WASM (~100MB), needs COOP/COEP + SharedArrayBuffer. Cannot run headless. |
| `live/driver-dependent/private-stt.live.spec.ts` | `browserName !== 'chromium'` | TransformersJS ONNX needs Chromium WASM SIMD. Injects real audio file. 120s timeout. |
| `live/live-transcript.live.spec.ts` | `browserName !== 'chromium'` | Native STT (Web Speech API) is Chrome-only. |

#### Key Config Files
- `playwright.config.ts` — E2E (headless, `tests/e2e`)
- `playwright.live.config.ts` — Live (headed, `tests/live`, sets `REAL_WHISPER_TEST=true`)
- `frontend/src/config/TestFlags.ts` — Runtime flags for mock vs real engine selection

### 6. Canary Smoke Tests (`test:canary`)
**Command**: `pnpm test:canary`
**Description**: Acts as the "Final Gate" after deployment. It runs against the public URL to ensure that Environment Variables, SSL, and Vercel edge configs are correctly set up and the app is reachable by real users.

**Targeting**:
```bash
# Against production (Vercel)
pnpm test:canary

# Against specific URL (Staging)
BASE_URL=https://my-staging-app.vercel.app pnpm test:canary
```

### 7. Production Forced Check (`test:canary:prod`)
**Command**: `pnpm test:canary:prod`
**Description**: A hard check against the canonical production URL.
**Audit Note**: This test executes on every `main` branch push via `canary.yml`. It handles the full lifecycle: **Attempt Create User -> Run Test -> Cleanup Env**.

### 8. Remote Soak Dispatch (`test:soak:remote`)
**Command**: `pnpm test:soak:remote:wait`
**Description**: To execute high-load stress tests (Soak) using GitHub's cloud compute power rather than local resources. This allows for testing with 15+ concurrent users without crashing the local developer machine, while safely accessing production-grade secrets stored in GitHub.

- **Playbook Structure**: Deployed via YAML (`.github/workflows/soak-test.yml`).

#### Remote Monitoring & Oversight (Non-Visual CLI)
Every remote execution can be monitored and audited entirely from the terminal:

1.  **Dispatch the Task**:
    ```bash
    pnpm test:soak:remote:wait
    ```
2.  **Monitor Progress**:
    - **Interactive Watch**: `gh run watch` (Allows selecting and following the active run).
    - **Current Status**: `gh run list --workflow 214853920 --limit 1` (Checks the latest outcome for the Soak Test).
3.  **Review Forensic Logs**:
    - **Tail Logs**: `gh run view --log` (Streams all logs for the current/latest run).
    - **Specific Run Audit**: `gh run view <ID> --log` (Targets a specific historical run).

---

## 🏗️ CI Strategy & Stability

To ensure a green, reliable pipeline across macOS and Ubuntu runners, we follow these architectural mandates:

### 1. Cross-Platform TTY Capture
Avoid the `script` command for TTY emulation, as it has incompatible syntax across BSD (macOS) and util-linux (Ubuntu) and can crash runners.
- **Pattern**: Use `FORCE_COLOR=1 | tee <logfile>`.
- **Benefit**: Preserves log coloring while remaining stable on all platforms.

### 2. Vitest Metrics Reliability
- **CI Mode**: Always pass `CI=true` to Vitest to trigger optimized CI behavior (silent mode, sequential execution).
- **Absolute Paths**: When using `--outputFile`, use absolute paths (e.g., `$(pwd)/unit-metrics.json`) to prevent artifacts from being buried in nested subdirectories.

### 3. Lighthouse Configuration Unification
- **Zero-Shadowing Policy**: Never place `.lighthouserc.js` or `.lighthouserc.yml` in the root if you are using dynamic `.json` generation.
- **Authority**: The `lighthouserc.json` generated by `scripts/generate-lhci-config.js` is the single source of truth for CI.

### 4. SQM Metric Protection
The Software Quality Metrics in `docs/PRD.md` are protected by markers.
- **Format**: 
  ```markdown
  <!-- SQM:START -->
  <!-- do not remove - used by sqm script -->>
  ...
  <!-- SQM:END -->
  <!-- do not remove - used by sqm script -->>
  ```
- **Constraint**: Do not move the disclaimer comments to the same line as the markers; keep them separate to allow the `update-prd-metrics.mjs` script to match exact marker signatures.

---

## 📊 Troubleshooting
- **`ERR_IPC_CHANNEL_CLOSED`**: This is a known Mac/Node 22 teardown noise. If the tests are Green, ignore it.
- **VAD Timeout**: If silence detection fails, ensure your logic uses `page.clock.fastForward()` to advance intervals.
- **Mutex Lock**: If a test hangs with "Active session in another tab," run `localStorage.clear()` in the browser and restart the test.
- **Secret Access**: If a remote test fails due to missing keys, verify the name in `gh secret list` matches the variable expected in the workflow YAML.

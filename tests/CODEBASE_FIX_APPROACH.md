# Codebase Fix Approach

This guide documents common issues encountered during development and testing of SpeakSharp, along with their resolutions.

## E2E Testing & Infrastructure

### 🔄 Environment Sync: "Configuration Required" Page
- **Issue:** The app shows "Configuration Required" even when environment variables seem correct.
- **Root Cause:** Building the app with `pnpm build` instead of `pnpm build:test` for local E2E validation. The standard build optimizes away E2E mocks.
- **Resolution:** Run `pnpm build:test` followed by `pnpm preview:test` to ensure the environment is correctly initialized for testing.

### 🧪 E2E Mock Property Mismatches
- **Issue:** E2E tests fail with 400 errors or handle responses incorrectly despite the mock being "hit".
- **Root Cause:** Property name mismatch between the frontend service and the Playwright mock handler (e.g., `url` vs `checkoutUrl`, or `code` vs `promoCode`).
- **Resolution:** 
  1. Check browser console logs for `[E2E Mock]` debug info.
  2. Verify the exact property names in the `frontend/src/` service calls and ensure the mock in `tests/e2e/mock-routes.ts` returns the identical JSON structure.
  3. Example: `stripe-checkout` expects `{ checkoutUrl: string }`, not `{ url: string }`.

---

## 🛡️ The Evidence Pipeline & Dumping Ground (Workflow Context)

To ensure 100% CI reliability during the stabilization sprint, we adopted a "Forensic-First" testing strategy. This workflow is centered around the `tests/e2e/dump-ground/` directory and the `evidence.spec.ts` family of tests.

Protocol**
OBSERVE → PROVE → FIX → CONFIRM
to validate hypothesis

### 1. The "Dumping Ground" Sandbox
Located in `tests/e2e/dump-ground/`, this directory serves as a High-Fidelity Forensic Sandbox.

*   **Purpose**: It is a strictly isolated space for transient tests that are too specific, too environment-heavy, or too "noisy" for the main E2E suite.
*   **Safety**: By keeping these tests in the "Dumping Ground," we can perform extreme investigative probes (e.g., forcing WASM failures, simulating 10-minute session timeouts) without destabilizing the core CI signal.

### 2. `evidence.spec.ts` (The Verification Receipt)
The `evidence.spec.ts` files (e.g., `evidence.c1`, `evidence.c3`) are used as System Ground Truth Probes.

*   **The Artifact as Truth**: Instead of just assertion logs, these tests frequently "dump" the internal state of the application (via the `__SS_E2E__` bridge) into the log files.
*   **Clusters as Receipts**: We use a naming convention based on Failure Clusters (C1, C2, etc.). When a complex regression is identified, we create an `evidence.cX.spec.ts` file that definitively **Reproduces** the bug.
*   **The Completion Signal**: Once the fix is implemented, these tests are run as "Receipts." A passing `evidence.spec.ts` provides mathematical proof that the specific failure cluster is permanently resolved.

### 3. The Lifecycle of an Evidence Test
1.  **Isolation**: A regression (like the "Termination Deadlock") is detected.
2.  **Evidence Creation**: We create a new evidence spec in the Dumping Ground that specifically targets the deadlock.
3.  **Iterative Pulse**: We use this spec to verify the fix in isolation, avoiding the overhead of the full 40-test E2E suite.
4.  **Final Receipt**: Once the plan is approved and executed, the evidence remains in the Dumping Ground as a permanent, verifiable record of the stabilization.

---

## 🎙️ The Role of Trace Logs in Stabilization

I identify that the use of specialized Trace Logs is the final pillar of our forensic testing strategy. These logs provide the "Black Box" data required to verify the internal logic of the speech engines and state machines without relying solely on the UI.

In addition to our "Dumping Ground" specs, we utilize a strictly formatted Trace Logging Pipeline (`logger.ts`) to achieve deterministic verification.

### 1. The [TRACE] Prefix (Authoritative Timeline)
The application code is instrumented with `logger.debug` statements prefixed with `[TRACE]` (e.g., `[TRACE] STATE_TRANSITION`, `[TRACE] ENGINE_INIT_START`).

*   **Purpose**: These traces provide a mathematically verifiable execution timeline.
*   **Testing Use-Case**: In E2E tests, we don't just assert that a "Recording" label appears; we verify that the correct sequence of traces was emitted. This allows us to detect "Silent Regressions" where the UI looks correct, but the underlying lifecycle (e.g., resource disposal) is broken.

### 2. Concurrency & "Zombie" Detection
Trace logs are our primary weapon against Second-Order Concurrency failures.

*   **Instance Tracking**: By auditing the `serviceId` and `runId` attached to each trace, we can identify "Zombie Sessions"—where a previous transcription instance is still emitting data after it should have been destroyed.
*   **Deadlock Proof**: In the "Termination Deadlock" diagnosis, the trace logs provided the definitive proof that `destroy()` was being interrupted before the `CLEANING_UP` -> `TERMINATED` transition could complete.

### 3. FSM Ground Truth Verification
The `TranscriptionFSM` logs every transition as a `[TRACE]`. This means we can audit the state machine's performance across the entire 40-test E2E suite by simply filtering for `[TRACE] STATE_TRANSITION`. This ensures that every test run serves as a regression test for the entire state-transition table.

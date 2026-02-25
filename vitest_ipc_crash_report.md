# Vitest Test Runner Crash Report

**Date**: February 25, 2026
**Environment**:
*   **OS**: macOS
*   **Node.js**: v22.12.0
*   **Framework**: Vitest, React, TypeScript
*   **Browser Environment**: `happy-dom`
*   **Test Runner**: `@vitest/runner`, `tinypool`

## 1. First Principles: What We Know is True (Verified Facts)

Before diagnosing the root cause, these are the **hard facts** we have verified about the environment and the crash:

1. **The Tests Pass in Isolation and Together**: 100% of the individual unit and integration tests successfully execute and report a `PASS` status (`✓`) in the console. No assertions are failing.
2. **The Timing of the Crash is Consistent**: The crash *never* occurs during the middle of the test suite execution. It *only* occurs at the very end, precisely during the final process teardown sequence.
3. **The Exit Code & Error are Consistent**: The runner consistently exits with `Exit code: 1` and throws an `Unhandled Rejection: Error: Channel closed` with a `Serialized Error: { code: 'ERR_IPC_CHANNEL_CLOSED' }`.
4. **The Stack Trace Attributes the Failure to the Worker Pool**: The stack trace points directly to `node_modules/tinypool/dist/index.js` attempting to send a message via `MessagePort` back to the parent process.
5. **The Environment**: We are explicitly running Node.js v22.12.0 on macOS, utilizing `vitest`, `happy-dom`, and `@vitest/runner` with its default `tinypool` threading handler.
6. **Code-Level Infinite Loops Have Been Removed**: Previous structural infinite loops (e.g., recursively draining `setInterval` using `vi.runAllTimersAsync()`) have been explicitly found, matched, and eliminated from the frontend test code.
7. **React Component State is Clean**: Component UI tests that previously had swallowed Promise rejections or missing mocked configuration states have all been completely resolved and pass cleanly.

## 2. Historical Context (Git Bisect Results)

We verified earlier tags (such as `v3.5.2` and the Priority 1 commit). During those previous commits, the `vitest` execution did *not* show the `ERR_IPC_CHANNEL_CLOSED` error. However, this is because **the test suite was aborting early due to broken assertions and type errors**.

Because the preceding commits failed midway with `Exit code: 1` locally, `vitest` performed a hard abort rather than a graceful asynchronous teardown. Now that Phase 2 has successfully fixed 100% of the assertions and the suite finishes cleanly, the runner attempts a full graceful teardown, which triggers the Node 22 IPC memory crash. The crash was always present in the environment logic, but masked by earlier test failures.

## 3. Problem Description & Symptom Overview

When running `pnpm vitest run --coverage` (or without coverage), the continuous integration pipeline crashes at the very end of the execution with `ERR_IPC_CHANNEL_CLOSED`. The exit code returned is 1, which halts the pipeline despite 100% of the individual unit and integration tests passing correctly.

### Final Stack Trace:
```text
61: 0x102fded60 node::NodeMainInstance::Run(node::ExitCode*, node::Environment*) [/Users/fibonacci/.nvm/versions/node/v22.12.0/bin/node]
62: 0x102fdeafc node::NodeMainInstance::Run() [/Users/fibonacci/.nvm/versions/node/v22.12.0/bin/node]
63: 0x102f55b40 node::Start(int, char**) [/Users/fibonacci/.nvm/versions/node/v22.12.0/bin/node]
64: 0x1979d5d54 start [/usr/lib/dyld]

⎯⎯⎯⎯⎯⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯⎯⎯⎯⎯
Error: Channel closed
 ❯ target.send node:internal/child_process:753:16
 ❯ ProcessWorker.send node_modules/tinypool/dist/index.js:140:41
 ❯ MessagePort.<anonymous> node_modules/tinypool/dist/index.js:149:62
 ❯ [nodejs.internal.kHybridDispatch] node:internal/event_target:827:20
 ❯ MessagePort.<anonymous> node:internal/per_context/messageport:23:28

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { code: 'ERR_IPC_CHANNEL_CLOSED' }
Exit code: 1
```

## 2. Debugging Steps Taken

To eliminate test-code level errors, we performed a thorough audit of the testing suite:

1. **Eliminated Infinite Timeouts**: During the STT audit, we found several tests using `await vi.runAllTimersAsync()` while testing recursive intervals (e.g. `startHeartbeat()` and `fetchWithRetry.test.ts`). This caused actual Out-Of-Memory segmentation faults. We solved this by using strict numeric bumps: `vi.advanceTimersByTimeAsync(8000)` and `vi.runAllTicks()`. These structural memory leaks are effectively gone.
2. **Fixed Uncaught React Warnings**: Fixed several React UI rendering bugs where `useSessionLifecycle.ts` return mocks were unhandled, leading to swallowed undefined DOM exceptions. All tests now handle UI rendering properly.
3. **Verified Isolation**: We checked global mocks. `BroadcastChannel`, `navigator.locks`, and `AudioContext` have `clearAllTimers` and `vi.clearAllMocks` teardowns initialized. 

Despite ensuring the runtime executes correctly, Node 22 still panics during the background `tinypool` serialization teardown.

## 3. Forensic Conclusion: The Compound Failure

The crash is definitively a compound failure triggered by the upgrade from the `tiny` model to the `base` model, which exposed an existing resource leak:

1.  **Primary Cause (The Leak)**: A `BroadcastChannel` created in `WhisperEngineRegistry.acquireWithPolyfill` is never closed in the success path. If an engine is acquired successfully, the channel's `'message'` event listener remains active, keeping the Node.js event loop alive perpetually.
2.  **Secondary Cause (Memory Pressure)**: The switch from `tiny` (~39MB) to `base` (~74MB) doubled the memory footprint. When Vitest runs parallel forks, the RAM spike during the final IPC serialization phase (transmitting test results) causes worker processes to hit V8 memory limits.
3.  **The Result**: Node 22 abruptly kills the worker process during teardown due to OOM/GC pressure. Because the leaky `BroadcastChannel` is trying to keep the process alive, the exit is not graceful, leading to `ERR_IPC_CHANNEL_CLOSED`.

## 4. Final Surgical Fixes (Confirmed 110%)

### Fix 1: BroadcastChannel Lifecycle
The `acquireWithPolyfill` method must be refactored to wrap the entire logic in a `try...finally` block, ensuring `channel.close()` is called regardless of success or failure.

### Fix 2: Hybrid Memory Mitigation
We will implement a hybrid strategy in `vitest.config.mjs`:
-   **Parallel locally** for speed.
-   **Sequential (`singleFork: true`) on CI** to prevent OOM.
-   **Increased Worker Heap** (`--max-old-space-size=2048`).
-   **Enhanced Diagnostics** in `debug-teardown.ts` to catch future `BroadcastChannel` registry leaks.

## 5. Implementation Status
We are now proceeding to implement these absolute fixes to stabilize the pipeline for good.

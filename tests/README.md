# SpeakSharp E2E Testing Guide

This directory contains end-to-end (E2E) tests for the SpeakSharp application using Playwright.

## 🏁 Core Guideposts

### 1. Fail Fast, Fail Hard
Tests should surface failures immediately. If a selector isn't visible or a signal doesn't fire, the test should fail explicitly rather than hanging or retrying silently.

### 2. Event-Based Waits (Deterministic Synchronization)
**Preference:** Always prefer event-based waits over static timeouts.

- **❌ BAD:** `await page.waitForTimeout(5000)` (Hard to tune, slow if too long, flaky if too short)
- **✅ GOOD:** `await page.waitForFunction(() => (window as unknown as { __e2eProfileLoaded__: boolean }).__e2eProfileLoaded__ === true)`

By injecting signals into the app (e.g., `__e2eProfileLoaded`, `__e2eBridgeReady`), we ensure that tests proceed the exact millisecond the application is ready, regardless of CI environment speed or network latency.

### 3. Print Negatives, Assert Positives
- **Logging:** Only log diagnostic information (errors, warnings, state changes) using helpers like `attachLiveTranscript` or `debugLog`.
- **Assertions:** Use `expect()` for success conditions. Avoid "Success ✅" console clutter.

## 🛠️ Infrastructure Layers

1.  **Network Layer (`mock-routes.ts`):** Intercepts Supabase/API calls.
2.  **Runtime Layer (`e2e-bridge.ts`):** Mocks browser APIs (SpeechRecognition) and injects initial state.
3.  **Orchestration Layer (`helpers.ts`):** Shared test utilities like `programmaticLoginWithRoutes`.

Refer to [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for full technical details.

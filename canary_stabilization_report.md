# Canary Stabilization Status Report

**Date**: 2026-02-09
**Overall Status**: 🟡 2/3 Issues Resolved. 1 Blocker Remaining.

## 1. Issue: CORS (WebSocket Handshake)
*   **Problem**: Staging WebSocket connections were rejected by Edge Function CORS policy.
*   **What Worked**:
    *   ✅ **Dynamic Origin Matching**: Updated `cors.ts` to allow `*.vercel.app` and `localhost`.
    *   ✅ **Request Passing**: Updated `assemblyai-token` function to pass the request object to the CORS helper.
*   **Current State**: **RESOLVED**. Logs show successful WebSocket connection (`wss://...`).

## 2. Issue: Deployment Gap (Edge Functions)
*   **Problem**: `deploy-functions-only.yml` was broken (deprecated syntax) and missing the Token function.
*   **What Worked**:
    *   ✅ **Modern CLI**: Switched to `npx supabase`.
    *   ✅ **Manifest Update**: Added `assemblyai-token` to deployment list.
*   **Current State**: **RESOLVED**. workflow runs successfully and updates the backend.

## 3. Issue: Canary UI Hang (The Blocker)
*   **Problem**: Test hung at `stt-mode-select` (missing element) and now hangs at "Add Word" (timeout).
*   **What Worked**:
    *   ✅ **Fixing UI Identifiers**: Added `data-testid` to `LiveRecordingCard`.
    *   ✅ **Waiting for Vercel**: Confirmed that once Vercel deployed, the **Mode Select** step PASSED (previously the blocker).
*   **What Didn't Work**:
    *   ❌ **Network Wait (Strict 201)**: Timed out because Staging returns `200`.
    *   ❌ **Network Wait (Relaxed 2xx)**: Timed out because **No Request Was Sent**.
    *   ❌ **Explicit Wait (5s)**: Failed because the button click didn't trigger the action.
*   **Current State**: **BLOCKED**. The test navigates to "Add Word", enters text, clicks... and nothing happens. The network request is missing.

## 4. Actionable Next Steps (The Plan)
To unblock Issue 3, we must debug **Interactive Elements** in Staging.

1.  **Instrument the Component (`UserFillerWordsManager.tsx`)**:
    *   Add `console.log` inside `handleSubmit` to prove if the click registers.
    *   Add `data-testid` to the **Submit Button** (currently relies on `aria-label` which might be flaky with overlays).
2.  **Verify Button State**:
    *   Update test to Assert `toBeEnabled()` before clicking.
    *   Update test to Assert `inputValue` matches before clicking.
3.  **Bypass UI (Fallback)**:
    *   If UI remains flaky, we can seed the data via API (like we do for login) to let the rest of the test (WebSocket) run.

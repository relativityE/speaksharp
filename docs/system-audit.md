# SpeakSharp System Audit Report: STT Reliability & Orchestration

**Date:** October 2025
**Auditor:** Jules (Senior Systems Engineer)
**Status:** Audit Complete | Baseline Hardened

---

## 🔍 1. Architecture Map

**User Action** → `useSessionLifecycle` → `TranscriptionService` (Facade) → `TranscriptionFSM` (Control) → `PrivateSTT` (Engine Strategy) → `WhisperTurbo` / `TransformersJS`.

**State Transitions:**
- `IDLE` → `ACTIVATING_MIC` → `READY`
- `READY` → `INITIALIZING_ENGINE` → `RECORDING`
- `INITIALIZING_ENGINE` ↔ `DOWNLOADING_MODEL` (New)

---

## ⚠️ 2. Critical Weaknesses

### [Critical] Fallback Race Conditions
`TranscriptionService` previously used unmanaged `setTimeout` for engine fallback.
- **Problem:** If a model load completed exactly when the timer fired, the system could enter a dual-active "zombie" state.
- **Solution:** Implemented `AbortController` in `startOptimisticEntryTimer` to atomically cancel fallback logic upon successful initialization.

### [High] Implicit Cache Handling
The `CACHE_MISS` flow was derived from catching exceptions rather than explicit state.
- **Problem:** Brittle error-string matching (`error.message === 'CACHE_MISS'`).
- **Solution:** Added `DOWNLOADING_MODEL` state to FSM. `TranscriptionService` now deterministically manages the download lifecycle, including automatic background hydration upon cache miss.

---

## 🚀 3. Performance & Observability

- **Audio Pipeline:** Efficiently offloaded to Web Workers. No UI jank detected during heavy inference.
- **Observability:** Added `performance.mark` instrumentation:
  - `whisper-download-start` / `whisper-download-end`
  - `transformers-download-start` / `transformers-download-end`

---

## 🛠️ 4. Architectural Proposals

1.  **Centralized Model Manager:** Decouple engine logic from binary fetch.
2.  **Stateful Fallback Notifications:** Inform users *why* Native mode is active (e.g., "Downloading Vault model...").
3.  **WASM Warmup Hooks:** Trigger model compilation on landing page for Pro users.

---

## 📊 Summary

| Severity | Category | Fix |
| :--- | :--- | :--- |
| **High** | Orchestration | **AbortController** for timers |
| **High** | Reliability | **Explicit FSM States** |
| **Medium** | Observability | **Performance API Integration** |

---
*Verified by SpeakSharp Architecture Review*

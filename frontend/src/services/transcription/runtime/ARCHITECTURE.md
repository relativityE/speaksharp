# Speech Runtime Architecture

The Speech Runtime is a deterministic orchestrator for client-side and cloud-based speech-to-text. It follows a three-layer design to ensure reliability, observability, and privacy.

## Three-Layer Architecture

1.  **Speech Runtime Controller (Orchestrator)**: The single source of truth for runtime state. It manages a master state machine (UNINITIALIZED -> MODEL_CHECK -> READY -> RECORDING) and enforces policy-driven engine selection.
2.  **Model Lifecycle Manager**: Exclusive controller for model availability, background downloading, and warming. It probes IndexedDB/Cache API to ensure "Offline-First" readiness.
3.  **Engine Adapters**: Minimal execution wrappers for Private (Whisper), Native (Web Speech API), and Cloud (AssemblyAI) engines.

## Core Guarantees

-   **Deterministic Transitions**: All system behavior is driven by explicit state changes, eliminating race conditions from overlapping initialization.
-   **Privacy Gating**: Audio data is routed strictly according to the active engine state. Cloud STT is never initialized when Private mode is enforced.
-   **Reliable First-Time UX**: Automatic "Native Fallback" during private model downloads, with a seamless "Auto-Switch" once the local model is ready.
-   **Observability**: Emits structured events (e.g., `model_download_progress`, `engine_fallback`) for UI feedback and deterministic E2E testing.

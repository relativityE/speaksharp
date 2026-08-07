# Guided Rehearsal (G2) Implementation Plan — Synthesis

This plan reconciles the Product Owner (customer value), Product Manager (feasibility), and Developer (architecture) perspectives for implementing Guided Rehearsal (#1046).

## 1. Product & Value (PO)
Guided Rehearsal extends the Freestyle practice loop by allowing users to set explicit focus points (a "brief") before speaking. Post-recording, SpeakSharp evaluates the delivery against these points alongside standard Clarity metrics.
*   **Truthfulness:** Private STT (on-device) is mandatory. If fallback occurs, Guided evaluation must fail gracefully ("unavailable") rather than silently evaluating on secondary engines (Browser/Cloud).
*   **Parity:** Guided must maintain continuity across History, Analytics, and PDF exports.

## 2. Architecture & Data Model (Dev)
*   **No Forking:** The `PracticeSession` and `SpeechRuntimeController` will be parameterized by mode (`freestyle` | `guided`).
*   **Data Model:** Utilize the existing G1 foundation (`guided_project`, `guided_brief`, `guided_session`, `guided_evidence`).
*   **Attribution (#1163):** G2 evaluation is strictly gated by `get_attribution_authority_v1(session_id)`. Only an explicit `private` class authority unlocks `guided_finalize_evidence_v1`.
*   **Fallback Disqualification:** `SpeechRuntimeController` must track fallback. In Guided mode, fallback leads to an `unattributed` status, which the UI handles truthfully.

## 3. Implementation Phasing (PM & Dev Reconciliation)
To satisfy the PM's requirement for small, reviewable PRs while mitigating the Dev's risk of broken state machines, the rollout is sequenced as follows:

*   **Phase 1: Routing & UI Scaffold (`feat(guided): routing and brief UI`)**
    *   Enable `/practice?mode=guided` (gated by `has_guided_capability()`).
    *   Build the pre-recording UI for focus points using `guided_project`/`guided_brief`.
*   **Phase 2: Strict Engine & Attribution (`feat(guided): strict private attribution`)**
    *   *Conflict Resolved:* Bundle the controller changes with the attribution consumption to ensure the gate is atomic.
    *   Update `SpeechRuntimeController` to enforce Private STT and reject Guided if fallback occurs. Wire `attest_session_engine_v1` challenge.
*   **Phase 3: Evaluation & Surfaces (`feat(guided): evaluation and continuity`)**
    *   Hook `guided_finalize_evidence_v1` into `wireProgressEvaluationOnSave`.
    *   Update Practice Home, History, and PDF surfaces to render Guided outcomes.

## 4. Evidence & Definition of Done
*   **Qualification:** #1151 (Private proof) and #1164 (retention preflight) must be green. #1163 must be rolled out.
*   **E2E Testing:** Playwright tests proving exact-identity (Positive: Private success -> Guided feedback; Negative: Fallback -> Guided unavailable).
*   **Review:** Exact-head CI/SCA passing, independent binary review complete.

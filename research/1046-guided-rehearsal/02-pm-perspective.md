## Product Manager — Feasibility & Sequencing

**Sequencing Strategy (Small, independently shippable PRs)**
To avoid massive, risky merge conflicts, G2 must be sliced into a Directed Acyclic Graph (DAG) of PRs:

1.  **PR 1: G2 Foundation & Routing (Base)**
    *   **Scope:** Extend `/practice` and `/session` routing to support `mode=guided`. Implement the `has_guided_capability()` gate logic frontend-side. Define the TypeScript interfaces for `guided_brief` and `guided_project`.
    *   **Requirement:** Must merge without breaking Freestyle.
2.  **PR 2: Pre-Recording Focus Points UI (Feature)**
    *   **Scope:** Build the UI for users to input and persist their focus points (the Brief) before starting a Guided session. Use `guided_project` and `guided_brief` RPCs.
3.  **PR 3: Engine Strictness & Authority Consumption (Core)**
    *   **Scope:** Modify `SpeechRuntimeController` to enforce `private` STT when `mode=guided`. Wire up the consumption of #1163 (`attest_session_engine_v1`, `get_attribution_authority_v1`). Reject fallback attempts.
    *   **Risk Mitigation:** This is the highest risk PR. It requires exact-head CI testing to ensure Freestyle isn't inadvertently locked out.
4.  **PR 4: Evaluation Integration & Surfaces (Completion)**
    *   **Scope:** Hook into `wireProgressEvaluationOnSave` to trigger `guided_finalize_evidence_v1`. Update Practice Home, History, and PDF surfaces to render Guided outcomes alongside Clarity.

**Risks & Mitigations**
*   **Risk:** `SpeechRuntimeController` state machine becomes brittle handling both modes.
    *   **Mitigation:** Strict separation of mode logic at the initialization phase; once recording starts, the state machine behaves identically, only the post-save evaluation differs.
*   **Risk:** Duplication of attribution logic.
    *   **Mitigation:** Strictly consume `#1163` RPCs (`get_attribution_authority_v1`). Never write to `sessions.attribution_status`.

**Definition of Done (Closing #1046)**
*   #1163 is merged and active.
*   Qualification gates #1151 (Private production proof) and #1164 (retention preflight) are green.
*   Implementation proves exact-session readback, negative fallback proofs, and exact-identity (no Cloud/stale-attribution).
*   Independent binary review is complete and accepted.

## Developer / Staff Eng — Architecture

**Extending the Practice Loop**
Do not fork the practice loop (e.g., no `GuidedSession.tsx`). Instead, parameterize `SpeechRuntimeController` and `PracticeSession` with a `mode` (`freestyle` | `guided`). The recording pipeline remains singular.

**Data Model & State**
The database foundation is already laid in `20260802000000_guided_g1_foundation.sql`. We will use:
*   `guided_project`, `guided_brief`, `guided_brief_point` for pre-session focus points.
*   `guided_session` and `guided_evidence` for post-session outcomes.
*   `guided_finalize_evidence_v1` RPC to atomically finalize evidence.

**Attribution Authority Consumption (#1163)**
G2 must strictly consume the new immutable authority contract.
1.  **Registration:** During session setup, the declared engine intent is registered via `session_attribution_challenge`.
2.  **Attestation:** `attest_session_engine_v1` is called post-recording (service-role).
3.  **Consumption:** G2 reads `get_attribution_authority_v1(session_id)`. G2 evaluation (`guided_finalize_evidence_v1`) MUST ONLY proceed if the authority returns `attrib_v1` with `engine_class = 'private'`.

**Private v2/v4 Exact-Identity & Fallback Handling**
If the Private STT engine fails to initialize or drops mid-session, the controller might attempt a fallback (e.g., to Browser). For `freestyle`, this is tolerated. For `guided`, **fallback is an immediate disqualification**.
*   `SpeechRuntimeController` must detect fallback.
*   If fallback occurs in Guided mode, the recording may save, but `attest_session_engine_v1` will fail the challenge (class swap), resulting in `unattributed`.
*   The UI must map `unattributed` to a graceful "Guided evaluation unavailable (Private STT required)" state, preserving the Clarity score if possible, but explicitly voiding the Guided outcome.

**Evidence Bar (Testing)**
*   **Unit/Integration:** Mock the `#1163` RPCs to verify `recordProgress` correctly halts Guided evaluation on `unattributed` authority.
*   **Playwright E2E:**
    *   *Positive:* `proPage` -> `/practice?mode=guided` -> Supply points -> Record (Private) -> Verify Guided outcome renders.
    *   *Negative:* Trigger mock fallback -> Verify session saves but Guided outcome displays 'unavailable'.
*   **SCA/CI:** No duplicate attribution state in the frontend store; everything derives from the server's single source of truth.

# Guided Rehearsal (G2, #1046) — Implementation Plan of Record

> **Starting point.** This is the single consolidated plan for #1046, selecting the verified-best from the PO/PM/Dev syntheses and discarding what didn't survive review. Docs-only. Supersedes #1180 (deleted), #1185 and #1186 (earlier drafts). Every RPC/table name below was checked against `origin/main`.

**Prerequisites (verified merged on `main`):** #1163 attribution authority (`abb43df8`), #1151 Private recording proof (`be4b9b16`), G1 foundation (`3b9bdd1e`, #1158, hard-off). Branch all work off latest `origin/main`.

---

## 0. Two locked decisions that shape everything

### A. Backend naming = function-based (`objective_`), never product names
"Freestyle" and "Guided" are **product/marketing names** owned by the branding PR (#1149) and **will change**. The backend must not encode them. The practice-objectives feature stores the user's *objectives* for a session, so its function-based token is **`objective_`**.

- **Why now / why safe:** G1 shipped as `guided_*` but is **provably empty in production** — `objective`/`guided` briefs have *no client INSERT grant and no write RPC*, guided is hard-off (`has_*_capability` defaults `false`), and no frontend calls any `guided_` RPC. Zero rows, zero analytics depend on it. Pre-launch is the cheapest possible time to correct the token; post-launch it would be frozen. (Policy written into `product_release/STT.md`.)
- **Translation seam:** customer labels live only in `frontend/src/constants/productNames.ts`; the service layer exposes typed enums over stable `objective_` tokens. A product rename touches one file; the DB never learns of it.

### B. Private-only, fail-closed (Cloud & Browser are dead)
Private on-device STT is the **only** engine in the user journey. Cloud is permanently removed; Browser is removed (externally-processed Web Speech is the opposite of private and transcribes poorly — **no "quick tryout"**). The **only** permitted fallback is the *internal* pre-recording device-capability cascade **Private v4 (WebGPU) → v2 (WASM)**; v4 is currently hard-off (#1044) so v2 (`whisper-base.en`) is the authoritative shipped engine. Devices that can run **neither** → **fail closed** with honest copy, never a silent external fallback.

> **Scope note (timing):** *Enforcement* ships now — no engine selector, intent statically declares `private`, `attest_session_engine_v1` accepts only `private`. *Physical deletion* of the dead Browser/Cloud adapter code is the **#1184 post-launch fast-follow**, not a launch gate (it's a risky refactor of the shared recording path). Same user-facing outcome; lower launch risk.

---

## 1. Product (PO) — what G2 is
Where **Freestyle** is unstructured practice, **Guided** lets the user declare *focus points* (objectives) before recording; afterward the system evaluates whether each was covered (**Hit / Missed**) and directs the user to rehearse until they consistently land them. Feedback has clarity/quality parity with the existing loop; sessions carry through History, Analytics, and PDF.

**Truthfulness bar.** Engine identity is **client-declared and server-recorded via #1163 — not server-proven**; only a recorded `private` class unlocks Guided evaluation. With no selector and no other engine, the on-device guarantee is structural. Voided-case copy: **"Guided Rehearsal requires on-device processing, which was unavailable this session."** Incompatible-device copy: **"SpeakSharp requires on-device processing to guarantee your privacy. Your current device does not support this."**

---

## 2. The exact `guided_ → objective_` rename map (foundation migration)
A single forward migration renames every G1 object (empty tables → mechanical, zero data risk). Tables via `ALTER … RENAME`; functions/policies/constraints/enums dropped+recreated under the new names with grants re-applied.

| Kind | `guided_*` (G1, on main) | → `objective_*` |
|---|---|---|
| tables | `guided_account_capability`, `guided_project`, `guided_brief`, `guided_brief_point`, `guided_session`, `guided_source_recording`, `guided_evidence`, `guided_action` | same stems → `objective_account_capability`, `objective_project`, `objective_brief`, `objective_brief_point`, `objective_session`, `objective_source_recording`, `objective_evidence`, `objective_action` |
| enums | `guided_action_kind`, `guided_evidence_verdict` | `objective_action_kind`, `objective_evidence_verdict` |
| RPCs | `has_guided_capability`, `guided_approved_predicate_version`, `guided_assert_start_identity`, `guided_start_session_v1`, `guided_register_source_v1`, `guided_finalize_evidence_v1`, `guided_select_action_v1`, `guided_dispute_action_v1` | drop-in `objective_*` equivalents (same signatures/bodies, `search_path` pinned, grants re-applied) |
| policies / constraints / indexes | `*_select_own`, `*_nonblank`, `*_positive`, `*_key`, etc. | suffix-preserving `objective_*` renames |
| **NEW** (the one real gap) | — | **`issue_objective_brief_v1(p_project_id uuid, p_goal text, p_focus_points jsonb)`** — `SECURITY DEFINER`, owner-scoped validation, inserts `objective_brief` + `objective_brief_point`; `GRANT EXECUTE … TO authenticated`. (G1 left brief tables SELECT-only — no write path.) |

---

## 3. Architecture (Dev) — verified against `main`
- **No fork.** Parameterize the existing loop by `mode`; extend `SpeechRuntimeController.ts` and `frontend/src/services/progress/{recordProgress,loadSessionProgress,buildProgressEvaluation,progressPresentation}.ts`.
- **Attribution gate:** `get_session_engine_class_v1(p_session_id uuid) → text`; Guided evaluation proceeds only on `private`, else graceful "unavailable".
- **Fallback signal (correction):** `attest_session_engine_v1(p_session_id uuid, p_runtime_evidence jsonb) → text` — **there is no `fallback_occurred` parameter**; evidence rides inside `p_runtime_evidence`; a declared-`private`-vs-actual mismatch resolves to `unattributed`. Pre-session declaration = `issue_attribution_intent_v1` (statically `private`).
- **Loop driver:** `objective_select_action_v1(p_session_id uuid) → uuid` (next unmet action) + `objective_finalize_evidence_v1`.

---

## 4. Phased PRs (independently reviewable, DAG order)
1. **`feat(core): STT exclusivity` (enforcement)** — remove engine selector from UI; intent/`SpeechRuntimeController` demand `private`; internal v4→v2 is the only fallback; fail-closed. *No adapter-code deletion (that's #1184 fast-follow).*
2. **`feat(objective): foundation`** — the §2 rename migration + `issue_objective_brief_v1`.
3. **`feat(objective): focus-point capture`** — form (gated by `has_objective_capability()`), `productNames.ts` seam, unit/integration tests.
4. **`feat(objective): feedback loop + parity`** — wire `recordProgress`/`record_progress_evaluation` + `objective_finalize_evidence_v1` → Hit/Missed panel.
5. **`feat(objective): continuity readback`** — History + Analytics (`get_analytics_summary`) + PDF render `objective_evidence`/`objective_action`.

---

## 5. Definition of Done (#1046 evidence)
- Exact-head CI/SCA green; independent binary review.
- **Negative proofs:** forcing a fake Browser/Cloud response is hard-rejected by `attest_session_engine_v1`; stale/missing attribution → ineligible, never defaulted-in; incompatible device → fail-closed (no external fallback).
- **Positive E2E:** `/practice?mode=guided` → supply points → record Private → Hit/Missed renders.
- Focus-point persistence + feedback parity; exact-session readback across History/Analytics/PDF.
- No duplicate attribution state in the frontend — server is the single source of truth.
- Gates green: #1151, #1164; #1163 rolled out.

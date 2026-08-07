# Guided Rehearsal (G2, #1046) — Canonical Implementation Plan

**Status:** adopted plan of record for #1046. Supersedes the earlier drafts (#1180 — deleted as junk; #1185 — earlier synthesis with a rejected `objective_*` schema rename). This document keeps only the parts that survived review and corrects the parts that did not.

**Prerequisites (verified on `origin/main`):** #1163 attribution authority (`abb43df8`) and #1151 Private recording proof (`be4b9b16`) are merged. G1 foundation (`3b9bdd1e`, #1158) is merged **and applied to production**. Branch all G2 work off the latest `origin/main`.

---

## 1. What G2 is (kept from the PO/PM/Dev drafts)

Guided Rehearsal extends the **existing** Freestyle practice loop with an explicit, goal-oriented layer:
1. **Before recording** the user declares *focus points* (a brief) — e.g. "reduce filler words", "slow down".
2. **During recording** the session runs on **Private STT only**.
3. **After recording** SpeakSharp evaluates delivery against those focus points (**Hit / Missed**) with clarity/quality parity to Freestyle.
4. **Later** the outcome is reviewable in History, Analytics, and PDF export.

Truthfulness bar (unchanged): on-device Private STT only; if the producing engine is not provably `private`, the Guided outcome is **voided gracefully** ("Guided evaluation unavailable — Private STT required"), never silently evaluated on another engine.

---

## 2. Architecture decisions (what we keep, what we reject)

### ✅ Keep
- **No fork.** Parameterize the *existing* practice loop by `mode: 'freestyle' | 'guided'` (`SpeechRuntimeController`, `useSessionLifecycle`, `PracticeSession`). One recording pipeline.
- **Build on the merged G1 `guided_*` schema.** `guided_project`, `guided_brief`, `guided_brief_point`, `guided_session`, `guided_evidence` (Hit/Missed verdict enum), plus existing RPCs `guided_finalize_evidence_v1`, `guided_select_action_v1`, `guided_dispute_action_v1`, `has_guided_capability()`.
- **Consume #1163 authority.** Gate Guided evaluation on `get_attribution_authority_v1(session_id)` / `get_session_engine_class_v1(session_id)` returning `private`; otherwise `unattributed` → graceful "unavailable".
- **Reuse the evaluation path** (`guided_finalize_evidence_v1` + `record_progress_evaluation`) — do not invent a new evaluator.
- **Naming boundary** (now a written policy in `product_release/STT.md`): DB/RPC/telemetry keep stable `guided_*` tokens; product-facing labels ("Focus Points", "Guided Rehearsal", or whatever #1149 lands) live only in `frontend/src/constants/productNames.ts`. Components may be named after the product concept (`ObjectiveSetupForm.tsx` etc.) — cheap to rename; the DB is not.

### ❌ Reject (the "bad parts")
- **Renaming the DB from `guided_*` to `objective_*`.** It is a 65-object destructive migration against a **prod-applied** schema, throws away a reviewed migration mid-program, and re-couples the durable layer to `objective` — a term that is itself *not* locked (#1149). Zero architectural gain; maximal churn. **The schema stays `guided_*`.**
- **Inventing `objective_briefs` / `evaluate_objective_session_v1` / `get_analytics_summary_v2` / `has_objective_data`.** None exist; the real names are `guided_*`, `guided_finalize_evidence_v1`, and `get_analytics_summary`. Use those.
- **Deleting Browser/Cloud runtime/adapter code inside G2.** #1184 is explicit: this is a *clarity* decision, **not** an immediate code reversal — "we are not ripping out the Browser/Cloud runtime paths right now… cleanup is a post-launch fast-follow." G2 does **soft** deprecation only (see §3, PR2).
- **Treating v4 as the active primary.** Private v4 is **hard-off** (research only). At launch the engine is effectively **v2 (WASM)**; the v4→v2 cascade is internal device-capability routing, never user-visible.

---

## 3. The one genuine backend gap

G1 left `guided_brief` / `guided_brief_point` with RLS **`SELECT`-only** (no client `INSERT`). So the **only** net-new backend object G2 needs is a write RPC:

> **`issue_guided_brief_v1(p_project_id uuid, p_goal text, p_focus_points jsonb)`** — `SECURITY DEFINER`, `search_path` pinned, owner-scoped validation, inserts `guided_brief` + `guided_brief_point` rows on the caller's behalf. Mirrors the security pattern of #1163's RPCs. `GRANT EXECUTE … TO authenticated`.

Everything else in the loop reuses existing G1/#1163 RPCs.

---

## 4. Phased PRs (independently reviewable; DAG order)

| PR | Scope | Owns | Depends on |
|----|-------|------|-----------|
| **PR1 — Focus-Point Capture** | migration `issue_guided_brief_v1` + `productNames.ts` seam + focus-point form (gated by `has_guided_capability()`) + unit/integration tests | #1046 | main (#1163/#1151/G1) |
| **PR2 — Guided requires Private** | enforce `private` **at the guided entry**: guided sessions declare `private` intent and `startRecording` rejects a non-`private` intent for guided. **Soft** only — no selector deletion, no adapter removal. | #1046 (guided-scoped) | PR1 |
| **PR3 — Guided feedback loop** | on save, verify engine via `get_session_engine_class_v1`; if `private`, run `guided_finalize_evidence_v1` / `guided_select_action_v1` → Hit/Missed panel with Freestyle parity; else graceful "unavailable" | #1046 | PR2 |
| **PR4 — Continuity/readback** | History + Analytics (`get_analytics_summary`) + PDF render `guided_evidence` | #1046 | PR3 |

### Scope boundary vs #1184 (important)
The **global** "no engine selector anywhere / Private-only UI" change is **#1184's lane** (soft-deprecate now, code cleanup fast-follow). G2 must **not** re-implement or duplicate that global teardown. G2 only guarantees *guided sessions* are Private (PR2, scoped). If #1184's global de-surfacing lands first, PR2 shrinks accordingly.

---

## 5. Definition of Done
- Exact-head CI/SCA green; independent binary review complete.
- Playwright E2E: **positive** (`/practice?mode=guided` → supply points → record Private → Guided Hit/Missed renders) and **negative** (forced fallback → session saves, Guided outcome shows "unavailable").
- No duplicate attribution state in the frontend store — everything derives from the server's single source of truth.
- Qualification gates green: #1151 (Private proof), #1164 (retention preflight); #1163 rolled out (done).

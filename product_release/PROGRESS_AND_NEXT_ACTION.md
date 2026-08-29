**Status:** Authoritative (SSOT for personal session-over-session Progress and the single next practice action)
**Owner:** Product Owner (relativityE)

> **UPDATE 2026-08-09 (PO decision):** the headline comparison target changed from the **baseline (first) session** to the user's **PREVIOUS comparable session** — "±n% vs your previous session". The code (`utils/aggregateProgress.ts`, `components/session/ProgressVsBaseline.tsx`) and the user-facing FAQ already reflect this. §5/§6/§7 below still describe the earlier baseline framing (including the illustrative tables and `baseline_session_id` telemetry) and are pending a full reconcile under **#1051** (docs closeout). Where this note and the sections below disagree, **this note wins** on the comparison target. The first session still shows a no-delta starting state.

**Last Reviewed:** 2026-08-08
**Last Verified:** 2026-08-08 — §5/§6/§7 reconciled per the #1222 Product-Owner decision (2026-08-08): Progress is the **SpeakSharp Score successor** — a session-over-session improvement in a **composite clear-delivery measure**, now expressed as a **signed percentage** vs baseline (points → percentage, for defensibility). **Filler rate is one component** of that composite and is the component **v1 surfaces** (`frontend/src/utils/progressVsBaseline.ts`, session-page card `components/session/ProgressVsBaseline.tsx`, filler-evidence `validatedFillerTotal`/`sessionAnalysis.ts`); more components are added later without changing this contract. No run IDs, SHAs, or current release posture are carried here.
**Applies To:** Every surface that tells a user how their practice is changing over time and what to practise next — Progress, Session review, and history.
**Class:** Product requirement / decision.
**Authority:** The source for what Progress means, which sessions may influence it, how direction is derived and worded, the exactly-two-takeaway output contract (of which exactly one is an action), and what must never be claimed.
**Not Authoritative For:** STT engine behaviour, accuracy, latency and attribution mechanics (→ `STT.md`); persisted schema and retention (→ `ARCHITECTURE.md`); tier / entitlement / quota gating (→ `ENTITLEMENTS_AND_BILLING.md`); general product guarantees and copy outside this loop (→ `PRODUCT_REQUIREMENTS.md`); evidence taxonomy and test protocol (→ `QUALITY.md`); current release posture, run IDs and SHAs (→ `RELEASE_STATUS.md`); dated proof artifacts and one-off audit runs (→ `EVIDENCE_INDEX.md`); open/deferred items (→ `ROADMAP.md`).
**Not authoritative for:** current release posture, baselines or work sequencing (→ [`RELEASE_STATUS.md`](./RELEASE_STATUS.md), [`ACTIVE_COORDINATION.md`](./ACTIVE_COORDINATION.md)). This file defines the Progress CONTRACT; it deliberately carries no SHAs or run IDs, so a reader must not infer current status from its review date.

**Supersedes:** the planned canonical destination formerly named `COACHING_SCORE.md` (never created) and the Personal-Progress direction in `SPEAKSHARP_SESSION_PROGRESS.operational.md` (interim source; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` extraction mapping; the code paths cited inline; #1045 Product-Owner decisions.

# SpeakSharp Progress and Next Action (v1)

Canonical statement of how SpeakSharp tells a user **whether their own practice is moving**, **what evidence supports that**, and **what to practise next** — and of the claims it must never make.

This is a **documentation** artifact. It defines the contract; it changes no application code, migration, or product behaviour on its own.

**Precedence reminder (from `README.md` §1).** Everything here is a **Level-1 user-trust** surface: a number or phrase shown to a user must be true of that user's own recorded practice. **If runtime behaviour violates this Level-1 contract, the implementation or the user-facing surface is wrong.** The conflict is a **release blocker requiring explicit reconciliation** — runtime behaviour does not silently supersede the promise.

---

## 1. Scope & boundaries

This document owns **the personal progress loop and the one next action**. It routes out:

- How audio becomes a transcript, and engine accuracy/latency/attribution → `STT.md`.
- Where evidence is stored and for how long → `ARCHITECTURE.md`.
- Who is entitled to which engine → `ENTITLEMENTS_AND_BILLING.md`.
- One-off audit runs, their queries and their outputs → `EVIDENCE_INDEX.md` / `ROADMAP.md`. **Temporary audit mechanics are deliberately not recorded here.**

---

## 2. What Progress is — and what it must never claim

Progress is a **personal, session-over-session comparison**: this eligible session against the user's **previous comparable session** and against their **baseline**, with the observable evidence behind the movement, and **one measurable next action**.

**The number is background; the two takeaways are the product (PO 2026-08-08).** The progress % is quiet supporting context — we never ask the user to stare at or optimise a number. What carries the value is the **two takeaways** ("What worked" ≤6 words / "Try next" ≤8 words, §7), intensely grounded in *that user's own session signals*. **Success is the user adjusting their next session based on that guidance** — not the number moving. Surfaces must present the % as secondary and the takeaways as primary. The v1 aggregate signal set + rollout live in **#1206**.

**Prohibited, without exception:**

- **No universal or absolute score.** No 0–10, no 0–100, no single number presented as how good the user is.
- **No grade or rating** of the user or of a session.
- **No cross-user comparison** — no percentile, ranking, leaderboard, cohort placement, or "better than N% of speakers".
- **No "overall speaking quality/ability" claim.** Progress measures a defined, observable delivery metric — never the whole of speaking.
- **No presenting one metric as overall Progress.** Progress is a **composite** clear-delivery measure shown as a **percentage** change vs baseline (§5); when a single component (e.g. the v1 filler rate) is surfaced, it is labelled as exactly that component — never as overall speaking quality or ability.
- **No fabricated positive.** If the evidence does not support a positive statement, the honest evidence state is shown instead.

### `clarity_score` is an evidence input, not the product model

The database column `sessions.clarity_score` and the function `calculateClarityScore()` (`frontend/src/utils/sessionAnalysis.ts`) are **legacy internal implementation names, retained for compatibility** — renaming a persisted column carries migration risk for no user benefit. They are **one evidence input** to this contract. They are **not** an overall score, **not** a grade, and **must never be surfaced to a user as one**. Any user-facing wording comes from §5 of this document, never from the internal name.

---

## 3. The loop

```
Current eligible session
    ↓  compare with the previous comparable session and with the baseline
Direction: moved up / moved down / no meaningful change yet
    ↓  explain the observable supporting evidence
Exactly two takeaways:
    What worked          (≤ 6 words, not an action)
    Practice this next   (≤ 8 words, THE action -- structured, measurable target)
    ↓  measure it in the next comparable session
```

---

## 4. Two ordered, independent gates

**Metric validity** decides whether a measurement *exists* (structural; a genuine measured zero is valid and is never reclassified as missing).

**Session eligibility** decides whether a session may *influence* Progress or the next action. A session is eligible only when **all** hold:

| Condition | Requirement |
|---|---|
| Status | `completed` |
| Spoken duration | **≥ 30 s** |
| Word count | **≥ 75** |
| Transcript | present |
| Attribution | `attribution_status = 'verified'` (`isVerifiedAttribution`, `frontend/src/constants/attributionStatus.ts`) |

The 3-word `MIN_RELIABLE_SCORING_WORDS` rule (`sessionAnalysis.ts`) decides whether a metric is *computable*; it is **not** eligibility. `MIN_SESSION_DURATION_SECONDS` is a **persistence** floor, not eligibility. Conflating them is what would let a four-second accidental take move a trend.

Every excluded session records a deterministic exclusion reason (`too_short`, `too_few_words`, `no_clarity_evidence`, `no_transcript`, `engine_not_comparable`, `unverified_attribution`); an unknowable reason is recorded as `unknown`, never guessed.

**Comparable cohort** = exact `engine` × exact `engine_version` × exact `model_name` × formula version. `model_name` is included because `engine_version` is **not proven** to uniquely and durably identify the producing model for every engine — `sessions` stores the two independently (`engine_version`, `model_name`), so version alone could silently mix two models. A user who changes engine, version or model **starts a new cohort**; no cross-cohort difference is ever computed or displayed, and the interface says the comparison restarted rather than showing a false jump.

---

## 5. The measurement

**Value:** the signed **percentage** change in the user's **clear-delivery progress measure** against their **baseline**; the change against the previous comparable session is also recorded. This is the **successor to the retired SpeakSharp Score** — the same session-over-session improvement idea, now expressed as a **percentage** rather than points because a percentage is easier to explain and to defend ("+18% since your baseline"). *(Metric-unit decision: #1222, Product Owner, 2026-08-08 — points → percentage.)*

- **A composite of a few delivery components — not a single metric.** Clear delivery is made up of a handful of measured components; **filler rate (fillers per minute) is one of them**, and it is the component **v1 surfaces** (the mockups' "N% fewer fillers than session 1"). Additional components are added over time **without changing this contract** — each is still a session-over-session percentage against the same baseline, and no single component is ever presented as the whole of Progress (§2).
- **Rates, never raw counts.** Each component is a rate or ratio, so a longer session is never penalised for having more of something. For the v1 filler component the canonical per-session total is the validated total (`validatedFillerTotal`, `sessionAnalysis.ts`); a session with **no valid evidence for a component** contributes nothing to that component — never counted as a flattering zero.
- **Baseline = the first eligible *future* session.** There is **no historical backfill** in v1. Until a baseline exists, Progress shows an honest "not enough data yet" / "baseline established" state — never a fabricated zero.
- **Evidence is exact — no rounding-equivalence hazard.** Component inputs (e.g. an integer filler count and a duration) are exact, so each rate is computed from exact values; only the **displayed** percentage is rounded (to 1 decimal), and all arithmetic uses the unrounded values.
- **Percentage, with a guarded denominator.** The denominator is the baseline value of the component. When a **baseline value is 0** (e.g. a genuinely filler-free baseline over the comparable-duration floor) there is no meaningful percentage for that component, so it is reported as **at baseline / no meaningful change** rather than dividing by zero — a percentage is never fabricated from an undefined division.
- **v1 aggregate signal set + rollout → #1206.** Target components: filler rate, clarity, pace/WPM, pause rhythm. **v1 ships filler rate + clarity** (equal weight, direction-normalized, anchored to the session-1 baseline); pace/WPM (needs an ideal-range/band transform) and pause rhythm (needs evidence coverage) round out the aggregate once fixed. **Session 1 shows its aggregate AS the "baseline signal"** (the user's starting reference; FAQ #1200 explains it), no delta. A signal is included only when it has valid evidence in BOTH sessions being compared. **We do NOT measure tone or confidence** (no prosody) — those are inferences/future work and must not be presented as measured. A future secondary line "vs last session" = `aggregate(N) − aggregate(N−1)` is documented but deferred.

---

## 5a. Metric definition matrix (#1265)

Every displayed and persisted delivery metric has **one** definition, shared across session review, telemetry, stored data, Progress, and the PDF. The comparability floor and the quality-mapping tunables live in code as the single source of truth (`frontend/src/utils/aggregateProgress.ts`), and `frontend/src/utils/progressVsBaseline.ts` re-exports the floor rather than redefining it. `tests/config/progress-metric-consistency.test.ts` fails if this table drifts from those constants.

| Metric | Unit | Quality mapping (0..1) | Direction | Code constant |
|---|---|---|---|---|
| Filler rate | fillers/min | linear to 0 at **10** fillers/min; lower is better | lower = better | `FILLER_RATE_ZERO_QUALITY = 10` |
| Clarity | 0..100 | the value itself (÷100); higher is better | higher = better | `sessions.clarity_score` (evidence input, never a user score) |
| Pace | words/min (WPM) | inside the band **[130, 150]** = 1; linear falloff over **60** WPM outside | banded (faster is not blindly better) | `PACE_IDEAL = [130,150]` (the shared 130–150 authority — `ANALYTICS_THRESHOLDS.TARGET_WPM_MIN/MAX`), `PACE_TOLERANCE = 60` |
| Pause rhythm | % of session that is silence | inside the band **[5, 20]%** = 1; linear falloff over **20** pp outside | banded | `SILENCE_IDEAL = [5,20]`, `SILENCE_TOLERANCE = 20` |

**Comparability rules (both gates):**
- **Duration gate:** a session counts toward comparison/trend only at **≥ 30 s** spoken (`MIN_COMPARABLE_SECONDS = 30`, defined once). This is distinct from the 3-word *computability* rule and the persistence floor (§4).
- **Mode gate:** only compatible sessions are compared. **Open Mic delivery progress and Focus Points coverage are separate measures** and are never mixed into one number.
- **Comparison targets:** the **previous comparable session** for near-term change, with the **first comparable session** preserved as baseline context. A signal is included only when it has valid evidence in **both** sessions.

---

## 6. Direction language (neutral, non-evaluative)

| State | Wording |
|---|---|
| Improved | **"18% fewer fillers than your baseline."** (positive percentage) |
| Declined | **"12% more fillers than your baseline."** (negative percentage, same size + neutral tone) |
| Below meaningful-movement policy | **"No meaningful change yet."** |
| No baseline yet | **"Baseline established — we'll compare future eligible sessions with this one."** |
| Not comparable | **"Not enough comparable data yet"** + the reason |

Direction is described as **movement**, never as praise, blame, or a verdict. "More fillers than your baseline" is not a failure statement; it is an observation about one measure of one session, shown at the same size and in the same neutral tone as an improvement — never scolded.

The minimum movement that counts as meaningful is a **product policy value**, set by the Product Owner and recorded with the formula version. It is **not inferred from observed variance** — natural session-to-session variation is not measurement noise.

---

## 7. Exactly two takeaways — one of which is the action

Each eligible session yields **exactly two takeaways**, and **exactly one of them is an action**. This is the same contract `#1047-A` (Session review) implements; the two authorities must not diverge.

1. **What worked** — the strongest *valid* positive from the current session. **Maximum 6 words.** Not an action.
   **Non-positive fallback (required).** A session can satisfy every §4 eligibility condition while having **no valid positive** — every measured metric declined or sat outside its healthy band. The three rules "exactly two takeaways", "strongest valid positive" and "never fabricate a positive" would otherwise be unsatisfiable together, so this case is resolved explicitly: the first takeaway falls back to a **neutral factual observation** about the current session (for example a steady measured value, or the honest evidence state), stated without praise and without implying improvement. **It is never omitted, and a positive is never invented.**
2. **Practice this next** — the single next action. **Maximum 8 words.** Carries a **structured, measurable target** into the following session.

No third takeaway. No opening verdict sentence. Both are tethered to the **current** saved session; history supplies comparison context separately and never becomes a takeaway.

The action is selected **deterministically** and:

- Selection weighs evidence validity, reliability, whether the difference is meaningful, and user actionability — **not** simply the largest raw gap.
- The action is **measurable**: it names a metric, a direction, and a target value.
- If evidence is insufficient, the honest evidence state plus one data-collection action is shown. **Never a fabricated positive.**
- Wording is **deterministic** in v1. No AI generation participates in selection or phrasing (§9).

---

## 7a. What every displayed movement must expose

A number is only trustworthy if the user can see what produced it. Every displayed movement must be able to expose, on request:

- the **two sessions** being compared (the current session and the previous comparable session, or the baseline);
- the **component** that moved and its **unit** (a percentage change vs baseline — for the v1 filler component, percentage change in fillers per minute);
- the **evidence inputs** behind that metric for both sessions (canonical filler count, spoken duration, and — for context — word count and WPM);
- the **cohort** (engine, engine version, model name, formula version) that made them comparable;
- **why a comparison is unavailable**, when it is — the deterministic exclusion reason, never a blank or a zero.

No displayed movement may depend on evidence the user cannot inspect.

## 7b. Worked example (canonical)

*Illustrative shape only — the numbers are an example, not measured data. Shown for the **v1 filler-rate component**; other components resolve the same way against the same baseline.*

| Session | Eligible | Filler rate (fillers/min) | Shown |
|---|---|---|---|
| 1st eligible | yes | 3.4 | **"Baseline established"** — no movement claimed |
| 2nd eligible, same cohort | yes | 2.4 | **"29% fewer fillers than your baseline."** ((3.4 − 2.4) ÷ 3.4 = 29.4%, rendered as 29%) |
| 3rd, 22 s long | **no** | — | No movement. Recorded `eligible=false`, `too_short`. Progress is unchanged — **not** reset, **not** zero |
| 4th eligible, engine changed | yes | 2.1 | **"Not enough comparable data yet"** — new cohort; **no** cross-cohort difference is computed |

The percentage is computed from the exact (unrounded) filler rates; only the displayed figure is rounded. An ineligible session never moves, resets, or dilutes Progress.

## 7c. Completion is not performance

Finishing a session, practising often, or maintaining a streak are **participation** facts. They must never be presented as evidence that delivery improved, and they must never contribute to the movement figure or to either takeaway. Encouraging repeat practice is legitimate; implying that repetition *is* improvement is not.

---

## 8. What must be persisted

*None of the records below exist yet. This section is a **requirement**, not a description of current behaviour; implementation status → `ROADMAP.md` / `RELEASE_STATUS.md`.*

**Every future persisted `completed` session must receive one versioned Progress evaluation record.** This single model carries both outcomes, so eligibility and exclusion are never tracked in two places:

- **Always recorded — for every evaluation, eligible or not.** These are the facts needed to *prove* an eligibility decision or an exclusion afterwards, so each must be persisted or immutably referenced:
  - `session_id`;
  - transcript / filler-evidence **availability** (the fact that valid filler evidence was present or absent — not the transcript itself);
  - `engine`, `engine_version`, `model_name`;
  - `attribution_status`;
  - `duration` and `word_count`;
  - `formula_version` and the **evaluation timestamp**;
  - `eligible` (bool), and — when `eligible = false` — the deterministic `exclusion_reasons` from §4.

  Without all of these, an exclusion cannot be audited later: *"why was this session not counted?"* must be answerable from the record alone, never recomputed from mutable state.
- **Recorded only when `eligible = true`:** the unrounded filler rate and its inputs (canonical filler count, spoken duration; plus word count and WPM for context), the cohort key, and explicit **`baseline_session_id`** and **`previous_comparable_session_id`** references. Baseline and previous-comparable references stay **eligible-only** — an ineligible evaluation never carries them.
- **Only eligible records influence Progress**, the direction statement, or either takeaway. An ineligible record is retained as an honest audit trail and is never averaged in.
- Records are **additive**: no existing session row is ever rewritten.

**Recommendations and attempts must be separate records** — one recommendation may be attempted many times:

- **Recommendation (immutable):** `recommendation_id`, source session, source metric value and its version, target metric, direction, target value and **units**.
- **Attempt (one-to-many):** its own id, accepted timestamp, the resulting practice session, the next comparable session, and a lifecycle of `pending | completed | not_comparable | abandoned`.
- **Outcome** must record whether the targeted metric moved in the recommended direction. This is a **directional observation only** — the product must never claim the recommendation *caused* the change.

## 8a. Durable safeguards carried forward from the retired score

The legacy 0–10 score is retired, but several of its **safeguards were sound and remain binding** — they protected users from over-claimed precision and from shaming language, independently of any particular formula.

- **One deterministic truth, reused everywhere.** A session's evaluation is computed once, and the **same stored result** is what Session review, Analytics and the exported PDF display. These surfaces must never recompute independently and must never disagree. *(carried from: Signed-Off Architecture Boundary)*
- **Feedback is concise and actionable.** Output stays short and tied to something the user can actually do next — never a wall of metrics, never commentary without a next step. *(carried from: User Experience Rules)*
- **Non-shaming filler language.** Filler words are described neutrally, as an observable pattern. No wording that mocks, scolds, or implies the user is a poor speaker. *(carried from: User Experience Rules)*
- **Movement is always paired with an action.** A number is never shown alone; every displayed movement is accompanied by the one next action (§7). *(carried from: Number-To-Coaching Flow)*
- **No over-claimed precision.** Displayed figures never imply more accuracy than the evidence supports — no false decimals, no confidence claims the data cannot carry, no percentile or benchmark framing. *(carried from: Release Guardrail)*

These are **release guardrails**: a surface that violates one is wrong and must be corrected, exactly as the precedence reminder above requires.


## 9. Determinism and cost

- **Selection and wording are deterministic in v1.** **Zero AI-generation calls** are made for Progress or the next action. AI phrasing may be reconsidered later only behind an explicit user action, the appropriate entitlement and consent, and an atomic persisted request lock — an idempotency key alone does not prevent concurrent duplicate provider calls.
- **Zero incremental Cloud transcription.** Progress reads persisted evidence and, where a value must be recomputed, uses only local text operations on the stored transcript. No transcription engine is invoked by Progress.

---

## 10. Explicitly out of scope for v1

Pause rhythm (insufficient measured coverage), message structure and punctuation-derived coaching (engine-dependent), finalization duration (a performance metric, never a speaking-progress input), any absolute score or leaderboard, and any claim the repository cannot support.

---

*Personal progress contract. It defines comparison, direction, evidence and one next action for a single user against their own practice — never a grade, never a ranking, never a claim about overall speaking ability.*

---

## #1367 reconciliation (2026-08-29)

- **Personal Progress is built, wired and user-reachable.** Entry `/session` → `SessionPage` →
  `SessionOverhaulView` → `ProgressVsBaseline` in slot C of the before/during/after states. No feature flag and no
  entitlement gate on that path. Eligibility: `durationSeconds >= 30` **and** a non-null composite quality
  (`utils/aggregateProgress.ts`). Any remaining "unbuilt" assertion elsewhere is stale.
- **The next action is persisted but the outcome loop is not closed.** `sessions.next_action_signal` stores the
  prior recommendation, and `AnalyticsDashboard` renders it. Attempt evidence, comparable-session eligibility,
  target-specific outcomes and attribution limits are all **absent** — so advice plus later improvement can show
  **association only**, never that the user attempted the advice and never causation. #1259 is an instrumentation
  and attribution gap, not a database join. Full audit: [`DOCUMENTATION_RECONCILIATION_LEDGER.md`](./DOCUMENTATION_RECONCILIATION_LEDGER.md) §10.4.
- **Canonical roadmap gap:** `ROADMAP.md` (canonical #3) does not exist. The deferral named #1272, which has
  **closed without producing it**; the live successor is **#1257**. Roadmap-level propagation lands here and in
  `RELEASE_STATUS.md` until #1257 delivers it ([`DOCUMENTATION_RECONCILIATION_LEDGER.md`](./DOCUMENTATION_RECONCILIATION_LEDGER.md) §11, GAP-1).

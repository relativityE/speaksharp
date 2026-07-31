**Status:** Authoritative (SSOT for personal session-over-session Progress and the single next practice action)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-31
**Last Verified:** 2026-07-31 — contract derived from the approved #1045 Product-Owner decisions and verified against the current code paths cited inline (`sessionAnalysis.ts`, `speakingScore.ts`, `SpeechRuntimeController.ts`, `attributionStatus.ts`). No run IDs, SHAs, or current release posture are carried here.
**Applies To:** Every surface that tells a user how their practice is changing over time and what to practise next — Progress, Session review, and history.
**Class:** Product requirement / decision.
**Authority:** The source for what Progress means, which sessions may influence it, how direction is derived and worded, the exactly-two-takeaway output contract (of which exactly one is an action), and what must never be claimed.
**Not Authoritative For:** STT engine behaviour, accuracy, latency and attribution mechanics (→ `STT.md`); persisted schema and retention (→ `ARCHITECTURE.md`); tier / entitlement / quota gating (→ `ENTITLEMENTS_AND_BILLING.md`); general product guarantees and copy outside this loop (→ `PRODUCT_REQUIREMENTS.md`); evidence taxonomy and test protocol (→ `QUALITY.md`); current release posture, run IDs and SHAs (→ `RELEASE_STATUS.md`); dated proof artifacts and one-off audit runs (→ `EVIDENCE_INDEX.md`); open/deferred items (→ `ROADMAP.md`).
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

**Prohibited, without exception:**

- **No universal or absolute score.** No 0–10, no 0–100, no single number presented as how good the user is.
- **No grade or rating** of the user or of a session.
- **No cross-user comparison** — no percentile, ranking, leaderboard, cohort placement, or "better than N% of speakers".
- **No "overall speaking quality/ability" claim.** Progress measures a defined, observable delivery metric — never the whole of speaking.
- **No presenting one metric as overall Progress.** While the plotted value is clear delivery, it is labelled as clear delivery.
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

**Value:** the signed change in the clear-delivery measure, in **points**, against the user's baseline; the change against the previous comparable session is also recorded.

- **Baseline = the first eligible *future* session.** There is **no historical backfill** in v1: existing `sessions.clarity_score` values are rounded integers and are **never rewritten**. Until a baseline exists, Progress shows an honest "not enough data yet" state — never a fabricated zero.
- **Evidence must be stored unrounded, from the first eligible future session onward.** `calculateClarityScore()` currently rounds to an integer. **The implementation must introduce** an unrounded counterpart that supplies raw evidence while every existing display remains byte-identical, and **before activation, equivalence tests must prove** that rounding the raw value reproduces the current function exactly across boundary and representative cases. *(None of this exists yet; implementation status → `ROADMAP.md` / `RELEASE_STATUS.md`.)*
- **All arithmetic must use stored unrounded values; rounding happens only at render.**
- **Points, not percentages** — there is no denominator, so no division-by-near-zero hazard.

---

## 6. Direction language (neutral, non-evaluative)

| State | Wording |
|---|---|
| Improved | **"Clear delivery moved up 4 points."** |
| Declined | **"Clear delivery moved down 2 points."** |
| Below meaningful-movement policy | **"No meaningful change yet."** |
| No baseline yet | **"Baseline established — we'll compare future eligible sessions with this one."** |
| Not comparable | **"Not enough comparable data yet"** + the reason |

Direction is described as **movement**, never as praise, blame, or a verdict. "Moved down" is not a failure statement; it is an observation about one measure of one session.

The minimum movement that counts as meaningful is a **product policy value**, set by the Product Owner and recorded with the formula version. It is **not inferred from observed variance** — natural session-to-session variation is not measurement noise.

---

## 7. Exactly two takeaways — one of which is the action

Each eligible session yields **exactly two takeaways**, and **exactly one of them is an action**. This is the same contract `#1047-A` (Session review) implements; the two authorities must not diverge.

1. **What worked** — the strongest *valid* positive from the current session. **Maximum 6 words.** Not an action.
2. **Practice this next** — the single next action. **Maximum 8 words.** Carries a **structured, measurable target** into the following session.

No third takeaway. No opening verdict sentence. Both are tethered to the **current** saved session; history supplies comparison context separately and never becomes a takeaway.

The action is selected **deterministically** and:

- Selection weighs evidence validity, reliability, whether the difference is meaningful, and user actionability — **not** simply the largest raw gap.
- The action is **measurable**: it names a metric, a direction, and a target value.
- If evidence is insufficient, the honest evidence state plus one data-collection action is shown. **Never a fabricated positive.**
- Wording is **deterministic** in v1. No AI generation participates in selection or phrasing (§9).

---

## 8. What must be persisted

*None of the records below exist yet. This section is a **requirement**, not a description of current behaviour; implementation status → `ROADMAP.md` / `RELEASE_STATUS.md`.*

**Every future persisted `completed` session must receive one versioned Progress evaluation record.** This single model carries both outcomes, so eligibility and exclusion are never tracked in two places:

- **Always recorded:** formula version, evaluation timestamp, duration, word count, `eligible` (bool), and — when `eligible = false` — the deterministic `exclusion_reasons` from §4.
- **Recorded only when `eligible = true`:** the unrounded clear-delivery value and its exact inputs (word count, canonical filler count, error-marker count, WPM), engine, engine version, model name, attribution status, cohort key, and explicit **`baseline_session_id`** and **`previous_comparable_session_id`** references.
- **Only eligible records influence Progress**, the direction statement, or either takeaway. An ineligible record is retained as an honest audit trail and is never averaged in.
- Records are **additive**: no existing session row is ever rewritten.

**Recommendations and attempts must be separate records** — one recommendation may be attempted many times:

- **Recommendation (immutable):** `recommendation_id`, source session, source metric value and its version, target metric, direction, target value and **units**.
- **Attempt (one-to-many):** its own id, accepted timestamp, the resulting practice session, the next comparable session, and a lifecycle of `pending | completed | not_comparable | abandoned`.
- **Outcome** must record whether the targeted metric moved in the recommended direction. This is a **directional observation only** — the product must never claim the recommendation *caused* the change.

## 9. Determinism and cost

- **Selection and wording are deterministic in v1.** **Zero AI-generation calls** are made for Progress or the next action. AI phrasing may be reconsidered later only behind an explicit user action, the appropriate entitlement and consent, and an atomic persisted request lock — an idempotency key alone does not prevent concurrent duplicate provider calls.
- **Zero incremental Cloud transcription.** Progress reads persisted evidence and, where a value must be recomputed, uses only local text operations on the stored transcript. No transcription engine is invoked by Progress.

---

## 10. Explicitly out of scope for v1

Pause rhythm (insufficient measured coverage), message structure and punctuation-derived coaching (engine-dependent), finalization duration (a performance metric, never a speaking-progress input), any absolute score or leaderboard, and any claim the repository cannot support.

---

*Personal progress contract. It defines comparison, direction, evidence and one next action for a single user against their own practice — never a grade, never a ranking, never a claim about overall speaking ability.*

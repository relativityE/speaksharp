> **Archived 2026-08-29:** the current contract is `product_release/PROGRESS_AND_NEXT_ACTION.md`.

**Owner:** [unassigned]
**Last Reviewed:** 2026-07-21
**Version:** v0.6.19-rc0
**Status:** Single canonical Session Progress contract. Part A (approved Personal Progress direction) governs; Part B (legacy 0–10 implementation) is retained as the ships-today record on a staged retirement path (definition round; no code).

# SpeakSharp Session Progress — Personal Baselines, Target Progress, and Outcome Recovery

> **This is the single canonical contract for SpeakSharp session progress.** It has two parts.
> **Part A — Approved Session Progress product direction** is authoritative and governs product
> direction. **Part B — Current legacy 0–10 implementation and staged retirement map** is retained
> **only** as the accurate record of the code that ships today (`frontend/src/utils/speakingScore.ts`),
> and remains live until its consumers are safely migrated (see the score-consumer inventory and
> Inchstone 11 in `BACKLOG.md`). There is **no second active source of truth**: where Part B calls the
> 0–10 score an "accepted current path" or a "gamification foundation," Part A supersedes that framing.

This document originally defined the research-informed scoring model behind the 0–10 SpeakSharp Score. The score is proprietary, but it is not arbitrary: it maps SpeakSharp measurements to established public-speaking evaluation categories. That model is preserved below as the legacy record.

The product rule is unchanged:

> Metrics are inputs. Coaching is the product.

Every result shown to a user must produce a small number of useful actions, not a wall of numbers.

---

# Part A — Approved Session Progress product direction

> The approved long-term direction: transparent **personal progress** against the user's own baseline
> and own targets (the Personal Progress model). This part is authoritative.

## A.0 Why the score is being retired

The 0–10 SpeakSharp Score grades the person against an unexplained universal standard: four
sub-scores are collapsed into one opaque number, mapped to an ability ladder ("Getting Started" →
"Polished Presenter"). A user cannot see *what changed compared with their own last attempt*, *which
target moved*, or *why* the number is what it is. SpeakSharp's direction is the opposite:

> SpeakSharp helps a user understand progress against **their own** previous comparable practice and
> **their own** selected targets. It must not grade the person against an unexplained universal
> standard.

Retirement is **staged**, not a delete: every current consumer of the score (live card, PDF,
telemetry, recommendations, tests, copy) is migrated first; the code is removed only after the last
consumer is gone. See `BACKLOG.md` for the inventory and the ordered inchstones.

Two conversions are explicitly **forbidden**:

- Do **not** convert the existing 0–10 score directly into a 0–100 percentage.
- Do **not** introduce a new opaque combined "Personal Progress Score" that averages unrelated
  focus areas into one headline number.

## A.1 Baseline: the first session is a starting point, not a grade

The first eligible session for a given focus area is the user's **personal baseline**. It is placed
at **0% progress from that baseline** — it is explicitly **not** 0% speaking ability, and it is
**not** placed on a universal 0–100 speaking-ability scale.

- Reaching a particular selected target represents **100% completion of that target** — not perfect
  speaking.
- Each focus area is calculated **separately**. Unrelated focus areas are **not** initially averaged
  into one headline percentage.
- The user-facing state for a first eligible session is **"Personal baseline established."**

## A.2 Target source (priority order)

1. A **user-selected, editable** target.
2. A **SpeakSharp-recommended** target that is **clearly labeled as a recommendation** and editable.
3. **No target percentage** when no defensible target exists — show raw direction only.

SpeakSharp may suggest targets, but a suggested target must be identified as a recommendation, never
as a universal standard.

## A.3 Progress calculation (two separate views — never conflated)

Two distinct numbers are computed for an eligible target. They are defined and displayed separately;
one is measured against a **fixed** point, the other against the **previous** session.

### (1) Cumulative target progress — against the FIXED personal baseline

The first eligible session under a particular **target version** establishes the **fixed baseline** =
**0% progress from baseline**. That baseline **remains fixed** — it is **not** reset to the previous
session — until the user changes the target materially or comparability is broken (§A.6). Reaching the
target = **100% of that target's original gap closed**. So the percentage scale does **not** move
after every session.

```text
baseline_gap        = distance(fixed_baseline,  target)    # FIXED across the target version
current_gap         = distance(current_session, target)
cumulative_progress = ((baseline_gap - current_gap) / baseline_gap) * 100
```

### (2) Previous-session movement — change since the last comparable session

Do **not** reset the baseline to the previous session. Compare the current `cumulative_progress` with
the **previous comparable session's** `cumulative_progress` and report the difference in **percentage
points**, alongside the **raw metric change**.

```text
session_movement_pp = cumulative_progress(current) - cumulative_progress(previous_comparable)
raw_change          = current_measurement - previous_measurement   # in metric units
```

`cumulative_progress` answers "how much of your **original** gap have you closed"; `session_movement_pp`
answers "did this session move you further than the last one." Neither is an ability score.

### Metric eligibility for a target-progress percentage

A metric qualifies for a `cumulative_progress` percentage **only** when it has all of: a **defensible
per-metric distance function**; a **defined raw measurement with a known confidence boundary**; and a
**visible, defensible target** that is user-selected or a clearly-labeled editable recommendation.
**Not every candidate metric qualifies — do not assume a distance function exists.**

| Target shape | distance() | Eligibility today |
| :--- | :--- | :--- |
| **Lower-is-better threshold** (e.g. fillers/min ≤ T) | `max(0, measured − T)` | **Eligible:** filler rate. |
| **Target range** (e.g. pace in [lo, hi]) | `0` inside; else distance to the nearest boundary | **Eligible:** speaking pace (WPM). |
| **Higher-is-better threshold** (distance *shape* only) | `max(0, T − measured)` | **No metric is claimed eligible under this shape yet** (see clarity note). |

**Clarity is NOT eligible for a target-progress percentage** until its measurement validity and target
meaning are separately proven. The current clarity signal is a proprietary 0–100 grade whose data
source, confidence boundary, and "higher is universally better" claim are **not** established.
Preserve `clarity_score`/`accuracy` as existing **inputs** where required, but for clarity show **raw
direction** or **"not eligible for target progress"** — never a clarity gap-closed percentage.

### Edge-case behavior (required)

| Situation | Behavior |
| :--- | :--- |
| **Already at target at baseline** (`baseline_gap == 0`) | Show **"Target maintained."** Never divide by zero. |
| **Target reached this session** | Cap completion at **100%** and show **"Target reached."** |
| **Regression** (moved away from target) | Allow a **negative** direction internally, but display the **raw measurement** and constructive language — never a shaming grade. |
| **Changed target** | **Version** the target and establish a **new baseline** for the new target; do not compare across two different targets as if continuous. |
| **Invalid comparison** (no defensible target, or non-comparable sessions) | Display **no percentage**; show raw direction and/or the exclusion reason. |

## A.4 What every percentage must expose

A `cumulative_progress` percentage may be shown **only** alongside all of:

- the **fixed baseline** value (and whether the baseline is user-selected or a labeled recommendation);
- current value;
- the target;
- the **named** fixed-baseline session and its **date**;
- the raw change vs the previous comparable session (e.g. "6/min → 5/min");
- when a previous comparable session exists, the **percentage-point movement** since it;
- the calculation itself.

A bare "12% closer to your delivery targets" with none of the above is **not** allowed.

## A.5 Worked examples (canonical)

**1 — Fixed baseline vs previous-session movement (fillers) [REQUIRED reference example]:**
- Fixed baseline: **8**/min · Target: **≤ 2**/min · Previous comparable session: **6**/min · Current
  session: **5**/min.
- `baseline_gap = max(0, 8−2) = 6` (fixed).
- Previous: `current_gap = max(0, 6−2) = 4` → previous `cumulative_progress = ((6−4)/6)×100 = 33%`.
- Current: `current_gap = max(0, 5−2) = 3` → current `cumulative_progress = ((6−3)/6)×100 = 50%`.
- `session_movement_pp = 50 − 33 = **+17 percentage points**`. Raw current-vs-previous change:
  **1 fewer filler/minute**.
- User-facing: *"Filler target: 50% of your original gap closed, up 17 percentage points from your
  previous comparable session."*
- Note the baseline stayed **8/min**; it was **not** reset to 6/min, so the 0–100% scale did not move.

**2 — Target range (pace), cumulative vs fixed baseline:**
- Fixed baseline: **180** WPM · Current: **165** WPM · Target range: **130–150** WPM.
- `baseline_gap = 180−150 = 30`; `current_gap = 165−150 = 15`. `cumulative_progress =
  ((30−15)/30)×100 = 50%` of the original gap closed.

**3 — First baseline:**
- One eligible session, no prior comparable session. No percentage. Show **"Personal baseline
  established."** and the raw measurements.

**4 — Already at target (at baseline):**
- Fixed baseline: **1.5** fillers/min · Target: **≤ 2**/min. `baseline_gap = 0`. Show **"Target
  maintained,"** not 0% and not a divide-by-zero.

**5 — Regression:**
- Fixed baseline: **6** fillers/min · Current: **7** fillers/min · Target: **≤ 2**/min. `current_gap
  (5) > baseline_gap (4)` → negative direction internally. Display the raw change ("6/min → 7/min")
  with constructive language; do not render a shaming grade.

**6 — Changed target (new baseline, versioned):**
- User moves the filler target from **≤ 4**/min to **≤ 2**/min. Version the target; the next eligible
  session becomes the **new fixed baseline** for the ≤ 2 target version. Prior progress against ≤ 4 is
  retained under the old target version, not silently rescaled.

**7 — Incompatible sessions (no comparison):**
- Previous comparable session used a different engine/mode (e.g. Browser vs Private) with no proven
  normalization. **Exclude** it, show **no percentage**, and state the exclusion reason.

**8 — Insufficient evidence:**
- Transcript confidence or speech quantity below the reliability threshold. Show **"Not enough
  comparable evidence."** and no percentage.

**9 — Clarity (ineligible for target-progress percentage):**
- Clarity raw signal **62 → 71** across two comparable sessions. Show the **raw direction** only
  ("clarity 62 → 71") or **"not eligible for target progress"** — **no** clarity gap-closed
  percentage — until clarity measurement validity and target meaning are separately proven (§A.3).

**10 — Agenda coverage percentage-point change (Outcome Progress, see A.7):**
- Coverage went from **3/5 (60%)** to **4/5 (80%)** = **+20 percentage points**. This is a coverage
  change, **not** a 33% speaking improvement, and it is **not** mixed into delivery progress.

## A.6 Comparable-session contract

A session may be compared with another **only** when all hold:

- the **same user**;
- **compatible practice purpose** or selected focus;
- **compatible transcription engine and mode** (Browser and Private measurements are **not**
  equivalent without proven normalization);
- **adequate transcript confidence**;
- **adequate speech duration and quantity**;
- **reliable metric attribution**.

Three **separate** calculations, never conflated (§A.3):

- **Immediate comparison** — current vs the **immediately previous comparable** session; reported as
  **percentage-point movement** plus the **raw metric change**.
- **Cumulative target progress** — current vs the **fixed personal baseline** (the baseline does not
  move to the previous session).
- **Longer trend** — median or trend across the **last 3–5** comparable sessions.

When purpose, engine, target, or data quality changes materially: **exclude** the session, **explain
why**, or **establish a new fixed baseline** (a new target version). The baseline is otherwise held
fixed so the percentage scale is stable across sessions.

**Historical migration.** Do **not** derive new progress from the old 0–10 score. Use stored **raw
measurements** only where their meaning and attribution are reliable; otherwise establish a **new
future baseline**. (The 0–10 score is never persisted today — every surface recomputes it — so there
is no stored score to migrate; only raw inputs such as clarity/fillers/WPM exist.)

## A.7 Outcome Progress (agenda coverage — Executive Rehearsal only)

Outcome Progress applies **only** when an agenda or brief exists (the structured Executive Rehearsal
experience). It is reported **separately** from delivery progress and is **never** folded into a
delivery `cumulative_progress` percentage. General practice needs **no** agenda, so Outcome Progress
does not apply there.

Show: agenda points **covered**, **partly addressed**, **not addressed**, and **recovered after
guidance**, each with **attributable transcript evidence**.

Coverage change is expressed in **percentage points** (3/5 → 4/5 = 60% → 80% = **+20 pp**), never as
a speaking-improvement percentage.

## A.8 Summary language (initial)

Prefer plain, per-focus statements over a single headline number:

- "Improved in 2 of 3 selected focus areas."
- "Maintained your pace target."
- "Filler rate decreased from 5.1 to 4.3 per minute."
- "Not enough comparable evidence."
- "Personal baseline established."

Required display shape for a target with progress (cumulative vs fixed baseline + session movement):

```text
Filler target: 50% of your original gap closed, up 17 pp from your previous comparable session
8/min baseline → 6/min previous → 5/min now → goal: 2/min or fewer
```

## A.9 Completion is not performance

Finishing a session is **session state**, not evidence of improvement. Never claim that completing a
speech means the user got better. "Recovered after guidance" must never be inferred without
attributable post-guidance evidence, and recovery is broader than filler reduction (it may concern
pace, pause rhythm, unclear wording, missing context, an omitted agenda point, an unstated ask, or
another supported focus).

---

# Part B — Current legacy 0–10 implementation and staged retirement map

> **Status of the 0–10 SpeakSharp Score (read first):**
> - It describes **current implementation that remains live** in the app until its consumers are
>   safely migrated (see the score-consumer inventory and Inchstone 11 in `BACKLOG.md`).
> - It is **not the approved long-term product direction** — Part A is.
> - It **must not** be converted directly into a 0–100 percentage (nor folded into a new combined
>   score).
>
> The sections below are the accurate record of `frontend/src/utils/speakingScore.ts` and its
> consumers, retained for the migration. Do not extend the 0–10 score; migrate its consumers per
> `BACKLOG.md`. This appendix stays until the final score-consumer retirement inchstone completes and
> is production-proven, after which it is archived or removed.

## Reviewer Context

This model exists because raw speaking metrics are not enough. A user can see:

```text
WPM: 178
Fillers: 6
Pauses per minute: 11.4
Clarity: 71%
```

and still not know what to do next.

The product objective is to turn measured signals into a short coaching loop:

```text
Measure -> Score -> Decode -> Try again -> See movement
```

For soft-release review, the main question is not whether the score is perfect. The question is whether the score:

1. Feels credible.
2. Uses a consistent formula.
3. Produces advice the user can immediately try.
4. Makes the user want to repeat the practice attempt.
5. Does not overclaim scientific precision.

## Source Of Truth

The current implementation source of truth is:

- `frontend/src/utils/speakingScore.ts`

Session and Analytics must call this same scoring module when presenting the SpeakSharp Score. Analytics may summarize or trend the score, but it must not implement a separate formula with the same name.

Allowed consumers:

| Surface | Allowed Use |
|---|---|
| Session page | Live score, live coaching nudges, next target |
| Analytics page | Historical trend, session comparison, score movement |
| PDF export | Session score summary and 2-3 next actions |

Not allowed:

- A separate Analytics-only score formula.
- A separate PDF-only score formula.
- Reweighting the score per page without a documented model revision.

## Implementation Design

The implementation is intentionally split into two layers:

| Layer | Owner | Purpose |
|---|---|---|
| Deterministic score engine | `frontend/src/utils/speakingScore.ts` | Calculates score, category breakdown, confidence level, weakest signals, and default action candidates. |
| Presentation surface | `frontend/src/components/session/LiveCoachingScoreCard.tsx` | Displays score, label, next target, and 2-3 actions on the Session page. |

Current Session wiring:

- `frontend/src/pages/SessionPage.tsx` renders `LiveCoachingScoreCard`.
- Live coaching is the default Session page path.
- `/session?coaching=on` remains a harmless explicit QA route for the current live-coaching path.
- The previous non-live-coaching control path is obsolete and should not be developed as a product variant.

Current inputs:

| Input | Source |
|---|---|
| Transcript | `useSessionLifecycle()` transcript content |
| Word count | `useSessionMetrics()` |
| WPM | `useSessionMetrics()` |
| Clarity score | `useSessionMetrics()` |
| Filler count | `useSessionMetrics()` / filler detector |
| Elapsed time | `useSessionLifecycle()` |
| Pause metrics | vocal analysis / pause detector |

Current output:

| Output | Purpose |
|---|---|
| `score` | 0.0-10.0 SpeakSharp Score |
| `label` | User-friendly score band |
| `headline` | One-line interpretation |
| `actions` | Maximum 2-3 short next actions |
| `breakdown` | Internal category sub-scores |
| `confidence` | Prevents overstating thin samples |

The current implementation does not yet call AI for live wording. It uses deterministic default actions so the A/B surface can be reviewed without network latency, prompt variability, or AI cost.

Future AI wording can be layered on after the deterministic result is computed.

## Signed-Off Architecture Boundary

The reviewed and accepted architecture is:

```text
Formula chooses what matters.
Small JSON carries the facts.
Gemini improves the wording.
Session, Analytics, and PDF reuse the same score truth.
```

This means:

- `speakingScore.ts` calculates score, confidence, target, weakest categories, action candidates, model version, and metrics used.
- Gemini must not calculate, recalculate, reweight, or override the score.
- The deterministic result becomes a small JSON coaching context for Gemini.
- Gemini may receive that bounded JSON coaching context and return shorter, warmer wording.
- The same saved score payload must be reused later by Analytics and PDF; those surfaces must not invent their own formulas.
- Formula weights must be calibration-tested for obvious bias before the score becomes a core product claim.

## What The Score Means

The SpeakSharp Score is a 0.0-10.0 coaching score for a single speaking session.

It estimates:

1. Whether the message is structured.
2. Whether the delivery is controlled.
3. Whether the language is clear.
4. Whether the point is likely to land for a listener.

It does not claim to be an official debate, Toastmasters, interview, classroom, or clinical score.

User-facing explanation:

> A coaching score based on structure, delivery, clarity, and audience impact.

## Research Anchors

The model uses two reputable anchors. The goal is not to bury the score in citations; it is to show that the weighting follows recognizable public-speaking evaluation practice.

| Source | Relevant Concept | How It Informs SpeakSharp |
|---|---|---|
| Toastmasters International Speech Contest ballot | Content 50%, Delivery 30%, Language 20% | Confirms that strong speaking evaluation should not be filler-count first. Content/message carries the most weight. |
| National Communication Association Competent Speaker Speech Evaluation Form | Preparation and delivery competencies, including organization, support, language, and delivery | Confirms that structure, support, language, and delivery should be assessed together. |

Reference links:

- Toastmasters International Speech Contest ballot: https://content.toastmasters.org/image/upload/1172-international-speech-contest-ballot-ff.pdf
- National Communication Association Competent Speaker Speech Evaluation Form: https://www.natcom.org/sites/default/files/pages/Assessment_Resources_Competent_Speaker_Speech_Evaluation_Form_2ndEd.pdf

## Score Weights

The SpeakSharp Score uses four 0-10 sub-scores:

| Category | Weight | Why It Matters |
|---|---:|---|
| Message & Structure | 35% | Users improve fastest when they learn to make the point clearer, not just speak with fewer fillers. |
| Delivery Control | 30% | Pace, pauses, and filler usage affect whether a listener can follow the message in real time. |
| Language & Clarity | 20% | Concise, clear language makes ideas easier to understand and repeat. |
| Audience Impact | 15% | A strong session should leave the listener with a takeaway, example, or next step. |

This is intentionally close to the Toastmasters-style shape:

```text
Toastmasters-like anchor:
Content / message: 50%
Delivery: 30%
Language: 20%

SpeakSharp adaptation:
Message & Structure: 35%
Audience Impact: 15%
Delivery Control: 30%
Language & Clarity: 20%
```

Message & Structure plus Audience Impact equal 50%, preserving the idea that content/message should be the largest component.

## Formula

Overall score:

```text
SpeakSharp Score =
  0.35 * MessageStructure
+ 0.30 * DeliveryControl
+ 0.20 * LanguageClarity
+ 0.15 * AudienceImpact
```

Each sub-score is normalized to a 0-10 range.

The v0.1 weights are research-informed assumptions for A/B testing. They must be calibration-tested before broad release by scoring a small set of real sessions and checking whether the score matches reasonable human judgment. If the formula consistently over-rewards rambling speech, over-penalizes normal fillers, or underrates clearly structured delivery, the weights should be adjusted before the score becomes a core product claim.

## Calibration And Bias Testing

The formula is proprietary, but it must not feel like gibberish. Before broad release, test the score against a small calibration set:

| Calibration Case | What To Check |
|---|---|
| Clear structured update | Should score higher on Message & Structure and Audience Impact. |
| Filler-heavy but understandable speech | Should lower Delivery Control without crushing the whole score. |
| Fast but coherent speech | Should flag pace as a coaching action without calling the entire session bad. |
| Rambling speech with signpost words | Should not over-reward keyword hits if the message still lacks a clear point. |
| Short sample | Should stay warming-up or directional, not overstate a precise score. |
| Native vs Private/Cloud transcript differences | Should lower confidence or avoid strong comparisons when transcript reliability is thin. |

Bias guardrails:

- Do not penalize normal conversational fillers as harshly as distracting repeated fillers.
- Do not reward keyword stuffing as real structure.
- Do not imply accents, dialect, or browser transcription artifacts are speaking defects.
- Do not show a precise score when the transcript is too short or unreliable.
- Adjust weights if reviewer calibration shows a recurring unfair penalty or inflated score.

### Message & Structure

Current MVP inputs:

- Transcript word count.
- Sentence count.
- Signposting language such as “first,” “next,” “because,” “for example,” “the point is,” or “in short.”

Interpretation:

- Short or fragmentary speech receives low confidence.
- A longer sample with clear transitions and examples receives more credit.
- This is a proxy until deeper semantic analysis is fully integrated into the live loop.

### Delivery Control

Current inputs:

- Speaking pace.
- Filler rate.
- Pause timing.

Formula:

```text
DeliveryControl =
  0.45 * PaceScore
+ 0.35 * FillerScore
+ 0.20 * PauseScore
```

Interpretation:

- Pace uses broad bands.
- Fillers are judged by rate, not raw count alone.
- Pauses are rewarded when they look intentional, not when they fragment every phrase.

### Language & Clarity

Current inputs:

- Existing clarity score.

Formula:

```text
LanguageClarity =
  ExistingClarityScoreNormalized
```

Interpretation:

- This favors readable, clean transcript output.
- Filler words are intentionally not counted again here. FillerScore belongs in Delivery Control so the model does not quietly penalize the same behavior in two places.

### Audience Impact

Current MVP inputs:

- Takeaway language such as “I recommend,” “the takeaway,” “the point,” “you should,” “we should,” or “next step.”
- Example/support language such as “for example,” “because,” “when you,” or “if you.”

Interpretation:

- A session should not only sound smooth; it should leave the listener with a point.
- This is a lightweight proxy until deeper semantic coaching has enough examples and scoring review.

## Score Labels

| Score Range | Label |
|---:|---|
| 0.0-2.9 | Getting Started |
| 3.0-4.9 | Building Control |
| 5.0-6.9 | Clear Communicator |
| 7.0-8.4 | Confident Speaker |
| 8.5-10.0 | Polished Presenter |

## Confidence Levels

The score must expose confidence internally so the UI does not overstate a thin sample.

| Confidence | Condition | User Meaning |
|---|---|---|
| warming-up | Too little transcript to score | Speak a little more first. |
| directional | Short or early sample | Useful signal, but not final. |
| usable | Enough speech for a reasonable session estimate | Show the score and next target normally. |

## User Experience Rules

The score must always decode into action.

Rules:

1. Show at most 2-3 coaching actions.
2. Do not show a paragraph of advice in the live Session surface.
3. Prefer behavior the user can try in the next sentence or next attempt.
4. Avoid robotic commands like “Slow down.”
5. Avoid shaming language around fillers.
6. Never imply that all fillers are equally bad.
7. Never present the score as official, clinical, or universal.

Preferred coaching shape:

```text
Score: 4.6 / 10
Next target: 5.0

Try this now:
- Put your main point before the context.
- Give the next key idea a beat of silence.
- Use one concrete example to make it land.
```

## AI Role

AI may help with wording, but it must not invent the score.

The deterministic scoring module owns:

- The 0.0-10.0 score.
- The sub-score weights.
- The confidence level.
- The weakest category or categories.
- The maximum number of user actions.

AI may optionally own:

- Rephrasing a selected action into a warmer coach voice.
- Choosing the clearest wording for a user goal, such as pitch, interview, meeting update, or toast.
- Turning a transcript-specific issue into one concise action.

AI must receive a small, bounded JSON coaching context when generating coaching copy. The context should include the deterministic result, not an unbounded transcript dump:

```json
{
  "scoreModelVersion": "speaking-score-v0.1",
  "score": 4.6,
  "confidence": "usable",
  "target": 5.0,
  "weakestCategories": ["messageStructure", "deliveryControl"],
  "deterministicActions": [
    "Say the main point before the context.",
    "Give the next key idea a beat of silence.",
    "Use one concrete example to make it land."
  ],
  "metrics": {
    "wpm": 178,
    "fillerCount": 6,
    "pausesPerMinute": 11.4,
    "clarityScore": 71
  },
  "transcriptEvidence": {
    "excerpt": "Short selected evidence only.",
    "wordCount": 418,
    "omitted": true
  }
}
```

Transcript policy:

- Do not send a full transcript by default for live coaching wording.
- Prefer selected excerpts or short evidence snippets.
- Include `wordCount` and `omitted: true` when content has been reduced.
- Fuller transcript analysis belongs only in explicit deeper post-session review flows.

The prompt should include:

```text
SpeakSharp Score formula:
- Message & Structure: 35%
- Delivery Control: 30%
- Language & Clarity: 20%
- Audience Impact: 15%

Return at most 2-3 short actions.
Do not recalculate the score.
Do not mention unsupported measurements.
Do not write a paragraph.
Do not shame filler words.
Do not write: "Slow down."
Do not write: "You used too many filler words."
```

This keeps the product consistent:

```text
Formula chooses what matters.
AI helps say it like a useful coach.
```

## Number-To-Coaching Flow

The conversion from raw numbers to coaching should follow this pipeline:

```text
Raw metrics
-> deterministic formula
-> weakest 1-2 categories
-> action candidate selection
-> optional AI wording pass
-> max 2-3 user-facing bullets
```

Example deterministic payload:

```json
{
  "score": 4.6,
  "target": 5.0,
  "weakestCategories": ["Message & Structure", "Delivery Control"],
  "signals": {
    "wpm": "fast",
    "fillerRate": "noticeable",
    "structure": "main point appears late"
  }
}
```

Example user-facing coaching:

```text
- Put your main point before the context.
- Give the next key idea a beat of silence.
- Use one concrete example to make it land.
```

The score engine should select what needs work. AI may only improve phrasing.

## Experiment Status

The Session page live-coaching decision has been made: use live coaching as the default product path. The old non-live-coaching control page is obsolete.

PostHog can still be used later for layout/copy experiments inside the live-coaching experience, but it should not hide the live coach or create a separate no-coach Session path.

| Route / Assignment | Behavior |
|---|---|
| `/session` | Shows Live Coaching Score. |
| `/session?coaching=on` | Explicitly shows the same live-coaching path for QA. |
| `/session?coaching=off` | No longer disables live coaching. |

Experiment telemetry must collect behavior, not just rendering:

| Event | Purpose |
|---|---|
| `session_live_coaching_experiment_viewed` | Records assigned variant and assignment source. |
| `session_live_coaching_card_viewed` | Records score confidence, score band, action count, and weakest categories without transcript text. |
| `session_live_coaching_numeric_score_shown` | Records when the user sees a numeric score rather than warming-up state. |
| `session_started` | Records STT mode, user tier, and experiment variant. |
| `session_saved` | Records save completion, duration, word count, metric summary, streak state, and experiment variant. |
| `conversion_cta_clicked` / `checkout_started` | Measures whether treatment affects Pro intent and checkout. |

Success questions:

1. Does the live score make the page more useful without feeling noisy?
2. Do the 2-3 actions feel immediately usable?
3. Does the score make users want to retry and improve?
4. Does the score make the existing metric cards easier to understand?
5. Does the score create trust, or does it feel unexplained?

## Future Model Improvements

Before broad launch, evaluate:

- Feeding semantic AI coaching outputs back into the Message & Structure and Audience Impact sub-scores.
- Showing score delta from the prior attempt.
- Adding a user goal selector, such as interview, pitch, status update, toast, or presentation.
- Calibrating score movement against human reviewer examples.
- Comparing Native, Private, and Cloud transcript reliability before making accuracy-sensitive claims.

## Release Guardrail

This model is acceptable for soft-release A/B testing if:

- The formula source is shared by Session and Analytics.
- The score is described as SpeakSharp’s coaching score.
- The UI shows concrete actions next to the score.
- The release notes do not overclaim scientific precision.

**Owner:** [unassigned]
**Last Reviewed:** 2026-05-28
**Version:** v0.6.19-rc0
**Status:** Draft A/B model for Session page evaluation

# SpeakSharp Session Score Model

This document defines the research-informed scoring model behind the SpeakSharp Session Score. The score is proprietary, but it is not arbitrary: it maps SpeakSharp measurements to established public-speaking evaluation categories.

The product rule is simple:

> Metrics are inputs. Coaching is the product.

Every score shown to a user must produce a small number of useful actions, not a wall of numbers.

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

Session and Analytics must call this same scoring module when presenting the SpeakSharp Session Score. Analytics may summarize or trend the score, but it must not implement a separate formula with the same name.

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
- Production assignment: PostHog feature flag `session_live_coaching_score`
- QA treatment route: `/session?coaching=on`
- QA control route: `/session?coaching=off`

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
| `score` | 0.0-10.0 SpeakSharp Session Score |
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

The SpeakSharp Session Score uses four 0-10 sub-scores:

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
SpeakSharp Session Score =
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
SpeakSharp Session Score formula:
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

## A/B Experiment

Initial Session experiment:

| Variant | Assignment | Description |
|---|---|---|
| Treatment | PostHog variant or `/session?coaching=on` | Shows Live Coaching Score. |
| Control | PostHog variant or `/session?coaching=off` | Hides Live Coaching Score and keeps the existing metric-card experience. |

Production experiment assignment should use the PostHog feature flag `session_live_coaching_score` with `control` and `treatment` variants. URL overrides remain for QA:

| QA Route | Behavior |
|---|---|
| `/session?coaching=on` | Force treatment. |
| `/session?coaching=off` | Force control. |

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

**Owner:** [unassigned]
**Last Reviewed:** 2026-07-08
**Version:** v0.6.19-rc0
**Last Updated:** 2026-07-08

# SpeakSharp Product Features

> Product feature inventory, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This file is the canonical working inventory of SpeakSharp product capabilities. Use it to vet the current offering, identify gaps, evaluate future features, and keep product claims honest. It replaces the archived `docs/PRD.md` feature list, which was retired because it contained obsolete signup, pricing, and launch assumptions.

Status meanings:

| Status | Meaning |
|---|---|
| Current | User-facing capability exists in the app today. |
| Implemented / proving | Capability exists, but quality, examples, or evidence are still being validated before broad product claims. |
| Accepted current path | Capability is now the intended user-facing path, but evidence/calibration may still limit broad marketing claims. |
| Infrastructure / limited | Foundational code exists, but rollout is limited or disabled by policy. |
| Planned | Product direction is accepted, but not part of the current soft-release claim. |

## Feature Group Taxonomy

Use these groups when reviewing the full feature list. They keep launch-critical access and reliability work visible as product surface, not just engineering hygiene.

| Group | Includes |
| :--- | :--- |
| **Transcription Modes** | Browser, Private, Cloud, mode selector |
| **Real-Time Coaching** | Live transcript, WPM, fillers, pauses, clarity, SpeakSharp Score, live coaching card |
| **Post-Session Coaching** | Semantic AI suggestions, analytics/history, PDF reports |
| **Habit & Progress** | SpeakSharp Score movement, goals, streaks, live-coaching targets, future guided drills |
| **Conversion & Trust** | Free-to-Pro, privacy positioning, free-plan support, watermark/referral loop |
| **Access & Reliability** | Usage limits, quotas, browser support, accessibility, design system |
| **Premium Coaching Ladder** | Executive Presentation Rehearsal Coach (Premium feature 1), Live Meeting Companion (Premium feature 2) — same coaching intelligence, different context and distraction budget |
| **Future Expansion** | Full referral proof loop |

## Vetted Product Claim Register

This table keeps product claims honest before product release. A feature can appear in the product direction only if its implementation state is explicit.

| Feature Area | Vetted Implementation State | Code / Evidence Pointer | Current Claim Level | What Must Happen Before Stronger Claim |
| :--- | :--- | :--- | :--- | :--- |
| **Browser / Native STT** | Implemented in the app through browser speech recognition. | `frontend/src/services/transcription/modes/NativeBrowser.ts`, `frontend/src/hooks/useBrowserSupport.ts` | Free, instant, zero-download, browser-dependent transcription. | Add live human Native STT accuracy evidence before claiming high accuracy. |
| **Private STT** | Implemented through local model setup and on-device transcription path. | `frontend/src/services/transcription/modes/PrivateWhisper.ts`, `frontend/src/services/transcription/engines/` | Private keeps audio local to the browser. | Keep validating first-run setup and recovery behavior in RC/manual evidence. |
| **Cloud STT** | Implemented through AssemblyAI token and streaming path. | `frontend/src/services/transcription/modes/CloudAssemblyAI.ts`, `backend/supabase/functions/assemblyai-token/index.ts` | Cloud STT is a paid Early Access feature. | Keep live Cloud transcript proof tied to release evidence before production claims. |
| **Real-Time Delivery Metrics** | Implemented in Session through WPM, filler, pause, clarity, transcript, and status panels. | `frontend/src/hooks/useSessionMetrics.ts`, `frontend/src/hooks/useVocalAnalysis.ts`, `frontend/src/components/session/` | Current coaching inputs. | Continue avoiding "metric soup" by decoding metrics into short coaching actions. |
| **SpeakSharp Score** | Implemented as a deterministic score engine plus the default Session live-coaching card. | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `product_release/SPEAKSHARP_SESSION_SCORE.operational.md` | Accepted current path; research-informed directional coaching score. | Add calibration examples, persistence plan, and reviewer pass before broad claims. |
| **Real-Time Live Coaching Feedback** | Implemented as the default Session-page feedback rail. | `frontend/src/pages/SessionPage.tsx`, `frontend/src/components/session/LiveCoachingScoreCard.tsx` | Accepted current path; converts metrics into a score, target, and 2-3 actions. | Confirm the card is compact enough, confidence-gated, and not distracting during live speaking. |
| **Semantic & Content Analysis** | Implemented in the AI suggestions prompt path, but not yet proven through scored examples. | `backend/supabase/functions/get-ai-suggestions/index.ts` | Implemented / proving. | Collect example outputs and reviewer scoring to prove usefulness beyond pace/fillers. |
| **Analytics & History** | Implemented in Analytics/session history surfaces. | `frontend/src/pages/AnalyticsPage.tsx`, `frontend/src/hooks/useAnalytics.ts`, `frontend/src/hooks/usePracticeHistory.ts` | Current. | Future score trend must reuse saved score payload, not recompute with drift. |
| **Branded PDF Reports** | Implemented through PDF export. | `frontend/src/lib/pdfGenerator.ts`, Analytics PDF actions | Current branded report artifact. | Future score/report claims must use the same saved score payload as Session/Analytics. |
| **Goals / Streaks** | Implemented as goal/streak foundation. | `frontend/src/hooks/useGoals.ts`, `frontend/src/hooks/useStreak.ts`, `frontend/src/hooks/useSessionLifecycle.ts` | Current habit foundation. | Tie goals/streaks more directly to score movement and next-practice targets. |
| **Score-Based Gamification** | Implemented through SpeakSharp Score, confidence state, next target, and live coaching actions. | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `frontend/src/pages/SessionPage.tsx` | Accepted current gamification foundation. | Prove that the score feels motivating and trustworthy; persist score payload before broad cross-page claims. |
| **Guided Habit Pathways** | Not implemented as a packaged guided-drill journey. | No guided drill route/component exists yet. | Planned post-soft release. | Design and build 2-5 minute drills, progression loops, streak reinforcement, and recurring next-practice prompts. |
| **Executive Presentation Rehearsal Coach** | Not implemented. Premium feature 1. | No rehearsal/brief/HUD route or component exists yet. | Planned post-soft release. | Premium feature 1 provides **live AI presentation-improvement suggestions during a practice presentation** (delivery, talking-point coverage, executive polish) **and** a post-rehearsal scorecard plus next-run improvement plan. It is not post-run only. Build order is Sandbox Mode → Rehearsal HUD. See "Premium Coaching Ladder". |
| **Live Meeting Companion** | Not implemented. Premium feature 2. | No `/companion` route/component exists yet. | Planned post-soft release, after the Rehearsal Coach. | Premium feature 2 applies the **same brief and coaching model during the actual Zoom/Meet/Teams meeting**, with **stricter, lower-frequency, lower-text live cues** because the user is performing live. The distinction from Rehearsal is context/risk/distraction budget, not live-vs-non-live. See "Premium Coaching Ladder". |
| **Referral Proof Loop** | Partially supported by branded PDF/report artifacts, but not a full product loop. | `frontend/src/lib/pdfGenerator.ts`; no shareable progress-summary flow exists yet. | Planned post-soft release. | Add shareable "what improved" summaries and validate whether artifacts make others curious enough to join. |
| **Analytics Tool Groups** | Implemented / proving in Analytics through three curated improvement goals plus secondary Custom measurement. | `frontend/src/components/AnalyticsDashboard.tsx`, `frontend/src/components/__tests__/AnalyticsDashboard.component.test.tsx` | Current / reviewer validation needed. | Confirm the focus labels, definitions, and selected tools help first-time users understand what to inspect next instead of feeling like arbitrary metric bundles. |
| **Daily Usage Visibility** | Planned access/reliability surface. | Usage RPCs exist; no dedicated daily progress surface is committed as a product claim. | Planned post-soft release. | Add a lightweight daily usage status/progress indicator so Pro users understand remaining practice time before they hit a cap. |
| **Landing Social Proof** | Planned conversion/trust surface. | Testimonials section is not active as a current claim. | Planned, content-dependent. | Use real tester quotes or concrete outcome snippets only; avoid synthetic testimonials. |
| **Invite / Share Hook** | Planned lightweight growth entry point. | No committed invite CTA exists yet. | Planned post-soft release. | Add a post-session or Analytics share hook after shareable reports and progress summaries are calibrated. |
| **PostHog Live-Coaching Experiment Operations** | Superseded for the Session page decision. | PostHog remains available for future layout experiments, but the non-live-coaching Session path is no longer a product variant. | Deferred for future layout tests only. | Do not hide the live coach behind PostHog. Any future experiment must compare live-coaching layouts, not live coaching versus no live coaching. |

## Product Surface Summary

| Capability | Status | Definition |
| :--- | :--- | :--- |
| **Browser Transcription** | Current | Free, zero-download browser speech recognition. Availability and accuracy vary by browser; Chrome desktop is the recommended baseline. |
| **Private STT** | One free sample / paid Early Access path | Local on-device transcription after initial model setup. Private STT audio data must not leave the user's browser. |
| **Cloud STT** | Paid Early Access feature | AssemblyAI-powered cloud transcription selected explicitly by the user. Cloud STT requires paid entitlement evidence. |
| **Real-Time Delivery Metrics** | Current | Live WPM, filler word counts, pause metrics, clarity signals, transcript capture, and mode/status feedback during practice. |
| **Real-Time Live Coaching Feedback** | Accepted current path | Session-page coaching surface that converts live metrics into a SpeakSharp Score, confidence state, next target, and 2-3 short actions the user can try immediately. The exact score is directional; session-to-session movement is more important than the single number. |
| **Semantic & Content Analysis** | Implemented / proving | AI coaching that moves beyond delivery metrics into substance: argument structure, clarity of logic, vocabulary choice, transitions, audience impact, and persuasive usefulness. Current implementation exists in the AI suggestions path; output quality still needs example collection and reviewer scoring before broad claims. |
| **Analytics & History** | Current | Saved session review, progress trends, transcript/session details, engine metadata, PDF report generation, and session-over-session comparison. |
| **Branded PDF Reports** | Current | Exported reports include SpeakSharp branding/watermarking for Free and Pro users. Reports should support review, recall, and word-of-mouth discovery without exposing unsupported claims. |
| **Free-To-Pro Conversion** | Current funnel | Free baseline experience should be useful and honest while nudging toward Pro only in relevant, non-intrusive surfaces. |
| **Free-To-Pro Upgrade Support** | Infrastructure / limited | Free-to-Pro guidance can appear outside private practice surfaces when explicitly enabled. Practice surfaces must stay focused on the user's speaking work. |
| **Score-Based Gamification** | Accepted current path | SpeakSharp Score, confidence states, next target, and live coaching actions give the current Session experience a motivating progress loop. This is the first version of gamification, not a validated public-speaking grade. |
| **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute speaking drills that help users practice one behavior at a time, return regularly, and chase progress through score movement, streaks, targets, and recurring coaching themes rather than an open-ended sandbox alone. Not part of the current soft-release product claim. |
| **Executive Presentation Rehearsal Coach** | Planned post-soft release | Premium feature 1. High-stakes presentation practice before the real event. Includes **real-time AI improvement suggestions during the rehearsal** (live talking-point coverage, live executive-polish prompts, live pacing/filler/pause cues) **and** a post-rehearsal scorecard with a next-run improvement plan. Because it is rehearsal, live cues can be richer than in a real meeting. Not part of the current soft-release product claim. |
| **Live Meeting Companion** | Planned post-soft release | Premium feature 2. Reuses the Rehearsal Coach's brief and coaching model **during the actual Zoom/Meet/Teams meeting**, delivering **constrained real-time cues** (ambient status dots, short labels, low-frequency prompts — no paragraph guidance while speaking) because the user is performing live. Not part of the current soft-release product claim. |
| **Analytics Tool Groups** | Current / proving | Analytics-page focus groups now frame the dashboard around three user goals: Speak Clearly, Sound Confident, and Track Progress. Custom measurement remains available as a secondary advanced path for users who intentionally want specific metrics. |
| **Daily Usage Visibility** | Planned post-soft release | Lightweight Session or Analytics usage progress surface so Pro users can see daily practice usage before hitting a cap. |
| **Landing Social Proof** | Planned, content-dependent | Real tester quotes or concrete outcome snippets that help first-time visitors trust the product. Not active until real source material exists. |
| **Invite / Share Hook** | Planned post-soft release | Simple post-session or Analytics entry point that lets users share a report or progress moment with a friend. Builds on the Referral Proof Loop. |

## Accepted Feature Candidates & Timing

These are accepted product directions used to vet the current offering and future roadmap. Exact calendar dates should be set only after RC gates are green and the controlled soft-release window is confirmed.

| Feature | Product Timing | Release Claim Status | Notes |
| :--- | :--- | :--- | :--- |
| **Real-Time Live Coaching Feedback** | Soft-release current path | Accepted current path, not a broad calibrated product claim yet | Session page is the right first surface. Must remain compact, confidence-gated, and non-judgmental. |
| **Semantic & Content Analysis** | Current / near-term proving | Implemented, quality still being proven | Highest retention-leverage coaching feature. Needs example outputs, reviewer scoring, and prompt/output tests before strong marketing language. |
| **Score-Based Gamification** | Soft-release current path | Accepted current path, not a broad calibrated product claim yet | Uses SpeakSharp Score, confidence state, next target, and short actions as the current gamified coaching loop. |
| **Guided Habit Pathways** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Packaged guided drills, progression loops, streak reinforcement, and recurring next-practice targets. Builds on the score/live-coach foundation. |
| **Executive Presentation Rehearsal Coach** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Premium feature 1. Ships in two steps: (1) Sandbox Mode (brief → rehearse aloud → post-rehearsal scorecard) first because it is easiest and safest; (2) Rehearsal HUD, where **real-time AI presentation improvement** appears with richer live cues than a real meeting would allow. Builds on the score/live-coach foundation. |
| **Live Meeting Companion** | Post-soft release, after the Rehearsal Coach; date TBD after RC gates and tester feedback | Planned | Premium feature 2. Reuses the Rehearsal Coach's brief, coverage model, and coaching intelligence during the real meeting with **stricter, lower-distraction cue limits**. Strong Pro differentiator, but higher privacy/integration/distraction risk. Should wait until Session coaching and score model are calibrated. |
| **Referral Proof Loop** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Shared PDFs, progress summaries, and “what improved” moments should make friends curious and give users a story to tell. |
| **Analytics Tool Groups** | Soft-release current path, reviewer validation needed | Implemented / proving | Should make Analytics feel like "choose what you want to improve" instead of a collection of unrelated numbers. Validate whether Speak Clearly, Sound Confident, and Track Progress reduce choice load while Custom stays secondary for advanced measurement. |
| **Daily Usage Visibility** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Access/reliability affordance for Pro users; should be lightweight and not dominate the practice flow. |
| **Landing Social Proof** | Post-soft release, content-dependent | Planned | Requires real user/tester source material before it can become a credible public claim. |
| **Invite / Share Hook** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Lightweight growth hook tied to PDF/report/progress moments. |
| **PostHog Live-Coaching Experiment Operations** | Future layout testing only | Deferred | The live-coaching Session page is now the product path. Future PostHog work should test layout/copy refinements inside live coaching, not hide the live coach. |

## Detailed Feature Inventory

| Group | Feature | Status | Product Notes | Evidence / Test Posture |
| :--- | :--- | :--- | :--- | :--- |
| Transcription Modes | **Transcription** | Current | Core speech-to-text service across Browser, Private, and Cloud modes. | Covered by unit, E2E, live, and STT evidence paths depending on engine. |
| Transcription Modes | **Browser / Native STT** | Current | Free baseline path using browser speech recognition. It is instant and zero-download, but browser-dependent. | Claims must stay bounded until live human Native evidence supports stronger wording. |
| Transcription Modes | **Private STT** | One free sample / paid Early Access path | Local-first transcription path for privacy-sensitive practice. | Private audio must not leave the browser. Initial model setup is expected. |
| Transcription Modes | **Cloud STT** | Pro feature | Cloud transcription through AssemblyAI, selected explicitly by the user. | Cloud release validation requires live transcript proof, not just token/WebSocket readiness. |
| Transcription Modes | **STT Mode Selector** | Current | Lets users choose Browser, Private, or Cloud when allowed by tier/runtime policy. | Must not silently switch Private users to Cloud. |
| Real-Time Coaching | **Live Transcript** | Current | Shows live/interim transcript during practice and saved transcript after session. | Transcript quality depends on selected STT engine and browser/runtime behavior. |
| Real-Time Coaching | **Filler Word Detection** | Current | Detects common fillers and custom tracked words where supported by engine/path. | Filler guidance should avoid shaming language and should favor actionable replacement with silence/pauses. |
| Real-Time Coaching | **Custom Filler Words** | Current | Users can define personalized words/phrases to track in addition to defaults. | Cloud may use user-specific vocabulary for accuracy support; Native support is browser-limited. |
| Real-Time Coaching | **Speaking Pace / WPM** | Current | Provides real-time and session-level words-per-minute feedback. | WPM should be treated as a coaching band, not a precise public-speaking grade. |
| Real-Time Coaching | **Pause / Vocal Variety Metrics** | Current | Tracks pause count, pause rate, average pause, longest pause, and rhythm signals. | Used for delivery feedback and the SpeakSharp Score delivery-control category. |
| Real-Time Coaching | **Clarity Signal** | Current | Existing clarity score derived from transcript quality, filler count, and pacing signals. | Directional, not a clinical or official speaking assessment. |
| Real-Time Coaching | **SpeakSharp Score** | Accepted current path | Proprietary 0.0-10.0 coaching score based on structure, delivery, clarity, and audience impact. Exact number is less important than progress direction. | Source of truth is `speakingScore.ts`; model documentation lives in `SPEAKSHARP_SESSION_SCORE.operational.md`. |
| Real-Time Coaching | **Real-Time Live Coaching Feedback** | Accepted current path | Converts score and live signals into 2-3 short, immediately usable coaching actions. | Live coaching is no longer an optional Session variant. Future experiments should refine layout/copy inside this path. |
| Post-Session Coaching | **Semantic & Content Analysis** | Implemented / proving | AI suggestions analyze argument structure, logic clarity, vocabulary, transitions, audience impact, and persuasive usefulness. | Needs collected example outputs and reviewer scoring before strong marketing claims. |
| Post-Session Coaching | **AI Suggestions** | Current / proving | Post-session AI feedback path for deeper coaching. | AI may help wording and content analysis, but must not calculate the SpeakSharp Score. |
| Post-Session Coaching | **Session History** | Current | Users can review past sessions and saved transcripts/metrics. | Persistence is required for returning-user comparison and PDF regeneration. |
| Post-Session Coaching | **Analytics Dashboard** | Current | Shows progress trends, session list, engine metadata, and report actions. | Future score trend must consume the same saved score payload as Session/PDF. |
| Post-Session Coaching | **Analytics Tool Groups** | Current / proving | Curated Analytics groups that map raw tools into three coaching narratives: Speak Clearly, Sound Confident, and Track Progress. | Preserve Custom as a secondary advanced measurement path with standalone explanations so users can inspect one signal without turning the primary experience into a metrics control panel. Reviewer should confirm whether the focus chooser copy is sufficient or needs more explicit tooltip/help text. |
| Post-Session Coaching | **PDF Export** | Current | Generates branded PDF reports from current transcript/report state and persisted session data. | All PDFs retain SpeakSharp branding/watermarking. |
| Habit & Progress | **Goals / Streaks** | Current foundation | Tracks practice goals and streak-like progress signals. | Existing habit foundation; should increasingly connect to score movement and next-practice targets. |
| Habit & Progress | **Score-Based Gamification** | Accepted current path | Uses SpeakSharp Score, confidence state, next target, and live coaching actions to create a motivating practice loop. | Current version of gamification; validate trust, motivation, and retention before broad claims. |
| Habit & Progress | **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute drills such as concise update, filler-to-pause replacement, opening/closing clarity, and main-point-first practice. | Planned post-soft release once score/coaching loop is calibrated; not implemented as a complete guided journey today. |
| Access & Reliability | **Usage Limits / Quotas** | Current | Enforces daily/monthly practice limits by tier. | Must fail closed if quota service is unavailable. |
| Access & Reliability | **Daily Usage Visibility** | Planned post-soft release | User-facing progress/status for remaining daily practice time. | Should reduce surprise at limits without making the app feel quota-first. |
| Conversion & Trust | **Upgrade / Conversion Funnel** | Current | Free-to-Pro upgrade path through pricing, analytics, and relevant feature gates. | Basic paid checkout remains deferred/future-only. |
| Conversion & Trust | **Free-To-Pro Upgrade Support** | Infrastructure / limited | Upgrade guidance for Free users outside private practice surfaces. | Keep disabled unless explicitly enabled, and keep private practice surfaces free of conversion messaging. |
| Conversion & Trust | **Landing Social Proof** | Planned, content-dependent | Real user/tester quotes or outcome snippets for first-time visitor trust. | Must use real source material; do not invent testimonials. |
| Conversion & Trust | **Invite / Share Hook** | Planned post-soft release | Simple entry point to share a report or progress moment. | Should build on branded reports and Referral Proof Loop rather than becoming a disconnected CTA. |
| Premium Coaching Ladder | **Executive Presentation Rehearsal Coach** | Planned | Premium feature 1. Live AI presentation-improvement suggestions during a practice presentation (delivery, talking-point coverage, executive polish, pacing/filler/pause) **plus** a post-rehearsal scorecard and next-run improvement plan. Build order: Sandbox Mode → Rehearsal HUD. | Planned after soft release; not current release scope. Live rehearsal feedback is core to the claim, not post-run only. |
| Premium Coaching Ladder | **Live Meeting Companion** | Planned | Premium feature 2. Same brief and coaching model applied **live during the real Zoom/Meet/Teams meeting**, with constrained ambient cues (status dots, short labels, low-frequency prompts). | Planned after the Rehearsal Coach; not current release scope. Distinction from Rehearsal is context/risk/distraction budget, not live-vs-non-live. |
| Access & Reliability | **Accessibility / Screen Reader Support** | Current | Live transcript uses accessibility-aware UI patterns. | Keep aligned with UX smoke and page-level accessibility checks. |
| Access & Reliability | **Design System / Visual Surfaces** | Current | Shared visual tokens and standardized card/surface styling. | Theme contrast and Session/Analytics surfaces have been hardened during soft-release prep. |

## Premium Coaching Ladder (Rehearsal Coach → Live Meeting Companion)

> Product architecture note for the two premium coaching features. This is the canonical capture; the
> tables above summarize it. Feature 1 and Feature 2 are **not separate products** — they are one
> coaching system applied in two contexts.

### The one-sentence model

**Same coaching intelligence, different context and distraction budget.** Both premium features include
real-time/live feedback. The distinction is **not** "Rehearsal = after only" and "Companion = live." The
distinction is *where* the coaching runs and *how much* on-screen guidance the user can absorb without
being derailed.

### Product ladder

1. **SpeakSharp Practice** — the current product. General speaking practice. Live coaching for delivery
   mechanics and semantic improvement.
2. **Executive Presentation Rehearsal Coach** (Premium feature 1) — high-stakes presentation practice
   *before* the real event. Includes: real-time AI presentation-improvement suggestions during a practice
   presentation; talking-point coverage during rehearsal; executive-polish feedback; a post-rehearsal
   scorecard; and a next-rehearsal improvement plan.
3. **Live Meeting Companion** (Premium feature 2) — the same coaching intelligence applied *during* the
   actual Zoom / Google Meet / Teams meeting. Higher privacy, integration, and distraction risk, so it
   must use stricter, lower-frequency, lower-text cues.

### Canonical wording (use verbatim)

> Executive Presentation Rehearsal Coach provides live AI guidance during practice presentations and a
> post-rehearsal scorecard. The later Live Meeting Companion reuses the same brief and coaching model in
> actual meetings, with stricter cue limits because the user is performing live.

> Rehearsal Coach and Live Meeting Companion are not separate products. Rehearsal Coach trains the
> presentation against a brief. Live Companion applies the same brief and coaching model during the real
> meeting.

### Build sequence (unchanged, clarified)

The build order remains **Sandbox → Rehearsal HUD → Live Companion**:

1. **Sandbox Mode** — user enters a brief, rehearses aloud, and the product provides a post-rehearsal
   scorecard. First because it is the easiest to ship and the safest (no live-cue distraction risk).
2. **Rehearsal HUD** — used *during* a practice presentation. This is where real-time AI presentation
   improvement appears. Because it is rehearsal, the product can show **richer live cues** than it would
   in a real meeting.
3. **Live Meeting Companion** — used *during* an actual Zoom / Google Meet / Teams call. Reuses the same
   brief, coverage model, and coaching intelligence, but must be **more conservative and lower-distraction**.

### Real-time feedback taxonomy

Four categories of live feedback, shared across the ladder but gated by context:

| Category | Scope | Examples |
| :--- | :--- | :--- |
| **1. Delivery mechanics** | Practice, Rehearsal, and Live | slow down; pause; wrap up; too many fillers; voice too low; rambling; answer too long; unclear phrasing |
| **2. Content coverage** | Core to Rehearsal Coach, later Live Companion | key point covered; key point missing; key point partially covered; recommendation missing; ask missing; over-explained background; underdeveloped risk; slide/topic skipped |
| **3. Executive polish** | Core differentiator for Feature 1 | connect this point to business strategy; state the decision needed; clarify the business impact; sound less defensive; move from tactical detail to executive framing; sharpen the recommendation; make the risk/mitigation explicit |
| **4. Interaction guidance** | More relevant to Live Companion, but rehearsable first | ask a question; invite alignment; address objection; move to decision; close with next step; stop over-answering |

### Rehearsal HUD vs Live Meeting Companion (distraction budget)

The same coaching intelligence renders differently because the risk of derailing the user differs.

**Rehearsal HUD** — a practice presentation, so feedback can be more explicit. Allowed: short AI text
prompts; section-level guidance; "try this next" suggestions; a live talking-point checklist;
pause-and-review moments; richer post-run explanation.

- "State the recommendation now."
- "Connect retention risk to compensation strategy."
- "You covered business strategy, but not the ask."
- "Too much background; move to decision."
- "Mention how this affects the board's decision."

**Live Meeting Companion** — the real meeting, so feedback must be constrained. Allowed: ambient cues;
sparse text; status dots; short labels; low-frequency prompts; **no paragraph guidance while speaking**.

- "Wrap up." · "Make the ask." · "Key point missing." · "Too long." · "Pause." · "Move to recommendation."

**Do not make Live Companion a verbose real-time AI coach — it can derail the user.**

### Privacy framing

- Private transcription can keep audio local to the browser.
- Semantic AI feedback over transcript, talking points, slides, and audience context **may require cloud
  AI** unless local LLM analysis is separately built.
- Do **not** imply all presentation materials stay local unless that is actually implemented.

### Relationship summary

Rehearsal Coach trains a presentation against a brief and can afford rich live cues; Live Companion carries
the *same* brief and coaching model into the real meeting under a tight distraction budget. Read them as one
system with two contexts, not two disconnected features.

## Product Positioning

SpeakSharp is not just a transcription app. It is a privacy-first speech practice coach.

Reviewer framing accepted:

```text
STT is infrastructure.
SpeakSharp is the coach.
```

STT still matters because the transcript is the evidence layer for coaching,
score confidence, analytics, and user trust. The release promise is not "perfect
transcription"; it is:

```text
Practice privately, get trustworthy feedback, improve one thing at a time.
```

The product should move users through this loop:

```text
Practice -> See useful feedback -> Try one focused improvement -> See progress -> Come back
```

The conversion journey should preserve this trust loop:

```text
Try -> Trust -> Improve -> Save -> Compare -> Upgrade
```

The most important current product shift is from raw metric display to useful coaching:

```text
Metrics are inputs. Coaching is the product.
```

## Current Product Claims Boundary

Allowed:

- Free starts with Browser transcription.
- Private keeps audio local to the browser.
- Cloud STT is a paid Early Access feature.
- SpeakSharp can track pace, fillers, pauses, clarity signals, history, and reports.
- Semantic AI coaching exists, but quality is still being proven through examples and review.
- SpeakSharp Score is a research-informed coaching score for A/B testing.

Avoid:

- Claiming Native Browser STT is benchmark-grade without live evidence.
- Claiming the SpeakSharp Score is a validated public-speaking assessment.
- Claiming Cloud STT is included in the Private sample.
- Claiming free-plan support messages use transcript or speaking data.
- Presenting the planned Executive Presentation Rehearsal Coach, Live Meeting Companion, or packaged Guided Habit Pathways as shipped.
- Implying the Rehearsal Coach is post-run only — its claim explicitly includes live rehearsal feedback.
- Implying all presentation materials (transcript, talking points, slides, audience context) stay on-device: semantic AI feedback may require cloud AI unless local LLM analysis is separately built.

## Related Operational Docs

- Score model: `SPEAKSHARP_SESSION_SCORE.operational.md`
- Product contract: `PRD.operational.md`
- Release posture: `RELEASE_STATUS.md`
- Deferred work: `BACKLOG.md`
- Risk tracker: `ROADMAP.operational.md`

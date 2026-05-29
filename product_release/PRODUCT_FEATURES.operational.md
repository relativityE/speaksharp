**Owner:** [unassigned]
**Last Reviewed:** 2026-05-28
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-28

# SpeakSharp Product Features

> Product feature inventory, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This file is the canonical working inventory of SpeakSharp product capabilities. Use it to vet the current offering, identify gaps, evaluate future features, and keep product claims honest. It replaces the archived `docs/PRD.md` feature list, which was retired because it contained obsolete signup, pricing, and launch assumptions.

Status meanings:

| Status | Meaning |
|---|---|
| Current | User-facing capability exists in the app today. |
| Implemented / proving | Capability exists, but quality, examples, or evidence are still being validated before broad product claims. |
| A/B candidate | Code and/or design exists, but it is not a committed release claim until tested and accepted. |
| A/B in progress | Capability is being tested against a control experience. |
| Infrastructure / limited | Foundational code exists, but rollout is limited or disabled by policy. |
| Planned | Product direction is accepted, but not part of the current soft-release claim. |

## Feature Group Taxonomy

Use these groups when reviewing the full feature list. They keep launch-critical access and reliability work visible as product surface, not just engineering hygiene.

| Group | Includes |
| :--- | :--- |
| **Transcription Modes** | Browser, Private/Vault, Cloud, mode selector |
| **Real-Time Coaching** | Live transcript, WPM, fillers, pauses, clarity, SpeakSharp Score, live coaching card |
| **Post-Session Coaching** | Semantic AI suggestions, analytics/history, PDF reports |
| **Habit & Progress** | SpeakSharp Score movement, goals, streaks, live-coaching targets, future guided drills |
| **Conversion & Trust** | Free-to-Pro, privacy positioning, sponsor support, watermark/referral loop |
| **Access & Reliability** | Usage limits, quotas, browser support, accessibility, design system |
| **Future Expansion** | Live meeting companion, full referral proof loop |

## Vetted Product Claim Register

This table keeps product claims honest before product release. A feature can appear in the product direction only if its implementation state is explicit.

| Feature Area | Vetted Implementation State | Code / Evidence Pointer | Current Claim Level | What Must Happen Before Stronger Claim |
| :--- | :--- | :--- | :--- | :--- |
| **Browser / Native STT** | Implemented in the app through browser speech recognition. | `frontend/src/services/transcription/modes/NativeBrowser.ts`, `frontend/src/hooks/useBrowserSupport.ts` | Free, instant, zero-download, browser-dependent transcription. | Add live human Native STT accuracy evidence before claiming high accuracy. |
| **Private / Vault Mode STT** | Implemented through local model setup and on-device transcription path. | `frontend/src/services/transcription/modes/PrivateWhisper.ts`, `frontend/src/services/transcription/engines/` | Private/Vault Mode keeps audio local to the browser. | Keep validating first-run setup and recovery behavior in RC/manual evidence. |
| **Cloud STT** | Implemented through AssemblyAI token and streaming path. | `frontend/src/services/transcription/modes/CloudAssemblyAI.ts`, `backend/supabase/functions/assemblyai-token/index.ts` | Cloud STT is a Pro feature and is unavailable for trial. | Keep live Cloud transcript proof tied to release evidence before production claims. |
| **Real-Time Delivery Metrics** | Implemented in Session through WPM, filler, pause, clarity, transcript, and status panels. | `frontend/src/hooks/useSessionMetrics.ts`, `frontend/src/hooks/useVocalAnalysis.ts`, `frontend/src/components/session/` | Current coaching inputs. | Continue avoiding "metric soup" by decoding metrics into short coaching actions. |
| **SpeakSharp Score** | Implemented as a deterministic score engine plus a Session A/B card. | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `product_release/SPEAKSHARP_SESSION_SCORE.operational.md` | A/B candidate only; research-informed directional coaching score. | Add calibration examples, persistence plan, and reviewer pass before broad claims. |
| **Real-Time Live Coaching Feedback** | Implemented as a Session-page A/B surface. | `frontend/src/pages/SessionPage.tsx`, `frontend/src/components/session/LiveCoachingScoreCard.tsx` | A/B candidate only; converts metrics into a score, target, and 2-3 actions. | Confirm the card is compact enough, confidence-gated, and not distracting during live speaking. |
| **Semantic & Content Analysis** | Implemented in the AI suggestions prompt path, but not yet proven through scored examples. | `backend/supabase/functions/get-ai-suggestions/index.ts` | Implemented / proving. | Collect example outputs and reviewer scoring to prove usefulness beyond pace/fillers. |
| **Analytics & History** | Implemented in Analytics/session history surfaces. | `frontend/src/pages/AnalyticsPage.tsx`, `frontend/src/hooks/useAnalytics.ts`, `frontend/src/hooks/usePracticeHistory.ts` | Current. | Future score trend must reuse saved score payload, not recompute with drift. |
| **Branded PDF Reports** | Implemented through PDF export. | `frontend/src/lib/pdfGenerator.ts`, Analytics PDF actions | Current branded report artifact. | Future score/report claims must use the same saved score payload as Session/Analytics. |
| **Goals / Streaks** | Implemented as goal/streak foundation. | `frontend/src/hooks/useGoals.ts`, `frontend/src/hooks/useStreak.ts`, `frontend/src/hooks/useSessionLifecycle.ts` | Current habit foundation. | Tie goals/streaks more directly to score movement and next-practice targets. |
| **Score-Based Gamification** | Implemented as a Session A/B candidate through SpeakSharp Score, confidence state, next target, and live coaching actions. | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `frontend/src/pages/SessionPage.tsx` | Current gamification foundation / A/B candidate. | Prove that the score feels motivating and trustworthy; persist score payload before broad cross-page claims. |
| **Guided Habit Pathways** | Not implemented as a packaged guided-drill journey. | No guided drill route/component exists yet; backlog item tracks it. | Planned post-soft release. | Design and build 2-5 minute drills, progression loops, streak reinforcement, and recurring next-practice prompts. |
| **Live Meeting Companion** | Not implemented. | No `/companion` route/component exists yet; backlog item tracks it. | Planned post-soft release. | Design and build a compact overlay-friendly mode after Session coaching is calibrated. |
| **Referral Proof Loop** | Partially supported by branded PDF/report artifacts, but not a full product loop. | `frontend/src/lib/pdfGenerator.ts`; no shareable progress-summary flow exists yet. | Planned post-soft release. | Add shareable "what improved" summaries and validate whether artifacts make others curious enough to join. |

## Product Surface Summary

| Capability | Status | Definition |
| :--- | :--- | :--- |
| **Browser Transcription** | Current | Free, zero-download browser speech recognition. Availability and accuracy vary by browser; Chrome desktop is the recommended baseline. |
| **Private / Vault Mode STT** | Current Pro trial / Pro path | Local on-device transcription after initial model setup. Private STT audio data must not leave the user's browser. |
| **Cloud STT** | Pro feature | AssemblyAI-powered cloud transcription selected explicitly by the user. Cloud STT is a Pro feature and is unavailable for trial. |
| **Real-Time Delivery Metrics** | Current | Live WPM, filler word counts, pause metrics, clarity signals, transcript capture, and mode/status feedback during practice. |
| **Real-Time Live Coaching Feedback** | A/B candidate | Session-page coaching surface that converts live metrics into a SpeakSharp Score, confidence state, next target, and 2-3 short actions the user can try immediately. The exact score is directional; session-to-session movement is more important than the single number. |
| **Semantic & Content Analysis** | Implemented / proving | AI coaching that moves beyond delivery metrics into substance: argument structure, clarity of logic, vocabulary choice, transitions, audience impact, and persuasive usefulness. Current implementation exists in the AI suggestions path; output quality still needs example collection and reviewer scoring before broad claims. |
| **Analytics & History** | Current | Saved session review, progress trends, transcript/session details, engine metadata, PDF report generation, and session-over-session comparison. |
| **Branded PDF Reports** | Current | Exported reports include SpeakSharp branding/watermarking for Free and Pro users. Reports should support review, recall, and word-of-mouth discovery without exposing unsupported claims. |
| **Free-To-Pro Conversion** | Current funnel | Free baseline experience should be useful and honest while nudging toward Pro only in relevant, non-intrusive surfaces. |
| **Privacy-First Free Plan Support** | Infrastructure / limited | Free may include privacy-respecting sponsor/support messaging outside private practice surfaces. Transcript and speaking data must never be used for ads. |
| **Score-Based Gamification** | A/B candidate | SpeakSharp Score, confidence states, next target, and live coaching actions give the current Session experience a motivating progress loop. This is the first version of gamification, not a validated public-speaking grade. |
| **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute speaking drills that help users practice one behavior at a time, return regularly, and chase progress through score movement, streaks, targets, and recurring coaching themes rather than an open-ended sandbox alone. Not part of the current soft-release product claim. |
| **Live Meeting Companion** | Planned post-soft release | Compact real-time coaching mode intended for live calls or overlays, such as Zoom/Teams/Meet workflows. Not part of the current soft-release product claim. |

## Accepted Feature Candidates & Timing

These are accepted product directions used to vet the current offering and future roadmap. Exact calendar dates should be set only after RC gates are green and the controlled soft-release window is confirmed.

| Feature | Product Timing | Release Claim Status | Notes |
| :--- | :--- | :--- | :--- |
| **Real-Time Live Coaching Feedback** | Soft-release A/B candidate | A/B only, not a broad product claim yet | Session page is the right first surface. Must remain compact, confidence-gated, and non-judgmental. |
| **Semantic & Content Analysis** | Current / near-term proving | Implemented, quality still being proven | Highest retention-leverage coaching feature. Needs example outputs, reviewer scoring, and prompt/output tests before strong marketing language. |
| **Score-Based Gamification** | Soft-release A/B candidate | A/B only, not a broad product claim yet | Uses SpeakSharp Score, confidence state, next target, and short actions as the current gamified coaching loop. |
| **Guided Habit Pathways** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Packaged guided drills, progression loops, streak reinforcement, and recurring next-practice targets. Builds on the score/live-coach foundation. |
| **Live Meeting Companion** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Strong Pro differentiator, but higher effort. Should wait until Session coaching and score model are calibrated. |
| **Referral Proof Loop** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Shared PDFs, progress summaries, and “what improved” moments should make friends curious and give users a story to tell. |

## Detailed Feature Inventory

| Group | Feature | Status | Product Notes | Evidence / Test Posture |
| :--- | :--- | :--- | :--- | :--- |
| Transcription Modes | **Transcription** | Current | Core speech-to-text service across Browser, Private, and Cloud modes. | Covered by unit, E2E, live, and STT evidence paths depending on engine. |
| Transcription Modes | **Browser / Native STT** | Current | Free baseline path using browser speech recognition. It is instant and zero-download, but browser-dependent. | Claims must stay bounded until live human Native evidence supports stronger wording. |
| Transcription Modes | **Private STT / Vault Mode** | Current Pro trial / Pro path | Local-first transcription path for privacy-sensitive practice. | Private audio must not leave the browser. Initial model setup is expected. |
| Transcription Modes | **Cloud STT** | Pro feature | Cloud transcription through AssemblyAI, selected explicitly by the user. | Cloud release validation requires live transcript proof, not just token/WebSocket readiness. |
| Transcription Modes | **STT Mode Selector** | Current | Lets users choose Browser, Private, or Cloud when allowed by tier/runtime policy. | Must not silently switch Private users to Cloud. |
| Real-Time Coaching | **Live Transcript** | Current | Shows live/interim transcript during practice and saved transcript after session. | Transcript quality depends on selected STT engine and browser/runtime behavior. |
| Real-Time Coaching | **Filler Word Detection** | Current | Detects common fillers and custom tracked words where supported by engine/path. | Filler guidance should avoid shaming language and should favor actionable replacement with silence/pauses. |
| Real-Time Coaching | **Custom Filler Words** | Current | Users can define personalized words/phrases to track in addition to defaults. | Cloud may use user-specific vocabulary for accuracy support; Native support is browser-limited. |
| Real-Time Coaching | **Speaking Pace / WPM** | Current | Provides real-time and session-level words-per-minute feedback. | WPM should be treated as a coaching band, not a precise public-speaking grade. |
| Real-Time Coaching | **Pause / Vocal Variety Metrics** | Current | Tracks pause count, pause rate, average pause, longest pause, and rhythm signals. | Used for delivery feedback and the SpeakSharp Score delivery-control category. |
| Real-Time Coaching | **Clarity Signal** | Current | Existing clarity score derived from transcript quality, filler count, and pacing signals. | Directional, not a clinical or official speaking assessment. |
| Real-Time Coaching | **SpeakSharp Score** | A/B candidate | Proprietary 0.0-10.0 coaching score based on structure, delivery, clarity, and audience impact. Exact number is less important than progress direction. | Source of truth is `speakingScore.ts`; model documentation lives in `SPEAKSHARP_SESSION_SCORE.operational.md`. |
| Real-Time Coaching | **Real-Time Live Coaching Feedback** | A/B candidate | Converts score and live signals into 2-3 short, immediately usable coaching actions. | PostHog should assign production variants; `/session?coaching=on` and `/session?coaching=off` remain QA overrides. |
| Post-Session Coaching | **Semantic & Content Analysis** | Implemented / proving | AI suggestions analyze argument structure, logic clarity, vocabulary, transitions, audience impact, and persuasive usefulness. | Needs collected example outputs and reviewer scoring before strong marketing claims. |
| Post-Session Coaching | **AI Suggestions** | Current / proving | Post-session AI feedback path for deeper coaching. | AI may help wording and content analysis, but must not calculate the SpeakSharp Score. |
| Post-Session Coaching | **Session History** | Current | Users can review past sessions and saved transcripts/metrics. | Persistence is required for returning-user comparison and PDF regeneration. |
| Post-Session Coaching | **Analytics Dashboard** | Current | Shows progress trends, session list, engine metadata, and report actions. | Future score trend must consume the same saved score payload as Session/PDF. |
| Post-Session Coaching | **PDF Export** | Current | Generates branded PDF reports from current transcript/report state and persisted session data. | All PDFs retain SpeakSharp branding/watermarking. |
| Habit & Progress | **Goals / Streaks** | Current foundation | Tracks practice goals and streak-like progress signals. | Existing habit foundation; should increasingly connect to score movement and next-practice targets. |
| Habit & Progress | **Score-Based Gamification** | A/B candidate | Uses SpeakSharp Score, confidence state, next target, and live coaching actions to create a motivating practice loop. | Current version of gamification; validate trust, motivation, and retention before broad claims. |
| Habit & Progress | **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute drills such as concise update, filler-to-pause replacement, opening/closing clarity, and main-point-first practice. | Planned post-soft release once score/coaching loop is calibrated; not implemented as a complete guided journey today. |
| Access & Reliability | **Usage Limits / Quotas** | Current | Enforces daily/monthly practice limits by tier. | Must fail closed if quota service is unavailable. |
| Conversion & Trust | **Upgrade / Conversion Funnel** | Current | Free-to-Pro upgrade path through pricing, analytics, and relevant feature gates. | Basic paid checkout remains deferred/future-only. |
| Conversion & Trust | **Privacy-First Free Plan Support** | Infrastructure / limited | House/sponsor support messaging for Free users outside private practice surfaces. | No third-party ad vendors before privacy/vendor review. No transcript/session data for ads. |
| Future Expansion | **Live Meeting Companion** | Planned | Overlay-friendly companion mode for live meeting support. | P1 backlog candidate after soft release; not current release scope. |
| Access & Reliability | **Accessibility / Screen Reader Support** | Current | Live transcript uses accessibility-aware UI patterns. | Keep aligned with UX smoke and page-level accessibility checks. |
| Access & Reliability | **Design System / Visual Surfaces** | Current | Shared visual tokens and standardized card/surface styling. | Theme contrast and Session/Analytics surfaces have been hardened during soft-release prep. |

## Product Positioning

SpeakSharp is not just a transcription app. It is a privacy-first speech practice coach.

The product should move users through this loop:

```text
Practice -> See useful feedback -> Try one focused improvement -> See progress -> Come back
```

The most important current product shift is from raw metric display to useful coaching:

```text
Metrics are inputs. Coaching is the product.
```

## Current Product Claims Boundary

Allowed:

- Free starts with Browser transcription.
- Private/Vault Mode keeps audio local to the browser.
- Cloud STT is a Pro feature.
- SpeakSharp can track pace, fillers, pauses, clarity signals, history, and reports.
- Semantic AI coaching exists, but quality is still being proven through examples and review.
- SpeakSharp Score is a research-informed coaching score for A/B testing.

Avoid:

- Claiming Native Browser STT is benchmark-grade without live evidence.
- Claiming the SpeakSharp Score is a validated public-speaking assessment.
- Claiming Cloud STT is included in trial.
- Claiming ads/sponsor support use transcript or speaking data.
- Presenting planned Live Meeting Companion or packaged Guided Habit Pathways as shipped.

## Related Operational Docs

- Score model: `SPEAKSHARP_SESSION_SCORE.operational.md`
- Product contract: `PRD.operational.md`
- Release posture: `RELEASE_STATUS.md`
- Deferred work: `BACKLOG.md`
- Risk tracker: `ROADMAP.operational.md`

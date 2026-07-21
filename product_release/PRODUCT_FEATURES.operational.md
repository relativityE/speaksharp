**Owner:** [unassigned]
**Last Reviewed:** 2026-07-08
**Version:** v0.6.19-rc0
**Last Updated:** 2026-07-08

# SpeakSharp Product Features

> Product feature inventory, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This file is the canonical working inventory of SpeakSharp product capabilities. Use it to vet the current offering, identify gaps, evaluate future features, and keep product claims honest. It replaces the archived `docs/PRD.md` feature list, which was retired because it contained obsolete signup, pricing, and launch assumptions.

---

## Personal Progress & Executive Rehearsal Product Contract (canonical)

> **Precedence.** This section is the canonical statement of product direction. Where a later table
> or row in this file describes the 0–10 SpeakSharp Score as an "accepted current path" or a
> "gamification foundation," that reflects **what ships today** and is **superseded** by this
> contract: the 0–10 score is being **retired** via a staged consumer migration. The progress
> calculation contract lives in `SPEAKSHARP_SESSION_PROGRESS.operational.md` (Part A); the ordered
> implementation inchstones live in `BACKLOG.md`. This is a **definition round**: no application
> code, migration, deployment, activation, billing, Private v4, or tester-facing behavior changes
> here.

### The product outcome

SpeakSharp should help a user understand: (1) what changed compared with **their own** previous
comparable practice; (2) whether they moved toward **specific delivery targets they selected or
accepted**; (3) in Executive Rehearsal, whether they **covered their intended agenda**; and (4)
whether a specific **remedy** helped them correct a gap. SpeakSharp must **not** grade the person
against an unexplained universal standard.

### The four layers

**A. Universal General Practice (no agenda required).** General speech or presentation practice
works **without** an agenda, brief, or formal objective. It records that the user completed an
attempt (completion is session state, not performance evidence), establishes or uses a personal
measurement baseline, compares the attempt with a **named** previous comparable session, explains
which delivery measurements improved / held / moved away from the user's targets, and recommends
**one** next focus.

**B. Goal-Based Practice.** The user may select **1–3** measurable delivery focus areas (e.g. reduce
filler rate; move pace into a preferred range; improve pause rhythm where measurement reliability
supports it; another defensible measurable target). SpeakSharp may suggest **editable** targets,
clearly labeled as recommendations rather than universal standards.

**C. Executive Rehearsal (optional structured layer).** An agenda or brief is **optional** and
appears **only** in Executive Rehearsal. When provided, SpeakSharp tracks the agenda **passively**,
shows whether each point is *not yet addressed / partly addressed / covered / recovered after
guidance*, retains attributable transcript evidence, keeps agenda coverage **separate** from delivery
progress, and summarizes what was covered, missed, clarified, or recovered. (Rehearsal **domain
foundation** enabling code is merged — PR #1012 — but the user-facing feature, sandbox, real-session
integration, persistence, and AI intervention are **not** built.)

**D. AI-Assisted Correction (the loop to double down on).** The primary product loop is: **rehearse
→ detect one meaningful gap → offer one remedy → user supplements or retries → prove whether the gap
recovered → rehearse again.** A correction may concern filler rate, pace, pause rhythm, unclear
wording, missing context, an omitted agenda point, an unstated recommendation or ask, or another
supported focus. "Recovered after guidance" must **never** be inferred without attributable evidence.

### Prioritize / double down on

1. Personal progress against the user's **own** baseline.
2. Transparent raw measurements and **visible** calculations.
3. Existing session-over-session Analytics integration.
4. Optional user-selected delivery targets.
5. Passive agenda tracking for Executive Rehearsal.
6. The evidence-backed correction and recovery loop.
7. **One** actionable next focus instead of many simultaneous metrics.
8. Privacy-preserving processing and clear data boundaries.
9. Sparse, pause-aware help **only after** passive and user-requested guidance is validated.
10. A calm, polished, accessible interface that protects the user's train of thought.

### Deprioritize / defer / remove

1. **Retire** the user-facing 0–10 SpeakSharp Score through a **staged consumer migration** (not a
   direct delete).
2. Do **not** convert the current score directly into a 0–100 percentage.
3. Do **not** introduce a new opaque combined "Personal Progress Score."
4. **Remove Live Meeting Companion from active implementation sequencing.** Preserve it only as
   future direction.
5. Do **not** build avatars or body-language / video analysis (explicit non-goal).
6. Do **not** build continuous or verbose live coaching; do **not** show paragraphs of advice while
   the user is speaking.
7. Do **not** build automatic intervention in the first implementation stage.
8. Do **not** add enterprise packaging, team dashboards, pricing, billing, payments, PDF expansion,
   or branded exports to this feature train. **Billing remains OFF and out of scope.**
9. Do **not** add **Private v4** activation or A/B work to this feature train. **Private v4 remains
   OFF and out of scope.**
10. Do **not** perform a broad documentation reconciliation beyond this contract and the backlog.
11. Do **not** preserve temporary UX merely because it is already coded.

### Live experience (passive-first)

Default live behavior is **passive**. Agenda point states, with the rule that **color is never the
only signal**:

| State | Color | Meaning |
| :--- | :--- | :--- |
| Not yet addressed | Neutral gray | The user has not covered this point yet. |
| Partly addressed / may need clarification | Yellow | Touched but incomplete. |
| Covered | Green | Addressed with evidence. |
| Missed (important objective) | Red | **Post-session review only** — never shown while the user can still address it. |

Accessibility: color is **never** the sole signal (use text labels + icons); support keyboard
navigation and screen readers; honor reduced-motion; verify mobile and desktop; meet the repository's
contrast standard.

**Forbidden live patterns:** a continuously changing score; pulsing warnings; sounds; interrupting
modals; stacked suggestions; paragraphs of live advice; automatic prompts during active speech.

### Intervention order

1. Passive tracking only.
2. User requests help for a specific gap.
3. SpeakSharp offers **one** remedy.
4. User supplements or retries.
5. SpeakSharp evaluates whether **that specific gap** recovered (evidence required).
6. **Only after** usability validation may a separate experiment test **one** automatic cue during a
   **genuine pause** — dedicated later PR, kill switch, cognitive-load acceptance test,
   annoyance/abandonment exit criteria, at most one visible cue, never during active speech.

### Non-goals (explicit)

Avatars; body-language / facial / gesture / posture / video analysis; continuous verbose live
coaching; automatic live intervention in stage one; a combined opaque replacement score; a 0→100
rescale of the old score; enterprise/team/pricing/billing/PDF-expansion scope on this train; Private
v4 activation on this train; Live Meeting Companion in the active build sequence.

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
| **Real-Time Coaching** | Live transcript, WPM, fillers, pauses, clarity; SpeakSharp Score + live coaching card (**legacy 0–10, scheduled for retirement** — superseded by quiet live guidance + Personal Progress) |
| **Post-Session Coaching** | Semantic AI suggestions, analytics/history, PDF reports |
| **Habit & Progress** | Personal progress vs the user's own baseline/targets (approved direction); goals, streaks, live-coaching targets, future guided drills. SpeakSharp Score movement = **legacy, scheduled for retirement**. |
| **Conversion & Trust** | Free-to-Pro, privacy positioning, free-plan support, watermark/referral loop |
| **Access & Reliability** | Usage limits, quotas, browser support, accessibility, design system |
| **Premium Coaching Ladder** | Executive Rehearsal (passive-first agenda tracking + evidence-backed outcome review + user-requested remedy/recovery). Live Meeting Companion is **future direction only** — removed from active sequencing |
| **Future Expansion** | Full referral proof loop |

## Vetted Product Claim Register

This table keeps product claims honest before product release. A feature can appear in the product direction only if its implementation state is explicit.

| Feature Area | Vetted Implementation State | Code / Evidence Pointer | Current Claim Level | What Must Happen Before Stronger Claim |
| :--- | :--- | :--- | :--- | :--- |
| **Private STT** | Implemented through local model setup and on-device transcription path. Recommended default and main beta experience. | `frontend/src/services/transcription/modes/PrivateWhisper.ts`, `frontend/src/services/transcription/engines/` | Private keeps audio local to the browser; it is the recommended main beta experience. Private v4 remains DISABLED (all v4 flags OFF by default, `frontend/src/services/transcription/privateV4Flags.ts`). | Keep validating first-run setup and recovery behavior in RC/manual evidence. |
| **Browser / Native STT** | Implemented in the app through browser speech recognition; presented as "Quick preview". | `frontend/src/services/transcription/modes/NativeBrowser.ts`, `frontend/src/hooks/useBrowserSupport.ts` | Free, instant, zero-download, browser-dependent "Quick preview" — NOT equivalent to Private. | Add live human Native STT accuracy evidence before claiming high accuracy; never claim Browser/Private parity. |
| **Cloud STT** | Implemented through AssemblyAI token and streaming path; Pro-gated. | `frontend/src/services/transcription/modes/CloudAssemblyAI.ts`, `backend/supabase/functions/assemblyai-token/index.ts` | Cloud STT is a Pro feature, unavailable to Free testers during the no-billing beta (existing paid-Pro accounts retain access). | Keep live Cloud transcript proof tied to release evidence before production claims. |
| **Real-Time Delivery Metrics** | Implemented in Session through WPM, filler, pause, clarity, transcript, and status panels. | `frontend/src/hooks/useSessionMetrics.ts`, `frontend/src/hooks/useVocalAnalysis.ts`, `frontend/src/components/session/` | Current coaching inputs. | Continue avoiding "metric soup" by decoding metrics into short coaching actions. |
| **SpeakSharp Score** | Ships today as a deterministic 0–10 engine plus the default Session live-coaching card. **Being retired** via staged consumer migration — superseded by the Personal Progress model (see the canonical contract above and `SPEAKSHARP_SESSION_PROGRESS.operational.md` Part A). | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `product_release/SPEAKSHARP_SESSION_PROGRESS.operational.md` | Current implementation, on a retirement path; not the long-term experience. | Migrate every consumer (see inventory in `BACKLOG.md`), then remove the 0–10 code. Do **not** rescale it to 0–100 or into a combined score. |
| **Real-Time Live Coaching Feedback** | Ships today as the default Session-page feedback rail built on the 0–10 score card. **Current implementation, scheduled for retirement:** the prominent live 0–10 score is replaced by **quiet live guidance** (Inchstone 3), preserving useful confidence/recommendation behavior. | `frontend/src/pages/SessionPage.tsx`, `frontend/src/components/session/LiveCoachingScoreCard.tsx` | Current implementation on a retirement path; not the long-term live experience. | Replace the prominent live score with passive/quiet guidance; no continuously-changing replacement score (see `BACKLOG.md` §4). |
| **Semantic & Content Analysis** | Implemented in the AI suggestions prompt path, but not yet proven through scored examples. | `backend/supabase/functions/get-ai-suggestions/index.ts` | Implemented / proving. | Collect example outputs and reviewer scoring to prove usefulness beyond pace/fillers. |
| **Analytics & History** | Implemented in Analytics/session history surfaces. | `frontend/src/pages/AnalyticsPage.tsx`, `frontend/src/hooks/useAnalytics.ts`, `frontend/src/hooks/usePracticeHistory.ts` | Current. | Future score trend must reuse saved score payload, not recompute with drift. |
| **Branded PDF Reports** | Implemented through PDF export. | `frontend/src/lib/pdfGenerator.ts`, Analytics PDF actions | Current branded report artifact. | Future score/report claims must use the same saved score payload as Session/Analytics. |
| **Goals / Streaks** | Implemented as goal/streak foundation. | `frontend/src/hooks/useGoals.ts`, `frontend/src/hooks/useStreak.ts`, `frontend/src/hooks/useSessionLifecycle.ts` | Current habit foundation. | Tie goals/streaks more directly to score movement and next-practice targets. |
| **Score-Based Gamification** | Ships today through the 0–10 SpeakSharp Score, confidence state, next target, and live coaching actions. **On the score's retirement path** — the motivating loop is re-based on transparent personal progress (own baseline / own targets), not the opaque score. | `frontend/src/utils/speakingScore.ts`, `frontend/src/components/session/LiveCoachingScoreCard.tsx`, `frontend/src/pages/SessionPage.tsx` | Current implementation, superseded by the Personal Progress model. | Migrate consumers (see `BACKLOG.md` §4); do **not** deepen 0–10-score gamification. |
| **Guided Habit Pathways** | Not implemented as a packaged guided-drill journey. | No guided drill route/component exists yet. | Planned post-soft release. | Design and build 2-5 minute drills, progression loops, streak reinforcement, and recurring next-practice prompts. |
| **Executive Rehearsal** | User-facing feature **not** implemented; **domain-foundation enabling code merged** (PR #1012, not a shipped feature). | `frontend/src/services/rehearsal/`; no rehearsal/brief/HUD route or user-facing component exists yet. | Planned; next major expansion after the current hardening cycle. | Optional agenda/brief; **passive** agenda tracking (not-addressed / partly / covered / recovered-after-guidance) with attributable evidence; delivery progress and agenda coverage kept **separate**. Correction is **user-requested first**; any automatic pause-aware cue is a later, separately-activated experiment. Sandbox → passive tracking → user-requested remedy → evidence-backed recovery. See the canonical contract above and the inchstones in `BACKLOG.md`. |
| **Live Meeting Companion** | Not implemented. **Removed from active implementation sequencing** — future direction only. | No `/companion` route/component exists; explicitly out of the active build sequence. | Future direction only (not sequenced). | Future direction: reuse the rehearsal brief/coaching model during a real meeting under a tighter distraction budget. Sequenced **only** after Rehearsal proves value and is separately re-scoped; **not** part of this feature train. See "Premium Coaching Ladder". |
| **Referral Proof Loop** | Partially supported by branded PDF/report artifacts, but not a full product loop. | `frontend/src/lib/pdfGenerator.ts`; no shareable progress-summary flow exists yet. | Planned post-soft release. | Add shareable "what improved" summaries and validate whether artifacts make others curious enough to join. |
| **Analytics Tool Groups** | Implemented / proving in Analytics through three curated improvement goals plus secondary Custom measurement. | `frontend/src/components/AnalyticsDashboard.tsx`, `frontend/src/components/__tests__/AnalyticsDashboard.component.test.tsx` | Current / reviewer validation needed. | Confirm the focus labels, definitions, and selected tools help first-time users understand what to inspect next instead of feeling like arbitrary metric bundles. |
| **Daily Usage Visibility** | Planned access/reliability surface. | Usage RPCs exist; no dedicated daily progress surface is committed as a product claim. | Planned post-soft release. | Add a lightweight daily usage status/progress indicator so Pro users understand remaining practice time before they hit a cap. |
| **Landing Social Proof** | Planned conversion/trust surface. | Testimonials section is not active as a current claim. | Planned, content-dependent. | Use real tester quotes or concrete outcome snippets only; avoid synthetic testimonials. |
| **Invite / Share Hook** | Planned lightweight growth entry point. | No committed invite CTA exists yet. | Planned post-soft release. | Add a post-session or Analytics share hook after shareable reports and progress summaries are calibrated. |
| **PostHog Live-Coaching Experiment Operations** | Superseded for the Session page decision. | PostHog remains available for future layout experiments, but the non-live-coaching Session path is no longer a product variant. | Deferred for future layout tests only. | Do not hide the live coach behind PostHog. Any future experiment must compare live-coaching layouts, not live coaching versus no live coaching. |

## Product Surface Summary

| Capability | Status | Definition |
| :--- | :--- | :--- |
| **Private STT** | Recommended — main beta experience | Local on-device transcription after a one-time model setup; the recommended default and main beta experience. Private STT audio data must not leave the user's browser. |
| **Browser Transcription** | Quick preview (not equivalent to Private) | Free, zero-download browser speech recognition, presented as a "Quick preview" — a convenience path, not an equivalent to Private. Availability and accuracy vary by browser; Chrome desktop is the recommended baseline. |
| **Cloud STT** | Pro — unavailable during no-billing beta | AssemblyAI-powered cloud transcription selected explicitly by the user; gated behind Pro entitlement — not available to Free testers during the no-billing beta, while existing paid-Pro accounts retain access. |
| **Real-Time Delivery Metrics** | Current | Live WPM, filler word counts, pause metrics, clarity signals, transcript capture, and mode/status feedback during practice. |
| **Real-Time Live Coaching Feedback** | Current implementation, scheduled for retirement | Ships today as a Session-page surface converting live metrics into the 0–10 SpeakSharp Score + 2-3 actions. Being replaced by **quiet live guidance** (Inchstone 3): no continuously-changing score, no interruption, no automatic cueing; useful confidence/recommendation behavior preserved. |
| **Semantic & Content Analysis** | Implemented / proving | AI coaching that moves beyond delivery metrics into substance: argument structure, clarity of logic, vocabulary choice, transitions, audience impact, and persuasive usefulness. Current implementation exists in the AI suggestions path; output quality still needs example collection and reviewer scoring before broad claims. |
| **Analytics & History** | Current | Saved session review, progress trends, transcript/session details, engine metadata, PDF report generation, and session-over-session comparison. |
| **Branded PDF Reports** | Current | Exported reports include SpeakSharp branding/watermarking for Free and Pro users. Reports should support review, recall, and word-of-mouth discovery without exposing unsupported claims. |
| **Free-To-Pro Conversion** | Current funnel | Free baseline experience should be useful and honest while nudging toward Pro only in relevant, non-intrusive surfaces. |
| **Free-To-Pro Upgrade Support** | Infrastructure / limited | Free-to-Pro guidance can appear outside private practice surfaces when explicitly enabled. Practice surfaces must stay focused on the user's speaking work. |
| **Score-Based Gamification** | Current implementation, scheduled for retirement | Ships today via the 0–10 SpeakSharp Score, confidence state, next target, and live coaching actions. Being re-based on **transparent personal progress** (own baseline / own targets), not the opaque score; do not deepen 0–10-score gamification (see `BACKLOG.md` §4). |
| **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute speaking drills that help users practice one behavior at a time, return regularly, and chase progress through score movement, streaks, targets, and recurring coaching themes rather than an open-ended sandbox alone. Not part of the current soft-release product claim. |
| **Executive Rehearsal** | Planned post-soft release | High-stakes presentation practice before the real event. Initial live behavior is **passive** agenda tracking (not-addressed / partly / covered / recovered-after-guidance) plus an evidence-backed post-session outcome review; correction is **user-requested first**; any automatic pause-aware cue is a later, separately-activated experiment. Delivery progress and agenda coverage stay **separate**. Not part of the current soft-release product claim. See the canonical contract above. |
| **Live Meeting Companion** | Future direction only (not sequenced) | **Removed from active implementation sequencing.** Future direction: reuse the rehearsal brief/coaching model in a real meeting under a tighter distraction budget, re-scoped separately after Rehearsal proves value. Not part of the current soft-release product claim. |
| **Analytics Tool Groups** | Current / proving | Analytics-page focus groups now frame the dashboard around three user goals: Speak Clearly, Sound Confident, and Track Progress. Custom measurement remains available as a secondary advanced path for users who intentionally want specific metrics. |
| **Daily Usage Visibility** | Planned post-soft release | Lightweight Session or Analytics usage progress surface so Pro users can see daily practice usage before hitting a cap. |
| **Landing Social Proof** | Planned, content-dependent | Real tester quotes or concrete outcome snippets that help first-time visitors trust the product. Not active until real source material exists. |
| **Invite / Share Hook** | Planned post-soft release | Simple post-session or Analytics entry point that lets users share a report or progress moment with a friend. Builds on the Referral Proof Loop. |

## Accepted Feature Candidates & Timing

These are accepted product directions used to vet the current offering and future roadmap. Exact calendar dates should be set only after RC gates are green and the controlled soft-release window is confirmed.

| Feature | Product Timing | Release Claim Status | Notes |
| :--- | :--- | :--- | :--- |
| **Real-Time Live Coaching Feedback** | Current implementation, scheduled for retirement | 0–10 live score card ships today; being replaced by quiet live guidance (Inchstone 3) | Session page is the right first surface, but the prominent live score is removed; keep it compact, confidence-gated, non-judgmental, and passive. |
| **Semantic & Content Analysis** | Current / near-term proving | Implemented, quality still being proven | Highest retention-leverage coaching feature. Needs example outputs, reviewer scoring, and prompt/output tests before strong marketing language. |
| **Score-Based Gamification** | Current implementation, scheduled for retirement | Ships today; being re-based on personal progress, not the 0–10 score | Uses the 0–10 SpeakSharp Score today; the motivating loop moves to transparent personal progress (own baseline/targets). Do not deepen 0–10-score gamification. |
| **Guided Habit Pathways** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Packaged guided drills, progression loops, streak reinforcement, and recurring next-practice targets. Builds on the score/live-coach foundation. |
| **Executive Rehearsal** | Post-soft release, date TBD after RC gates and tester feedback | Planned | Passive-first, delivered as ordered inchstones (see `BACKLOG.md` §4): localhost sandbox → passive agenda tracking → evidence-backed outcome review → user-requested remedy → evidence-backed recovery → (later, default-OFF) sparse pause-aware experiment. No automatic live intervention in stage one; delivery progress and agenda coverage stay separate. Builds on the Rehearsal domain foundation (PR #1012). |
| **Live Meeting Companion** | Future direction only — not sequenced | Deferred (future direction) | **Removed from active implementation sequencing.** Would reuse the rehearsal brief/coaching model in a real meeting under a tighter distraction budget; re-scoped separately only after Rehearsal proves value. Higher privacy/integration/distraction risk. |
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
| Transcription Modes | **Private STT** | Recommended — main beta experience | Private is the recommended, default transcription path and the main beta experience: local-first, on-device transcription for privacy-sensitive practice. Only Private carries the "Recommended" tag in the selector (`frontend/src/components/session/LiveRecordingCard.tsx`). | Private audio must not leave the browser. Initial one-time model setup is expected. |
| Transcription Modes | **Browser / Native STT** | Quick preview (not equivalent to Private) | Labeled "Quick preview" in the selector — instant, zero-download browser speech recognition. It is a convenience preview, NOT an equivalent to Private; the transcript may miss punctuation and filler words. | Do not claim Browser/Quick-preview parity with Private. Claims stay bounded until live human Native evidence supports stronger wording. |
| Transcription Modes | **Cloud STT** | Pro — unavailable during no-billing beta | Cloud transcription through AssemblyAI, tagged "Pro" in the selector and selected explicitly by the user. Gated behind Pro entitlement (`canUseCloudStt = isProUser && hasCloudSttEntitlement`, `frontend/src/hooks/useSessionLifecycle.ts`); the row is disabled without it, so Cloud is not available to Free testers during the no-billing beta; existing paid-Pro accounts retain access. | Cloud release validation requires live transcript proof, not just token/WebSocket readiness. |
| Transcription Modes | **STT Mode Selector** | Current | Private-first dropdown order: Private (Recommended) → Browser (Quick preview) → Cloud (Pro). The dropdown surface is fully opaque (`DropdownMenuContent` `opaque` variant, `frontend/src/components/ui/dropdown-menu.tsx`). Touch/mobile gets ONE "About transcription modes" help panel (single `HelpPopover` surface listing all three modes); desktop gets ONE controlled `ModeDescriptionFlyout` driven by the active row. The About panel and the dropdown are mutually exclusive (opening one closes the other). | Must not silently switch Private users to Cloud. |
| Real-Time Coaching | **Live Transcript** | Current | Shows live/interim transcript during practice and saved transcript after session. | Transcript quality depends on selected STT engine and browser/runtime behavior. |
| Post-Session | **Post-save reconciliation** | Current (shipped) | After save there is exactly ONE authoritative status surface: `StatusNotificationBar` (`frontend/src/components/session/StatusNotificationBar.tsx`) carrying the finalized transcript, a quiet secondary Private continuation CTA, and a single persistent Analytics action. There is NO completion toast and NO "Next: Analytics" overlay — `PostSaveToast` is deleted from the codebase. The Analytics action is the one persistent, accessible (WCAG-AA emerald-800/emerald-300) green post-save action; the recording-card pill resets to its ready state (`frontend/src/pages/SessionPage.tsx` suppresses the pill's "Session saved" message once the post-save state begins) so there is no duplicate "Session saved" signal. Mobile stacks the same single bar (flex-col). | Finalized signal published only at the terminal join (persist → reconcile → formatter terminal), session-guarded; the filler disclosure reads that finalized snapshot. Covered by unit + `frontend/src/pages/__tests__/SessionPage.feedback.component.test.tsx` (asserts no `post-save-toast`) + E2E. |
| Post-Session | **Private finalization progress** | Current (accepted ~90s) | A 5-min Private v2 recording finalizes in ≈90s post-stop, shown as honest "Finalizing…" progress. | Accepted RC limitation; not gated on the withdrawn `<30s` requirement. |
| Real-Time Coaching | **Filler Word Detection** | Current | Detects common fillers and custom tracked words where supported by engine/path. | Filler guidance should avoid shaming language and should favor actionable replacement with silence/pauses. |
| Real-Time Coaching | **Custom Filler Words** | Current | Users can define personalized words/phrases to track in addition to defaults. | Cloud may use user-specific vocabulary for accuracy support; Native support is browser-limited. |
| Real-Time Coaching | **Speaking Pace / WPM** | Current | Provides real-time and session-level words-per-minute feedback. | WPM should be treated as a coaching band, not a precise public-speaking grade. |
| Real-Time Coaching | **Pause / Vocal Variety Metrics** | Current | Tracks pause count, pause rate, average pause, longest pause, and rhythm signals. | Used for delivery feedback and the SpeakSharp Score delivery-control category. |
| Real-Time Coaching | **Clarity Signal** | Current | Existing clarity score derived from transcript quality, filler count, and pacing signals. | Directional, not a clinical or official speaking assessment. |
| Real-Time Coaching | **SpeakSharp Score** | Ships today; being retired (staged migration) | Proprietary 0.0-10.0 coaching score based on structure, delivery, clarity, and audience impact. Superseded by the Personal Progress model; on a staged retirement path, not the long-term experience. | Source of truth is `speakingScore.ts`; legacy model + successor Personal Progress model both documented in `SPEAKSHARP_SESSION_PROGRESS.operational.md`. Migration inventory + inchstones in `BACKLOG.md`. |
| Real-Time Coaching | **Real-Time Live Coaching Feedback** | Current implementation, scheduled for retirement | Ships today converting the 0–10 score + live signals into 2-3 actions; being replaced by **quiet, passive live guidance** (Inchstone 3) — no continuously-changing score, no automatic cueing. | Preserve useful confidence/recommendation behavior; remove the prominent live score. |
| Post-Session Coaching | **Semantic & Content Analysis** | Implemented / proving | AI suggestions analyze argument structure, logic clarity, vocabulary, transitions, audience impact, and persuasive usefulness. | Needs collected example outputs and reviewer scoring before strong marketing claims. |
| Post-Session Coaching | **AI Suggestions** | Current / proving | Post-session AI feedback path for deeper coaching. | AI may help wording and content analysis, but must not calculate the SpeakSharp Score. |
| Post-Session Coaching | **Session History** | Current | Users can review past sessions and saved transcripts/metrics. | Persistence is required for returning-user comparison and PDF regeneration. |
| Post-Session Coaching | **Analytics Dashboard** | Current | Shows progress trends, session list, engine metadata, and report actions. | Future score trend must consume the same saved score payload as Session/PDF. |
| Post-Session Coaching | **Analytics Tool Groups** | Current / proving | Curated Analytics groups that map raw tools into three coaching narratives: Speak Clearly, Sound Confident, and Track Progress. | Preserve Custom as a secondary advanced measurement path with standalone explanations so users can inspect one signal without turning the primary experience into a metrics control panel. Reviewer should confirm whether the focus chooser copy is sufficient or needs more explicit tooltip/help text. |
| Post-Session Coaching | **PDF Export** | Current | Generates branded PDF reports from current transcript/report state and persisted session data. | All PDFs retain SpeakSharp branding/watermarking. |
| Habit & Progress | **Goals / Streaks** | Current foundation | Tracks practice goals and streak-like progress signals. | Existing habit foundation; should increasingly connect to score movement and next-practice targets. |
| Habit & Progress | **Score-Based Gamification** | Current implementation, scheduled for retirement | Ships today via the 0–10 SpeakSharp Score; the motivating loop is being re-based on transparent personal progress (own baseline/targets). | Migrate consumers (`BACKLOG.md` §4); do not deepen 0–10-score gamification. |
| Habit & Progress | **Guided Habit Pathways** | Planned post-soft release | Packaged 2-5 minute drills such as concise update, filler-to-pause replacement, opening/closing clarity, and main-point-first practice. | Planned post-soft release once score/coaching loop is calibrated; not implemented as a complete guided journey today. |
| Access & Reliability | **Usage Limits / Quotas** | Current | Enforces daily/monthly practice limits by tier. | Must fail closed if quota service is unavailable. |
| Access & Reliability | **Daily Usage Visibility** | Planned post-soft release | User-facing progress/status for remaining daily practice time. | Should reduce surprise at limits without making the app feel quota-first. |
| Conversion & Trust | **Upgrade / Conversion Funnel** | Current | Free-to-Pro upgrade path through pricing, analytics, and relevant feature gates. | Basic paid checkout remains deferred/future-only. |
| Conversion & Trust | **Free-To-Pro Upgrade Support** | Infrastructure / limited | Upgrade guidance for Free users outside private practice surfaces. | Keep disabled unless explicitly enabled, and keep private practice surfaces free of conversion messaging. |
| Conversion & Trust | **Landing Social Proof** | Planned, content-dependent | Real user/tester quotes or outcome snippets for first-time visitor trust. | Must use real source material; do not invent testimonials. |
| Conversion & Trust | **Invite / Share Hook** | Planned post-soft release | Simple entry point to share a report or progress moment. | Should build on branded reports and Referral Proof Loop rather than becoming a disconnected CTA. |
| Premium Coaching Ladder | **Executive Rehearsal** | Planned | Passive-first: optional agenda, passive coverage tracking, evidence-backed outcome review, user-requested remedy, evidence-backed recovery; a sparse pause-aware cue is a later, separately-activated experiment (default OFF). Ordered inchstones in `BACKLOG.md` §4. | Planned after soft release; not current release scope. Initial live behavior is passive, not automatic. |
| Premium Coaching Ladder | **Live Meeting Companion** | Future direction only | **Removed from active implementation sequencing.** Future direction: reuse the rehearsal brief/coaching model in a real meeting under a tighter distraction budget. | Not sequenced; re-scoped separately only after Rehearsal proves value. |
| Access & Reliability | **Accessibility / Screen Reader Support** | Current | Live transcript uses accessibility-aware UI patterns. | Keep aligned with UX smoke and page-level accessibility checks. |
| Access & Reliability | **Design System / Visual Surfaces** | Current | Shared visual tokens and standardized card/surface styling. | Theme contrast and Session/Analytics surfaces have been hardened during soft-release prep. |

## Premium Coaching Ladder — HISTORICAL / SUPERSEDED architecture note

> **This entire section is a HISTORICAL architecture note. It is SUPERSEDED and does NOT describe
> current direction.** The current, authoritative direction is the "Personal Progress & Executive
> Rehearsal Product Contract" at the top of this file. This note is retained only for background on
> how the two premium contexts relate. Do **not** read anything below as an active plan.
>
> It is superseded on two points specifically: (1) **Live behavior is passive-first** — any wording
> below about "richer live cues" or "real-time AI presentation improvement during rehearsal" is
> **obsolete**; the initial live experience is **passive** agenda tracking, correction is
> **user-requested first**, and any automatic pause-aware cue is a later, separately-activated
> experiment (kill switch + cognitive-load/annoyance exit criteria). (2) **Live Meeting Companion is
> removed from the active build sequence** and is future direction only — the ordered build sequence
> below is obsolete; the authoritative sequence is in `BACKLOG.md` §4.

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

### Build sequence (re-scoped by the canonical contract)

The **active** build sequence for Executive Rehearsal is passive-first and does **not** include Live
Companion. The authoritative, ordered inchstones live in `BACKLOG.md`; in summary:

1. **Localhost UX sandbox** — a full-interaction local proving environment (representative fixtures,
   no production data/migrations/AI/billing/v4) to settle usability **before** any application-code
   change to `main`.
2. **Passive agenda tracking** — optional brief/agenda, subtle not-addressed / partly / covered
   states during rehearsal; delivery coaching is not displaced; no continuously changing score.
3. **Evidence-backed post-session outcome review** — coverage, misses, clarifications, and
   recovered-after-guidance, each tied to attributable transcript evidence.
4. **User-requested remedy** — the user asks for help on one gap; one concise remedy; no stacked
   suggestions.
5. **Evidence-backed recovery** — mark "recovered" only with attributable evidence (false-positive
   regression tests required).
6. **Sparse pause-aware experiment (later, default OFF)** — at most one cue during a genuine pause,
   with a kill switch and cognitive-load / annoyance-abandonment exit criteria; never during active
   speech.

**Live Meeting Companion** is **future direction only** — not in this sequence. It would be
re-scoped separately, and only after Rehearsal proves value.

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

- Private is the recommended transcription mode and the main beta experience; it keeps audio local to the browser.
- Browser transcription is a free "Quick preview" — a convenience path, not an equivalent to Private.
- Cloud STT is a Pro feature: unavailable to Free testers during the no-billing beta; existing paid-Pro accounts retain access.
- SpeakSharp can track pace, fillers, pauses, clarity signals, history, and reports.
- Semantic AI coaching exists, but quality is still being proven through examples and review.
- SpeakSharp Score is a research-informed coaching score for A/B testing.

Avoid:

- Claiming Native Browser STT is benchmark-grade without live evidence.
- Claiming the Browser "Quick preview" is equivalent to Private transcription.
- Claiming the SpeakSharp Score is a validated public-speaking assessment.
- Claiming Cloud STT is included in the Private sample or available during the no-billing beta.
- Describing a post-save completion toast or "Next: Analytics" overlay as current — there is **no** such toast/overlay (deleted); the single `StatusNotificationBar` is the only post-save surface.
- Claiming free-plan support messages use transcript or speaking data.
- Presenting the planned Executive Presentation Rehearsal Coach, Live Meeting Companion, or packaged Guided Habit Pathways as shipped.
- Presenting Executive Rehearsal's live behavior as automatic/continuous coaching — its initial live behavior is **passive** agenda tracking; correction is user-requested first, and any automatic pause-aware cue is a later, separately-activated experiment.
- Presenting Live Meeting Companion as part of the active build sequence — it is future direction only.
- Presenting the 0–10 SpeakSharp Score as the long-term experience — it is being retired via staged consumer migration and superseded by the Personal Progress model.
- Implying all presentation materials (transcript, talking points, slides, audience context) stay on-device: semantic AI feedback may require cloud AI unless local LLM analysis is separately built.

## Related Operational Docs

- Score model: `SPEAKSHARP_SESSION_PROGRESS.operational.md`
- Product contract: `PRD.operational.md`
- Release posture: `RELEASE_STATUS.md`
- Deferred work: `BACKLOG.md`
- Risk tracker: `ROADMAP.operational.md`

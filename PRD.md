# SpeakSharp Product Requirements Document

**Version 6.18** | **Last Updated: August 14, 2025**

---

## 🔄 Recent Updates (v6.19)
*August 19, 2025*

- **Feature: Improved Real-time Feedback and UI**:
  - Implemented a new pill-shaped timer for a clearer session interface.
  - Reworked the filler word detection to provide more accurate, real-time updates during a session.
  - Improved the loading state to be less disruptive.
- **Critical Bug Fixes & Robustness**:
  - Fixed layout issues with column alignment and transcript panel sizing.
  - Improved error handling for transcription service connection failures, providing clearer feedback to the user.
  - Removed the automatic fallback to the native browser speech recognition to prevent silent failures and confusion.

---

## 🔄 Recent Updates (v6.18)
*August 18, 2025*

- **Feature: Transcript Accuracy Score:**
  - Implemented a new feature to calculate and display the average confidence score from the AssemblyAI transcription.
  - This "Transcript Accuracy" metric is now shown on the Analytics Dashboard, both as a summary stat and on individual session cards, giving users insight into the quality of their transcription.
- **Critical Bug Fixes & Simulation Improvements:**
  - Repaired the session saving and data flow logic, ensuring user practice history is now correctly saved and displayed on the analytics page.
  - Improved the "Local" mode simulation to use a realistic sentence with filler words, and added a toast notification to clarify that it's a demo mode.
  - Enabled disfluency detection in the cloud transcription service to ensure common filler words (`um`, `ah`, etc.) are correctly identified.
- **Major UI/UX Overhaul (Based on User Feedback):**
  - **Analytics Page:** Redesigned the dashboard with a more engaging empty state, larger and clearer statistics, and a card-based layout for session history.
  - **Session Page:** Rebuilt the filler word analysis section with a severity-based color palette and progress bars. Redesigned the recording controls for better usability and hierarchy. Fixed the layout of the transcript panel to prevent it from pushing down other content.

---

## ⚠️ Known Issues
- **On-Device Transcription is Not Yet Implemented:** The `LocalWhisper` provider in `TranscriptionService` is a non-functional simulation that uses sample text. The UI toggle remains enabled for demo purposes, with a toast notification to inform users. This is the top priority for Phase 2.

---

## 🎯 Executive Summary

### Product Vision
SpeakSharp is a **privacy-first, real-time speech analysis tool** that empowers users to become more confident and articulate speakers. By providing instant, on-device feedback on filler word usage and speaking pace — without storing user audio — we enable practice that is both effective and secure.

### Business Value & Competitive Edge
Our competitive advantage is **speed + privacy**. Users experience an immediate "aha" moment in their first session, driving free-to-paid conversions.

### Go-to-Market Strategy
```
Pre-MVP    → Build audience via Reddit, SEO articles, email capture
Launch     → Google Ads, organic Reddit traffic, Product Hunt
Growth     → SEO expansion, retargeting ads, coach partnerships
```

### Primary Success Metrics
```
📊 Homepage → Signup Conversion:  15%+
💰 Free → Paid Conversion:       5%+
🔄 Returning Monthly Users:      40%+
✅ Session Completion Rate:      80%+
```

---

## 💰 Pricing Model

```
┌─────────────┬──────────────┬───────────────────────────────────────┐
│    TIER     │    PRICE     │               FEATURES                │
├─────────────┼──────────────┼───────────────────────────────────────┤
│    FREE     │     $0       │ • 2-min trial session                 │
│             │              │ • 10 mins/month logged in             │
│             │              │ • Last 3 sessions saved               │
│             │              │ • 5 custom words                      │
│             │              │ • Basic analytics                     │
├─────────────┼──────────────┼───────────────────────────────────────┤
│    PRO      │   $7.99      │ • Unlimited sessions                  │
│             │              │ • Unlimited custom words              │
│             │              │ • Full analytics history              │
│             │              │ • Improvement tracking                │
│             │              │ • PDF export                          │
│             │              │ • High-accuracy cloud transcription   │
│             │              │ • Download audio locally              │
└─────────────┴──────────────┴───────────────────────────────────────┘
```

---

## 🔒 Privacy Policy

**What we DON'T store:**
- ❌ Audio recordings (never saved on servers)

**What we DO store:**
- ✅ Filler word counts
- ✅ Session duration
- ✅ Speaking pace
- ✅ Timestamps

---

## 🛠️ Technology Stack

Our technology choices prioritize development speed, scalability, and user experience.

- **Frontend:** React (Vite)
- **Styling:** Tailwind CSS with shadcn/ui components
- **Backend & Database:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Speech Recognition:** A custom `TranscriptionService` using AssemblyAI's cloud API.
- **Payments:** Stripe
- **Monitoring & Analytics:** Sentry & PostHog

*A more detailed breakdown of the architecture, including diagrams and data flows, can be found in the `System Architecture.md` document.*

---

## 🗓️ Development Roadmap

### PHASE 1 — MVP FOUNDATION (Weeks 1-3) - 90% Complete
- **Must Have:**
    - `✅` **[M]** Implement core backend services (Supabase Auth & DB).
    - `✅` **[M]** Implement `TranscriptionService` with AssemblyAI provider.
    - `✅` **[M]** Integrate `TranscriptionService` into the main session page.
    - `✅` **[M]** Implement Stripe payment flow for Pro tier.
    - `[ ]` **[M]** Configure production Price ID for Stripe checkout.
    - `✅` **[M]** Set up Sentry for error monitoring.
    - `✅` **[M]** Set up PostHog for product analytics.
- **Should Have:**
    - `✅` **[S]** Develop a responsive UI with a professional light theme.
    - `[ ]` **[S]** Comprehensive QA and performance tuning.
- **Could Have:**
    - `[ ]` **[C]** A/B testing setup with PostHog.
- **Won't Have (for this phase):**
    - `[ ]` **[W]** On-device transcription (moved to Phase 2).

### PHASE 2 — PRIVACY & POLISH (Months 1-3) - 25% Complete
- **Must Have:**
    - `[ ]` **[M]** Integrate Whisper.cpp into `TranscriptionService` for on-device transcription. (See "Known Issues")
    - `[ ]` **[M]** Implement automatic fallback from local to cloud STT based on performance.
    - `✅` **[M]** Build a comprehensive analytics dashboard for users.
- **Should Have:**
    - `✅` **[S]** Re-evaluated fallback to native Web Speech API. The automatic fallback was removed to prevent silent failures and provide clearer error messages.
    - `[ ]` **[S]** Implement weekly summary emails.
    - `[ ]` **[S]** Add in-app prompts to encourage users to upgrade.
    - `[ ]` **[S]** Conduct thorough cross-browser testing and bug fixing.
- **Could Have:**
    - `[ ]` **[C]** A/B test different UI elements and user flows.
    - `[ ]` **[C]** Optimize funnels based on PostHog data.

### PHASE 3 — SCALE & EXPANSION (Months 6-12) - 0% Complete
- **Must Have:**
    - `[ ]` **[M]** Implement team accounts and billing.
- **Should Have:**
    - `[ ]` **[S]** Add support for more languages.
    - `[ ]` **[S]** Develop AI-powered suggestions for improving speech.
- **Could Have:**
    - `[ ]` **[C]** Full offline mode for the application.
    - `[ ]` **[C]** Case studies and advanced content marketing.

---

## 📊 Financial Projections

### Assumptions
- **Free → Paid Conversion:** 5%
- **Stripe Fee:** 3% of revenue
- **Ad Spend:** $350/month average
- **Tool + Infrastructure Costs:** $141/month baseline

### Monthly Growth Projection
```
┌─────┬──────┬───────┬─────────┬───────────┬──────────┬────────────┬──────────────┬────────────┬──────────┐
│ Mth │ MAU  │ Paid  │ Revenue │ Infra     │ Ad Spend │ Stripe     │ Total Costs  │ Net Profit │ Profit % │
│     │      │ Users │         │ Costs     │          │ Fees       │              │            │          │
├─────┼──────┼───────┼─────────┼───────────┼──────────┼────────────┼──────────────┼────────────┼──────────┤
│  1  │ 250  │  13   │ $103.87 │   $141    │   $350   │   $3.12    │   $494.12    │  -$390.25  │  -375%   │
│  3  │1,200 │  60   │ $479.40 │   $141    │   $350   │   $14.38   │   $505.38    │   -$25.98  │   -5%    │
│  6  │3,000 │ 150   │$1,198.50│   $161    │   $350   │   $35.96   │   $546.96    │   $651.54  │   54%    │
└─────┴──────┴───────┴─────────┴───────────┴──────────┴────────────┴──────────────┴────────────┴──────────┘
```

### Key Business Metrics

**📈 LTV (Lifetime Value)**
```
Formula: ARPU × Average Customer Lifespan
Calculation: $7.99/month × 12 months = $95.88
```

**💸 CAC (Customer Acquisition Cost)**
```
Formula: Total Marketing Spend ÷ New Paying Customers
Example Calculation: $350 ÷ 35 customers = $10.00
(Note: This is a sample calculation. Actual CAC will vary based on ad performance and conversion rates from the growth projection.)
```

**🎯 LTV:CAC Ratio**
```
Current Ratio: $95.88 ÷ $10.00 = 9.5:1
Target: 3:1+ (Highly favorable ✅)
```

---

## 🚀 Go-to-Market Assets

### Reddit Engagement Strategy

**Post #1 - Educational Approach**
- **Target:** r/PublicSpeaking, r/PresentationSkills
- **Title:** "How I cut my filler words in half before my big presentation"
- **Strategy:** Share personal story with soft product mention

**Post #2 - Beta Recruitment**
- **Target:** r/Toastmasters, r/CareerSuccess  
- **Title:** "Beta testers wanted: Real-time filler word counter for speech practice"
- **Strategy:** Direct community engagement for early adopters

### SEO Content Strategy

**Pillar Article: "How to Stop Saying 'Um'"**
- **Target Keyword:** "how to stop saying um"
- **Length:** ~2,500 words
- **Structure:** Psychology → Techniques → Tools → Action steps

---

## ✅ Success Criteria

```
🎯 Achieve 500 MAUs within 3 months post-launch
💰 Reach 5% free-to-paid conversion rate
📱 Maintain <40% mobile bounce rate  
💵 Achieve profitability within 12 months
```

---

*Ready to help users speak with confidence while keeping their privacy protected.* 🎤🔒

---
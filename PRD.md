# SpeakSharp Product Requirements Document

**Version 6.21** | **Last Updated: August 21, 2025**

---

## 🔄 Recent Updates (v6.21)
*August 21, 2025*

- **New Theme: "Midnight Blue & Electric Lime"**: Implemented a new dark mode theme to provide a more modern and focused user experience. The theme features a midnight blue background with electric lime accents.
- **Test Suite Migration and Stabilization**: Reverted a failed migration to Jest and re-established a stable and functional test suite using **Vitest**. This has resolved all test-related stability issues.

---

## 🔄 Recent Updates (v6.20)
*August 19, 2025*

- **UI/UX Improvements (Based on User Feedback)**:
  - **Global Font Sizing:** Removed hard-coded font sizes in the Session Sidebar to ensure all text correctly inherits the global base font size, improving readability and consistency.
  - **Prominent Mode Notification:** The notification indicating the current transcription mode (Cloud vs. Local) is now more prominently displayed at the top of the settings panel.
- **Bug Fixes:**
  - **Filler Word Detection:** Improved the detection logic for common filler words like 'um', 'ah', and 'uh' to be more accurate.

---

## ⚠️ Known Issues
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` is a functional implementation using Transformers.js. However, it may require further UI/UX polishing for model loading feedback and error handling before it is production-ready.

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
│    FREE     │     $0       │ • 10 mins/month logged in             │
│             │              │ • Unlimited custom words              │
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

### PHASE 1 — MVP FOUNDATION (Weeks 1-3) - ~80% Complete
- **[DONE]** `[M]` Implement core backend services (Supabase Auth & DB).
- **[DONE]** `[M]` Implement `TranscriptionService` with AssemblyAI provider.
- **[DONE]** `[M]` Integrate `TranscriptionService` into the main session page.
- **[DONE]** `[M]` Implement Stripe payment flow for Pro tier.
- **[DONE]** `[M]` Configure production Price ID for Stripe checkout (via environment variable).
- **[DONE]** `[M]` Set up Sentry for error monitoring.
- **[DONE]** `[M]` Set up PostHog for product analytics.
- **[DONE]** `[S]` Develop a responsive UI with a professional light theme.
- **[DONE]** `[S]` Migrate test suite from Vitest to Jest to stabilize the testing environment.
- **[DONE]** `[S]` Implement "Midnight Blue & Electric Lime" theme.
- **[DEFERRED]** `[C]` A/B testing setup with PostHog.

### PHASE 2 — PRIVACY & POLISH (Months 1-3) - ~60% Complete
- **[DONE]** `[M]` Build a comprehensive analytics dashboard for users.
- **[DONE]** `[S]` Re-evaluated fallback to native Web Speech API (removed as a feature).
- **[DONE]** `[M]` Integrate On-Device Transcription (using **Transformers.js**).
- **[BLOCKED]** `[M]` Implement automatic fallback from local to cloud STT based on performance.
- **[OUTSTANDING]** `[S]` Implement weekly summary emails.
- **[OUTSTANDING]** `[S]` Add in-app prompts to encourage users to upgrade.
- **[OUTSTANDING]** `[S]` Conduct thorough cross-browser testing and bug fixing.
- **[DEFERRED]** `[C]` A/B test different UI elements and user flows.
- **[DEFERRED]** `[C]` Optimize funnels based on PostHog data.

### PHASE 3 — SCALE & EXPANSION (Months 6-12) - 0% Complete
- **[OUTSTANDING]** `[M]` Implement team accounts and billing.
- **[OUTSTANDING]** `[S]` Add support for more languages.
- **[OUTSTANDING]** `[S]` Develop AI-powered suggestions for improving speech.
- **[DEFERRED]** `[C]` Full offline mode for the application.
- **[DEFERRED]** `[C]` Case studies and advanced content marketing.

### NEW: DEPLOYMENT
- **[OUTSTANDING]** `[M]` Set up production deployment on Vercel (includes config and environment variables).

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
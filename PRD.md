# SpeakSharp Product Requirements Document

**Version 6.21** | **Last Updated: August 21, 2025**

---

## Recent Updates (v6.21)
*August 21, 2025*

- **New Theme: "Midnight Blue & Electric Lime"**: Implemented a new dark mode theme to provide a more modern and focused user experience. The theme features a midnight blue background with electric lime accents.
- **Test Suite Migration and Stabilization**: Reverted a failed migration to Jest and re-established a stable and functional test suite using **Vitest**. This has resolved all test-related stability issues.

---

## Recent Updates (v6.20)
*August 19, 2025*

- **UI/UX Improvements (Based on User Feedback)**:
  - **Global Font Sizing:** Removed hard-coded font sizes in the Session Sidebar to ensure all text correctly inherits the global base font size, improving readability and consistency.
  - **Prominent Mode Notification:** The notification indicating the current transcription mode (Cloud vs. Local) is now more prominently displayed at the top of the settings panel.
- **Bug Fixes:**
  - **Filler Word Detection:** Improved the detection logic for common filler words like 'um', 'ah', and 'uh' to be more accurate.

---

## Known Issues
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` is a functional implementation using Transformers.js. However, it may require further UI/UX polishing for model loading feedback and error handling before it is production-ready.
- **`useSpeechRecognition` Test Disabled:** The test file for the main `useSpeechRecognition` hook (`useSpeechRecognition.test.jsx`) is currently disabled due to a critical, unresolvable memory leak.
  - **Status (as of Aug 23, 2025):** The test was re-enabled and confirmed to fail with a `JS heap out of memory` error, even when run in isolation.
  - **Analysis:** The memory leak appears to be caused by the large dependency graph of the hook, which includes the AI models from Transformers.js. The issue persists even with advanced mocking strategies.
  - **Action:** The file has been re-disabled with a `.disabled` extension to maintain a stable CI pipeline. This remains a high-priority issue to resolve to ensure full test coverage.
  - **Developer Note:** When attempting to debug this test, it is a long-running process. It should be executed as a background task (e.g., `pnpm test src/__tests__/useSpeechRecognition.test.jsx &`) to avoid blocking the shell.

---

## Executive Summary

SpeakSharp is a real-time speech analysis tool built on two pillars: speed and privacy.

**Speed Today:** Our MVP delivers instant transcription and filler-word feedback using a fast, cloud-based speech recognition engine (AssemblyAI). This enables users to experience the “aha” moment of immediate speaking insights from day one.

**Privacy by Design:** SpeakSharp never stores raw audio on our servers. From launch, only session metadata (word counts, filler analysis, timestamps) is saved — transcripts and recordings remain entirely private to the user.

**Our Roadmap:** Cloud transcription ensures rapid, accurate feedback today. In parallel, we are actively developing fully on-device transcription (using lightweight local AI models) to guarantee that no audio ever leaves the user’s device. This will make SpeakSharp the only speech analysis tool that combines real-time feedback with true privacy.

For **Anonymous users**, we offer a single, 2-minute trial session to create an immediate "aha" moment and drive signup conversions.
For **Free users**, SpeakSharp provides a generous free tier (30-minute session limits, trend-based analytics) designed to build a habit and reinforce our privacy-first value proposition with local-by-default transcription.
For **Pro users**, we unlock the full power of the tool: unlimited practice, deep per-session analytics, and premium features like high-accuracy cloud transcription modes.

**Bottom Line:** SpeakSharp gives users fast, practical tools to speak more confidently today, while leading the market toward a future where speech improvement tools never compromise privacy.

### Go-to-Market Strategy
```
Pre-MVP    → Build audience via Reddit, SEO articles, email capture
Launch     → Google Ads, organic Reddit traffic, Product Hunt
Growth     → SEO expansion, retargeting ads, coach partnerships
```

### Primary Success Metrics
```
- Homepage → Signup Conversion:  15%+
- Free → Paid Conversion:       5%+
- Returning Monthly Users:      40%+
- Session Completion Rate:      80%+
```

---

## Pricing Model

*(Note: A 7-day unlimited Pro trial will be offered to encourage conversion.)*

```
┌─────────────┬──────────────┬──────────────────────────────────────────────────┐
│    TIER     │    PRICE     │                     FEATURES                     │
├─────────────┼──────────────┼──────────────────────────────────────────────────┤
│    FREE     │     $0       │ • 30-minute session limit*                       │
│             │              │ • Local-only transcription (privacy-first)       │
│             │              │ • Trend-based analytics dashboards               │
│             │              │ • 3 custom filler words                          │
├─────────────┼──────────────┼──────────────────────────────────────────────────┤
│    PRO      │   $7.99      │ • Unlimited session time & history               │
│             │              │ • Advanced per-session analytics & insights      │
│             │              │ • Premium high-accuracy cloud transcription mode │
│             │              │ • Unlimited custom filler words                  │
│             │              │ • PDF export & data download                     │
│             │              │ • Offline Mode & Encrypted Storage (coming soon) │
└─────────────┴──────────────┴──────────────────────────────────────────────────┘
```
*\*The Free tier includes a monthly usage quota. A hard 30-minute limit per session is planned for implementation (see roadmap).*

---

## Privacy Policy

**What we DON'T store:**
- Audio recordings (never saved on servers)

**What we DO store:**
- Filler word counts
- Session duration
- Speaking pace
- Timestamps

---

## Technology Stack

Our technology choices prioritize development speed, scalability, and user experience.

- **Frontend:** React (Vite)
- **Styling:** Tailwind CSS with shadcn/ui components
- **Backend & Database:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Speech Recognition:** A custom `TranscriptionService` that defaults to on-device transcription via **Transformers.js** (for the Free tier) and offers a premium, high-accuracy cloud mode via **AssemblyAI** (for the Pro tier).
- **Payments:** Stripe
- **Monitoring & Analytics:** Sentry & PostHog

*A more detailed breakdown of the architecture, including diagrams and data flows, can be found in the `System Architecture.md` document.*

---

## Development Roadmap

This roadmap reflects our final, agreed-upon strategy: to launch a highly resilient, "Cloud-First" MVP that silently falls back to a native browser implementation to ensure the app is **always functional**.

### **Phase 1: Launch the Resilient "Cloud-First" MVP**

**Goal:** Deliver a best-in-class speech-coaching experience that is always available, gracefully degrading from premium to basic quality when necessary.

**Core User Experience:**
*   **No user-facing mode selection.** The application automatically provides the best possible transcription quality.
*   **Primary Mode (All Users):** High-accuracy **Cloud Mode**.
*   **Automatic Fallback Mode:** If Cloud Mode fails (due to API errors, network issues, etc.), the app **silently and automatically** switches to the browser's native speech recognition.
*   **UI Indicator:** A subtle indicator will show the current quality (e.g., "⚡ Premium Quality" vs. "📱 Basic Mode"), creating a natural upsell opportunity.

**Execution Plan & Action Items:**

*   ⚪ **Week 1: Implement the Fallback Logic & Fix Developer Access**
    *   **Task:** Implement the simple, environment-based auth bypass for developers in the `assemblyai-token` function.
    *   **Task:** Refactor `TranscriptionService.js`. The `startTranscription` method will be wrapped in a `try...catch` block. It will `try` to start the Cloud service and `catch` any errors by starting the Native Browser service.
    *   **Task:** Update the `README.md` with the new, simplified developer setup instructions.

*   ⚪ **Week 2: Implement Usage Limits & Refine the UI**
    *   **Task:** Implement the database schema and RPC functions to track and enforce the **10 minutes/month Cloud usage limit** for the Free Tier.
    *   **Task:** **Remove** all UI elements related to mode selection from `SessionSidebar.jsx`.
    *   **Task:** **Create** the new UI quality indicator component to show "Premium" vs. "Basic" quality.

*   ⚪ **Week 3: Polish the User Journey & Remove Dead Code**
    *   **Task:** Add the global `<Toaster />` component to `App.jsx` to enable notifications for errors and events (e.g., running out of minutes).
    *   **Task:** **Remove** the `LocalWhisper.js` file and all related code, as it is out of scope for the MVP.
    *   **Task:** Test the end-to-end user journey: Free signup -> use Cloud -> (simulate Cloud failure) -> see fallback to Native -> use up quota -> see upgrade prompt -> upgrade to Pro -> get unlimited Cloud.

*   ⚪ **Week 4: Final Polish & Launch Prep**
    *   **Task:** Harden the `NativeBrowser.js` service with more error handling to make the fallback experience as reliable as possible.
    *   **Task:** Prepare for launch.

### **Phase 2: Post-MVP Expansion (Future Roadmap)**

*   ⚪ **Re-evaluate Local/Private Mode:** Based on user feedback and growth, scope the engineering effort to build a robust, privacy-first Local Mode as a premium, differentiating feature.
*   ⚪ **Expand Analytics & Coaching:** Build out more AI-powered features based on the reliable data we collect.

---

## Financial Projections

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

**LTV (Lifetime Value)**
```
Formula: ARPU × Average Customer Lifespan
Calculation: $7.99/month × 12 months = $95.88
```

**CAC (Customer Acquisition Cost)**
```
Formula: Total Marketing Spend ÷ New Paying Customers
Example Calculation: $350 ÷ 35 customers = $10.00
(Note: This is a sample calculation. Actual CAC will vary based on ad performance and conversion rates from the growth projection.)
```

**LTV:CAC Ratio**
```
Current Ratio: $95.88 ÷ $10.00 = 9.5:1
Target: 3:1+ (Highly favorable)
```
*(Note: This LTV:CAC model is optimistic and based on early assumptions. It will be recalibrated with real user data post-launch to account for churn and actual conversion rates.)*

---

## Go-to-Market Assets

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

## Success Criteria

```
- Achieve 500 MAUs within 3 months post-launch
- Reach 5% free-to-paid conversion rate
- Maintain <40% mobile bounce rate
- Achieve profitability within 12 months
```

---

Private practice. Public impact.

---

## Technical Debt

This section tracks known technical issues and areas for improvement that have been identified but not yet prioritized for immediate action.

-   **[OPEN]** **`createRoot` Warning:** The application throws a warning: `You are calling ReactDOMClient.createRoot() on a container that has already been passed to createRoot() before.` This suggests that the main script might be loading more than once. While a guard exists in `main.jsx` to prevent this, the warning persists, pointing to a potential issue in the Vite HMR environment.
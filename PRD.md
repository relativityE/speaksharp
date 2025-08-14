# SpeakSharp Product Requirements Document

**Version 6.17** | **Last Updated: August 14, 2025**

---

## 🔄 Recent Updates (v6.17)
*August 14, 2025*

- **Phase 1 MVP Integrations:**
    - **Sentry:** Fully integrated Sentry for error monitoring using the provided DSN.
    - **PostHog:** Integrated PostHog for product analytics, including a custom event for session tracking.
    - **Stripe:** Implemented the full Stripe payment flow, including a frontend checkout button and backend Supabase functions for session creation and webhook handling.
- **Major UI/UX Redesign (Light Theme):** In response to user feedback, performed a complete visual overhaul.
    - Implemented a professional two-tone light theme with a light gray background, white cards, and blue accents for a clean, high-contrast aesthetic.
    - Increased global font sizes for better readability and accessibility.
- **Bug Fixes & Stability:** Restored critical non-UI fixes, including the session page scrolling bug.


**Version 6.15** | **Last Updated: August 13, 2025**

---

## 🔄 Recent Updates (v6.15)
*August 13, 2025*

- **Global UI Overhaul:** Replaced the primary font with "Inter" for improved readability and implemented a new, modern color palette (off-white background, new text and accent colors) for a cleaner look and feel across the application.
- **Sign-In Page Redesign:** Completely redesigned the sign-in page to align with the new visual identity, featuring improved layout, spacing, and modern aesthetics.
- **Consistent Navigation:** Implemented a unified header across all pages, including the sign-in page, ensuring the SpeakSharp logo is always present and serves as a home button.
- **Bug Fix: Session Page Stability:** Resolved a critical bug causing the session page to "bounce" or scroll unexpectedly during live transcription, providing a more stable user experience.

---

## 🔄 Recent Updates (v6.14)
*August 13, 2025*

- **General:** Implemented a default light theme and softened the highlight color for filler words.
- **Analytics:** Verified the fix for the `NaN` error on the analytics page and implemented robust data handling for chart visualizations.
- **Landing Page:** Added a prominent "privacy-first" message and improved the visibility of the "no account required" text to reduce friction.
- **Session UI:** Enhanced the "Custom Words" feature with a tooltip, clearer instructions, and a "Pro" badge.
- **Responsiveness:** Implemented a responsive header with a hamburger menu for mobile devices.
- **Tests:** Fixed several failing tests.

---

## 🔄 Recent Updates (v6.13)
*August 12, 2025*

- **Advanced Session UI:** Implemented a major redesign of the session page for a more dynamic and interactive user experience.
    - **Color-Coded Analysis:** Filler words are now assigned unique colors, which are displayed in the analysis list and used for real-time highlighting in the transcript.
    - **Dynamic Layout:** The timer and analysis boxes have been resized, and the transcript panel now starts small and grows as the user speaks, making better use of screen space.

---

## 🔄 Recent Updates (v6.12)
*August 12, 2025*

- **Analytics for All:** Anonymous users can now view a complete analysis of their practice session without needing to create an account. This lowers the barrier to experiencing the product's full value.
- **UI & UX Enhancements:**
    - Corrected the display of "You Know" and "I Mean" filler words.
    - Redesigned the "Browser Not Supported" warning to be a less intrusive, more informative caution message.
    - Increased the font size of all links across the application to improve readability and accessibility.
- **Technical Fixes:**
    - Resolved a CSS build error related to theme color resolution.
    - Added a new test suite for the site header to improve test coverage.

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

## 💰 Pricing Model (Phase 1 MVP)

*Note: This table reflects the features implemented in the initial MVP. Additional Pro features are planned for future phases.*

```
┌─────────────┬──────────────┬───────────────────────────────────────┐
│    TIER     │    PRICE     │            MVP FEATURES               │
├─────────────┼──────────────┼───────────────────────────────────────┤
│    FREE     │     $0       │ • 5 mins/month of practice time       │
│             │              │ • Full session history saved          │
│             │              │ • Basic analytics                     │
├─────────────┼──────────────┼───────────────────────────────────────┤
│    PRO      │   $7.99      │ • Unlimited practice time             │
│             │              │ • Unlimited custom words to track     │
│             │              │ • Full analytics history              │
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

### Core Technologies
```
Frontend        → React + Vite
Styling         → Tailwind CSS + shadcn/ui  
Auth/Database   → Supabase
Speech API      → Web Speech API
Payments        → Stripe
Monitoring      → Sentry
Analytics       → PostHog
Hosting         → Vercel
```

### Scalability Architecture
**Speech Processing:**
- **Free Users:** Browser Web Speech API (unlimited concurrent users)
- **Pro Users:** Optional Whisper API via serverless functions

**Scaling Strategy:**
- Client-heavy architecture minimizes server load
- Serverless functions auto-scale for premium features
- Managed services handle scaling automatically

---

## Test Approach

Our project employs a sophisticated, hybrid testing strategy to balance speed and accuracy. It consists of two parallel tracks: a primary suite for fast feedback and a specialized suite for features that are difficult to test in a simulated environment.

### 1. The Main Test Suite: **Vitest + JSDOM**

This is the primary testing stack for the majority of the application.

*   **Vite**: Acts as the core build tool. When you run the tests, Vitest uses Vite's engine to compile and process the React code and tests.
*   **Vitest**: Our main **test runner**. `pnpm test` executes all `*.test.jsx` files.
*   **JSDOM**: Vitest runs its tests in a **simulated browser environment** called JSDOM. It's fast but is not a real browser. This was identified as the source of instability for browser-native APIs like `SpeechRecognition`.

### 2. The Special Case Test: **Playwright + Real Browser**

For features that are untestable in JSDOM, we migrate them to a separate, more robust environment.

*   **Playwright**: This is our secondary **test runner**, used for specific end-to-end or component-in-browser tests. It controls a **real, full-featured browser** (Chromium), avoiding JSDOM's limitations.
*   **Standalone Harness**: We create tiny, self-contained React applications (`playwright-tests/harness/`) to host the component or hook under test.
*   **Embedded Server**: The Playwright test itself builds the harness using a dedicated Vite config (`vite.harness.config.ts`) and serves it using a lightweight, built-in HTTP server. This makes the test completely self-contained and independent of the main dev server.

### Summary of Tools

| Tool          | Role                                           | When It's Used                                               |
| :------------ | :--------------------------------------------- | :----------------------------------------------------------- |
| **Vite**      | Core build engine.                             | Used by `pnpm run dev`, Vitest, and the Playwright harness build. |
| **Vitest**    | Main test runner for fast unit/integration tests. | `pnpm test`                                                  |
| **JSDOM**     | Simulated browser for Vitest.                  | The environment for all Vitest tests.                        |
| **Playwright**| Secondary, end-to-end test runner.             | For specific unstable features (`npx playwright test`).        |

This hybrid approach allows us to maintain a fast and efficient development cycle for most of the codebase while ensuring that complex, browser-specific features are tested with the accuracy and stability of a real browser environment.

---

## 🗓️ Development Roadmap

### PHASE 1 — MVP (Weeks 1-3)

```
┌─────────────┬──────────────────────────────┬─────────────────────────────────┐
│    WEEK     │          ENGINEERING         │       MARKETING & GROWTH        │
├─────────────┼──────────────────────────────┼─────────────────────────────────┤
│   Week 1    │ ✅ Finalize filler detection  │ • Launch email capture page    │
│             │ ✅ Supabase auth & limits     │ • Begin Reddit engagement      │
│             │ ✅ Stripe payments            │                                │
│             │ ✅ PostHog setup (KPI + A/B)  │                                │
├─────────────┼───────────────────────────────┼────────────────────────────────┤
│   Week 2    │ ✅ Landing page w/ real UX    │ • Publish 1 SEO article        │
│             │ ✅ Sentry error logging       │ • Social handles + demo video  │
├─────────────┼───────────────────────────────┼────────────────────────────────┤
│   Week 3    │ ✅ QA & performance tuning    │ • Publish 2nd SEO article      │
│             │ ✅ Launch MVP                 │ • Announce beta on Reddit      │
└─────────────┴───────────────────────────────┴────────────────────────────────┘
```

### PHASE 2 — GROWTH (Months 1-3)

```
┌─────────────┬─────────────────────────────────┬─────────────────────────────────┐
│    MONTH    │          ENGINEERING            │       MARKETING & GROWTH        │
├─────────────┼─────────────────────────────────┼─────────────────────────────────┤
│   Month 1   │ • Progress dashboard            │ • Product Hunt launch           │
│             │ • Upgrade prompts               │ • Start Google Ads campaign     │
│             │ • Cross-browser QA              │ • Retargeting via FB/IG         │
│             │ • A/B test landing page         │ • Continue Reddit outreach      │
├─────────────┼─────────────────────────────────┼─────────────────────────────────┤
│   Month 2   │ • Weekly summary emails         │ • Publish 2 SEO posts/month     │
│             │ • Funnel optimization           │ • Optimize Google Ads keywords  │
├─────────────┼─────────────────────────────────┼─────────────────────────────────┤
│   Month 3   │ • Performance monitoring        │ • Content marketing expansion   │
│             │ • User feedback implementation  │ • Partnership outreach          │
└─────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

### PHASE 3 — SCALE (Months 6-12)

```
┌─────────────┬─────────────────────────────────┬─────────────────────────────────┐
│ TIMEFRAME   │          ENGINEERING            │       MARKETING & GROWTH        │
├─────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Months 6-12 │ • Offline mode                  │ • Paid partnerships             │
│             │ • AI suggestions                │ • International SEO             │
│             │ • Team accounts                 │ • Case studies                  │
│             │ • Language support              │ • Content scaling               │
└─────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

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
Calculation: $350 ÷ 35 customers = $10.00
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
# SpeakSharp - Product Requirements Document (PRD)

**Version**: 2.3
**Last Updated**: 2025-08-09

## 1. Executive Summary
SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users become better presenters and communicators by eliminating filler words. The product processes speech locally in the browser, ensuring no audio or transcript is ever stored for anonymous or free-tier users. Premium tiers unlock more usage time, deeper analytics, and optional, consent-based cloud STT for high-accuracy transcription.

**Core Value Proposition**: Immediate, private feedback on filler word usage to improve verbal clarity, with a frictionless entry point and a clear path to powerful premium features.

## 2. User Flow & Tiers

### Anonymous Free Trial
- **Goal**: Maximize user adoption and deliver an instant "aha!" moment with zero friction.
- **Flow**:
  1. User lands on the page and can immediately start a **2-minute trial session**.
  2. No account or sign-up is required.
  3. Real-time filler word detection runs locally in the browser.
  4. At the end of 2 minutes, the session automatically ends, and the user is navigated to the analytics page.
  5. A development-only "override timer" checkbox is available to allow for longer sessions.

### Free Tier (Account Required)
- **Goal**: Convert trial users into registered users to enable retention tracking and create an upgrade path.
- **Includes**:
  - **30 minutes/month** of local analysis time (resets monthly).
  - Ability to track **unlimited custom filler words**.
  - **Save the last 3 sessions** to track recent progress.
  - Visual real-time counters for each tracked word.

### Pro Tier ($9.99/month)
- **Goal**: Monetize engaged individuals who need more usage and deeper insights.
- **Includes**:
  - **Unlimited** local analysis time and session history.
  - **Unlimited** custom filler words.
  - **Advanced analytics dashboard** (trend visualization, per-word graphs).
  - **Export** session history as a JSON file. A more advanced CSV/PDF export is planned.

### Premium Tier ($19.99/month)
- **Goal**: Serve power users, professionals, and future teams who require the highest accuracy.
- **Includes**:
  - Everything in Pro Tier.
  - Optional **cloud-powered STT** (e.g., Whisper API) for higher accuracy.
  - Clear visual indicator when cloud processing is active.
  - Team collaboration and API access (Future Roadmap).

## 3. Proposed Architecture
| Component | Tech Stack | Purpose |
|---|---|---|
| Frontend | React + Vite (existing), migrate to **Next.js 15 App Router** | Next.js enables server-side rendering and API routes, essential for subscription logic, authentication, and analytics integrations. |
| Auth & Database | **Supabase (Auth & PostgreSQL)** | Single platform for authentication, authorization, and metadata storage. Managed, scalable, reduces backend complexity. |
| Payment Processing | **Stripe** | Industry-standard for secure payments and subscription management. Reliable webhooks and easy integration with Supabase. |
| Error Tracking & Monitoring | **Sentry** | Purpose-built for real-time error detection and alerting. Critical for production reliability. |
| Product Analytics | **PostHog** | Tracks user behavior, feature adoption, and engagement trends. Complements Sentry by providing business-level insights. |
| Speech Processing (Local) | Web Speech API | No data leaves the browser, enabling privacy-first design for the free trial and free tier. |
| Speech Processing (Cloud) | Whisper API or equivalent (Premium only) | High-accuracy STT for users who opt in. Only metadata stored — no raw audio. |

## 4. Privacy & Security Requirements
- **No storage of audio or transcripts** at any tier.
- Only filler word counts, timestamps, and trend data are stored for registered users.
- **Explicit user consent** is required for any cloud-based processing.
- A clear visual indicator must be present when speech is being sent to the cloud.
- All API requests must be validated; use secure, HTTP-only cookies for sessions.
- Supabase Row Level Security (RLS) will be enabled for per-user data isolation.
- CSRF protection and rate limiting will be implemented.

## 5. Cost & Margin Projections
This projection models the unit economics for the SpeakSharp SaaS platform based on a target of **250 paid monthly active users (MAU)**.

**Assumptions**:
- **User Split**: The 250 paid users are split into 200 Pro users and 50 Premium users.
- **STT Usage**: Premium users utilize the cloud STT feature at an average rate of 135 minutes/month, costing ~$0.81 per user.
- **Baseline Costs**: Infrastructure and tool costs are estimated at ~$195/month.

| Metric | Calculation | Value |
|---|---|---|
| **Revenue** | | |
| Pro Users | 200 users × $9.99/month | $1,998 |
| Premium Users | 50 users × $19.99/month | $999.50 |
| **Total Monthly Revenue** | | **$2,997.50** |
| | | |
| **Costs** | | |
| Baseline Infrastructure | (Vercel, Supabase, Sentry, etc.) | $195 |
| Payment Processing | (2.9% of Revenue) + ($0.30 × 250 txns) | ~$162 |
| Cloud STT API | 50 users × $0.81/user | ~$40.50 |
| **Total Monthly Cost** | | **~$397.50** |
| | | |
| **Unit Economics** | | |
| **Gross Margin** | ((Revenue - Costs) / Revenue) | **~86.7%** |


## 6. Development Roadmap (High-Level)
This PRD will be implemented in phases, as detailed in the `phased-migration.md` document. The high-level plan is:
1.  **MVP Launch**: Implement the anonymous 2-minute trial, user authentication, free tier limits, and a fully functional Stripe paywall for the Pro and Premium tiers.
2.  **Pro Tier Features**: Build out the advanced analytics dashboard, unlimited history/custom words, and data export functionality.
3.  **Premium Tier Features**: Integrate a cloud STT provider with all necessary privacy safeguards and UI indicators.
4.  **Future Scale**: Explore and implement team/enterprise features and API access.

## 7. Project Structure
- **/src**: Contains all the application source code.
  - **/pages**: Contains the main page components for each route (`MainPage`, `SessionPage`, `AnalyticsPage`).
  - **/components**: Reusable React components (e.g., `AnalyticsDashboard`).
    - **/ui**: UI primitives, often from a component library like Shadcn/UI.
  - **/hooks**: Custom React hooks, such as `useSpeechRecognition.js`.
  - **/lib**: Utility functions.
  - `App.jsx`: The main application component that defines the routes for the application.
  - `main.jsx`: The entry point for the React application.
- `PRD.md`: This document.
- `phased-migration.md`: The technical roadmap and phasing plan.

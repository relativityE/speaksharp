# SayLess AI – Phased Migration Plan to SaaS

## 1. Overview
This document outlines the phased roadmap for transitioning SayLess AI from a client-only web app into a full-stack SaaS platform. The core strategy is to introduce a frictionless **2-minute anonymous trial** to maximize adoption, followed by a required sign-up to unlock further usage and premium features.

The architecture is designed to be **privacy-first**, with all speech processing remaining local unless a user explicitly opts into a premium, cloud-based feature.

## 2. Technology Stack & Cost Projections
This table breaks down the estimated monthly costs for the SaaS infrastructure **once fully launched**.

| Service / Tool | Purpose | Free Tier? | Est. Monthly Cost (Baseline) |
|---|---|---|---|
| **Vercel (Pro Plan)** | Hosting / CDN for Next.js | ✅ | $40 |
| **Supabase Pro** | Auth, Database, API | ✅ | $50 |
| **Sentry** | Error Tracking & Monitoring | ✅ | $25 |
| **PostHog (Paid)** | Product Analytics | ✅ | $45 |
| **Stripe** | Payment Processing | ✅ | $0 base (2.9% + $0.30/txn) |
| **Email Service (Resend)** | Transactional Emails | ✅ | $15 |
| **Cloud STT (e.g., Whisper)** | Premium Speech-to-Text | ❌ | Usage-based ($0.006/min) |
| **Miscellaneous/Buffer** | Domain, backups, etc. | ❌ | $20 |
| **Total Baseline Cost** | *(Excludes payment fees & STT)* | | **~$195/month** |

---

## 3. Phased Development Roadmap

### Phase 0: Current State (Client-Only MVP)
- **Stack**: Vite + React, static hosting.
- **Functionality**: Local speech processing only, no backend or user accounts.
- **Cost**: ~$0

### Phase 1A: Frontend MVP & UI Refresh (Current Task)
The goal of this phase is to build the complete frontend experience for the anonymous free trial, based on a new design reference. This includes a refreshed UI and uses live data from the user's session for the analytics report.
- **User Flow**:
  1. **Anonymous 2-Minute Trial**: Implement the UI and timer for the instant trial. The user can manually start and stop the trial at any time.
  2. **Placeholder Sign-up Gate**: After the session ends (either by timer or manual stop), show a non-functional prompt to "Sign up to save this session and continue."
- **Technical Implementation**:
  - Refresh the UI with a "light sharp theme" with a gradient background and complementary colors, based on the provided reference design.
  - A new `SessionControl` component handles the start/stop logic.
  - The session page is structured with a main "Filler Word Detection" card containing the filler word boxes, and separate cards for other information.
  - An inline form is implemented for adding custom filler words.
  - The Analytics Dashboard is populated with live data from the completed session.
- **Deferred Tasks**: Full authentication and payment integration are deferred to Phase 1B.

### Phase 1B: Backend & Monetization Integration
This phase turns the frontend MVP into a fully functional, monetizable platform.
- **Technical Implementation**:
  - Set up **Supabase** for authentication and database.
  - Implement the full sign-up and login flows.
  - Connect the frontend to the Supabase backend to manage user sessions and data.
  - Implement a fully functional **Stripe paywall** for Pro and Premium tier upgrades.
  - Integrate **Sentry** and **PostHog**.

### Phase 2: Pro Tier Feature Rollout
This phase focuses on building the features that provide the core value for paying Pro users.
- **Functionality**:
  - **Unlimited** local analysis time and session history.
  - **Advanced Analytics Dashboard**: Connect the UI to real user data.
  - **Unlimited Custom Words** and **Data Export**.

### Phase 3: Premium Tier & Cloud STT
This phase introduces high-accuracy, optional features for power users.
- **Functionality**:
  - Integrate a **cloud STT provider** (e.g., Whisper API).
  - Implement the explicit user consent flow and UI indicators for cloud processing.

---

## 4. Financial Projections (Example)
*(This table remains as a projection for the fully launched SaaS model)*

| Tier | Price/Month | Target Users (Year 1) | Monthly Revenue |
|---|---|---|---|
| Free | $0 | 10,000 | $0 |
| Pro | $9.99 | 500 | $4,995 |
| Premium | $19.99 | 100 | $1,999 |
| **Total** | | **10,600** | **$6,994** |
| **Gross Margin** | | | **~92%** |

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
The goal of this phase is to build the complete frontend experience using **mock data and placeholder UI** for backend features. This allows for rapid iteration on the user experience without requiring immediate backend setup or subscriptions.
- **User Flow**:
  1. **Anonymous 2-Minute Trial**: Implement the UI and timer for the instant trial.
  2. **Placeholder Sign-up Gate**: After 2 minutes, show a non-functional prompt to "Sign up to continue."
- **Technical Implementation**:
  - Refresh the UI with a modern, clean color scheme (light theme).
  - Update the main button to "Start 2-Minute Trial".
  - Change the "simulate login" button to "View Analytics" and move its location.
  - The Analytics Dashboard will be updated to show a preview of what Pro/Premium tiers would offer, using mock data.
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

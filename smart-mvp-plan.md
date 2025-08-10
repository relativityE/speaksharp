# The "Smart MVP" Hybrid Development Plan

## 1. Philosophy
This document outlines a hybrid development strategy for SpeakSharp. The goal is to combine the **speed** of a fast MVP launch with the **stability** of a scalable foundation. We will prioritize launching quickly to gather user feedback, but we will use tools that can grow with the product, avoiding "throwaway" work.

**Core Idea**: Launch fast, but build on a foundation that lasts.

---

## 2. The Hybrid Technology Stack
The key to this approach is selecting tools that are free and fast for an MVP, but powerful enough for a full-scale application.

| Component | Technology | Why it's the "Smart" Choice |
|---|---|---|
| **Auth & Database** | **Supabase** | Provides both authentication and a real PostgreSQL database in one free, generous package. This is the most critical choice, as it gives us a scalable database from day one, avoiding the technical debt of `localStorage`. |
| **Payments** | **Stripe Checkout** | The fastest, most secure way to handle subscriptions without needing a complex backend. Users are redirected to a Stripe-hosted page. |
| **Frontend** | **React + Vite** | The existing stack is fast, modern, and perfect for this phase. |
| **Hosting** | **Vercel** | Offers a generous free tier, seamless GitHub integration, and is optimized for modern frontend frameworks. |

---

## 3. Phased Rollout

### Phase 1: The 4-Week MVP Launch
This phase is an aggressive sprint to get a monetizable product into the hands of real users.

*   **Week 1: Foundation & Core Logic**
    *   Set up Supabase project for database and authentication.
    *   Integrate Supabase auth into the React app (sign up, login, logout).
    *   Refactor session management logic to save user data (sessions, custom words) to the Supabase database instead of `localStorage`.
    *   **Goal**: A user can sign in, and their data is saved to a real database.

*   **Week 2: Monetization & Usage Limits**
    *   Set up Stripe account and create two subscription products (Pro & Premium).
    *   Implement usage limits based on the user's subscription status (read from the Supabase user profile).
    *   Build the paywall/upgrade modal in the UI.
    *   **Goal**: The app can distinguish between free and paid users and enforce limits.

*   **Week 3: Payment Flow**
    *   Integrate Stripe Checkout. Clicking "Upgrade" in the paywall redirects the user to a Stripe-hosted payment page.
    *   Create a `success` and `cancel` page for post-payment redirects.
    *   Set up a simple Stripe webhook (using a Supabase Edge Function) to listen for successful payments and update the user's subscription status in the database.
    *   **Goal**: A user can successfully pay and have their account upgraded automatically.

*   **Week 4: Polish & Deploy**
    *   Final testing of the end-to-end user flow.
    *   Set up production environment variables in Vercel.
    *   Deploy to production.
    *   **Goal**: The MVP is live and can accept payments.

### Phase 2: Iterate & Harden (Post-Launch)
With a live product and user feedback, we can now seamlessly transition to building out more advanced features on our stable foundation.

*   **Backend Logic:**
    *   Instead of building a new backend, we can write **Supabase Edge Functions** for any server-side logic needed (e.g., generating PDF reports, integrating third-party APIs).

*   **Advanced Features:**
    *   **Analytics Dashboard:** Since all data is in our PostgreSQL database, we can build rich, insightful analytics dashboards for our users.
    *   **Team Accounts:** The database is ready to be extended with a teams/organizations table.
    *   **Cloud STT:** We can integrate a cloud speech-to-text provider and use our backend to manage API keys and process results securely.

---

## 4. Summary of Tradeoffs

*   ✅ **You Get:**
    *   **Speed to Market:** Launch a feature-complete MVP in approximately 4 weeks.
    *   **No Throwaway Work:** The core of the application (user data, auth) is built on a scalable foundation from day one.
    *   **A Clear Path Forward:** There is a simple, cost-effective path to building out the full-featured product without a painful data migration.

*   ❌ **You Give Up:**
    *   **A Few Days of Speed:** The initial Supabase setup is slightly more involved than a `localStorage`-only approach (perhaps an extra 2-3 days), but this is a tiny price to pay for a much more robust and scalable foundation.

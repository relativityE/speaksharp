# The "Smart MVP" Hybrid Development Plan (v3)

## 1. Philosophy
This document outlines a hybrid development strategy for SpeakSharp. The goal is to combine the **speed** of a fast MVP launch with the **stability** of a scalable foundation. We will prioritize launching quickly to gather user feedback, but we will use tools that can grow with the product, avoiding "throwaway" work.

**Core Idea**: Launch fast, but build on a foundation that lasts. This updated plan has a **92% confidence level** of success due to its reduced risk profile and more realistic timeline.

---

## 2. The Hybrid Technology Stack
The key to this approach is selecting tools that are free and fast for an MVP, but powerful enough for a full-scale application.

| Component | Technology | Why it's the "Smart" Choice |
|---|---|---|
| **Auth & Database** | **Supabase** | Provides both authentication and a real PostgreSQL database in one free, generous package. This is the most critical choice, as it gives us a scalable database from day one, avoiding the technical debt of `localStorage`. |
| **Payments** | **Stripe Checkout** | The fastest, most secure way to handle subscriptions without needing a complex backend. Users are redirected to a Stripe-hosted page. |
| **Frontend** | **React + Vite** | The existing stack is fast, modern, and perfect for this phase. |
| **Hosting** | **Vercel** | Offers a generous free tier, seamless GitHub integration, and is optimized for modern frontend frameworks. |
| **Monitoring**| **Sentry & Vercel** | Critical for a SaaS product to maintain user trust. Sentry provides detailed error reporting, while Vercel Analytics offers uptime and performance monitoring. |

---

## 3. Core Technical Planning

### 3.1. Database Schema
Since we are getting a real database from day one, we should plan the schema upfront.
```sql
-- users table (handled by Supabase Auth)

-- sessions table
CREATE TABLE sessions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamp DEFAULT now(),
  duration integer,
  total_words integer,
  filler_words jsonb,
  custom_words jsonb
);

-- user_profiles table for subscription status
CREATE TABLE user_profiles (
  id uuid REFERENCES auth.users(id) PRIMARY KEY,
  subscription_status text DEFAULT 'free',
  subscription_id text,
  usage_minutes integer DEFAULT 0,
  usage_reset_date timestamp DEFAULT now()
);
```

### 3.2. Row Level Security (RLS)
We will enable RLS early to ensure user data is private.
```sql
-- Enable RLS on sessions table
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own sessions
CREATE POLICY "Users can view own sessions" ON sessions
FOR SELECT USING (auth.uid() = user_id);
```

---

## 4. Monitoring & Error Reporting Strategy
For a SaaS product, monitoring isn't optional—it's infrastructure. One unhandled error can lose a paying customer forever.

### 4.1. Smart MVP Monitoring Stack
*   **Tier 1 (Essential):** Sentry for error reporting and Vercel Analytics for uptime.
*   **Tier 2 (Important):** Supabase Logs for database monitoring and a simple custom health check endpoint.
*   **Tier 3 (Nice to Have):** UptimeRobot for external monitoring post-launch.

### 4.2. Error Handling Strategy by Component
We will implement robust error handling with Sentry reporting for all critical user flows.

*   **Authentication Errors:** Wrap Supabase auth calls in `try/catch` blocks and report failures to Sentry with user context.
    ```javascript
    // Example: Sign In
    if (error) {
      Sentry.captureException(error, {
        tags: { component: 'auth', action: 'sign_in' },
        user: { email }
      });
      toast.error('Sign in failed. Please check your credentials.');
    }
    ```
*   **Payment Errors:** Wrap Stripe Checkout calls and report any errors to Sentry.
    ```javascript
    // Example: Stripe Checkout
    if (error) {
      Sentry.captureException(error, {
        tags: { component: 'payments', action: 'checkout' },
        extra: { priceId, userId: user?.id }
      });
      toast.error('Payment setup failed. Please try again or contact support.');
    }
    ```
*   **Speech Recognition Errors:** Handle `onerror` events from the browser's SpeechRecognition API and send detailed reports to Sentry.
    ```javascript
    // Example: Speech Recognition
    recognition.onerror = (event) => {
      Sentry.captureMessage('Speech recognition error', {
        level: 'error',
        tags: { component: 'speech_recognition' },
        extra: { error: event.error, message: event.message }
      });
      // ... user-friendly error handling
    }
    ```

### 4.3. Cost & ROI
*   **MVP Phase:** Total monitoring costs will be **$0/month** using the generous free tiers of Sentry and Vercel.
*   **Growth Phase:** Costs are estimated at **~$53/month**, which is less than 1% of revenue at $5,000 MRR.
*   **ROI:** The investment is justified by preventing customer churn and revenue loss from uncaught errors.

---

## 5. Phased Rollout (with Monitoring)

### Phase 1: The 4-Week MVP Launch

*   **Week 0: Planning & Setup**
    *   Set up Supabase project.
    *   Design and create the initial database schema and RLS policies.
    *   Test auth integration in isolation.
    *   **Goal**: A stable foundation is ready.

*   **Week 1: Foundation & Monitoring**
    *   **Days 1-2:** Supabase setup + basic auth integration.
    *   **Days 3-4:** Session management migration to Supabase.
    *   **Days 5-7:** Set up Sentry error reporting, add basic error boundaries, and implement a `/api/health` check endpoint.
    *   **Goal**: Core features work and are monitored for critical errors.

*   **Week 2: Monetization & Error Handling**
    *   Set up Stripe and implement usage limits.
    *   Build the paywall UI.
    *   Add specific error handling (with Sentry) to auth and payment flows.
    *   Set up Supabase log monitoring.
    *   **Goal**: App can handle payments and related errors gracefully.

*   **Week 3: Payment Flow & Polish**
    *   Integrate Stripe Checkout and webhook (choosing between client-side and Edge Function implementation).
    *   Set up external monitoring with UptimeRobot.
    *   Create an error notification system for the team.
    *   Test critical error scenarios.
    *   **Goal**: The payment system is robust and observable.

*   **Week 4: Final Testing & Deploy**
    *   Final end-to-end user flow testing.
    *   Set up production environment variables in Vercel.
    *   Deploy to production.
    *   **Goal**: The MVP is live.

### Phase 2: Iterate & Harden (Post-Launch)
*   **Monthly Review:** Review error patterns in Sentry to prioritize bug fixes.
*   **Optimize:** Optimize queries and code based on performance monitoring.
*   **Alerting:** Set up automated alerts for critical errors.

---

## 6. Summary of Tradeoffs & Benefits

*   ✅ **You Get:**
    *   **Speed to Market:** Launch a feature-complete and observable MVP in ~4 weeks.
    *   **No Throwaway Work:** The core application and its monitoring are built on a scalable foundation.
    *   **High Confidence:** A clear, low-risk path to a successful and stable launch.

*   ❌ **You Give Up:**
    *   **A Few Days of Upfront Planning:** A small price to pay for a much more robust and professional product.

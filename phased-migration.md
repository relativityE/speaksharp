# SayLess AI – Phased Migration Plan to SaaS

## Overview
This roadmap transitions SayLess AI from a **client-only, static web app** into a **full SaaS platform** with:
- Authentication
- Subscription billing
- Persistent user settings
- Optional AI-powered features
- Privacy-first architecture (speech processing remains local unless explicitly enabled)

Baseline SaaS costs are modeled at **$250/month** (infra, tools, hosting, auth, etc.)
AI STT usage is based on a **generous Toastmasters-style assumption**: multiple recordings adding up to **45 minutes per session**, **3 sessions per month** per user.

---

## Monthly Subscription Cost Breakdown (SaaS Stack)

| Service / Tool | Purpose | Free Tier? | Est. Monthly Cost |
|----------------|---------|------------|-------------------|
| **Vercel (Pro Plan)** | Hosting / CDN for Next.js | ✅ | $40 |
| **Supabase Pro** | Auth + DB + API | ✅ | $50 |
| **PostHog (Paid)** | Product analytics & error tracking | ✅ | $45 |
| **Stripe** | Payments | ✅ | $0 base (2.9% + $0.30 per txn) |
| **Email Service (Resend/Postmark)** | Transactional email | ❌ | $15 |
| **AI STT (Whisper API)** | Speech-to-text | ❌ | $0.006/min × usage |
| **Miscellaneous/Buffer** | Domain, backups, monitoring | ❌ | $20 |

**Baseline SaaS Infra Cost (no AI STT)**: ~$170/month

---

## Phase 0 – Current State (Client-Only MVP)
**Stack**:
- Vite + React (frontend only)
- Local speech processing
- Static hosting on Netlify/Vercel free tier
- No backend, no user accounts

**Monthly Cost**: ~$0–$20
**Revenue**: $0
**Profit Margin**: **N/A**

---

## Phase 1 – SaaS MVP Launch
This phase combines the initial technical setup, authentication, and payment integration into a single launch. The goal is to release a complete, monetizable product that offers a clear value proposition from day one.

**Features**:
- User authentication (email, social login)
- Session history and user preferences saved to a database
- Subscription management via Stripe
- Logging and error tracking
- A compelling free tier to drive user acquisition

**Monthly Cost**: ~$170
**Revenue (150 paid users × $10)**: $1,500
**Profit Margin**: **88%**

---

## Phase 2 – AI STT Integration for Premium Features
**Usage Model**:
- **3 sessions/month per user**
- **45 mins/session**
- **135 mins/month/user**
- Whisper API at **$0.006/min**
- STT cost per user = **$0.81/month**
- At **250 active paid users** → **$202.50/month** in STT costs

**Monthly Cost**:
- Baseline SaaS infra/tools: **$170**
- AI STT usage: **$202.50**
- **Total**: **$372.50**

**Revenue (250 paid users × $10)**: $2,500
**Profit Margin**: **85%**

---

## Phase 3 – Scale & Optimize
**Example Projection at 250 Paid Users (Optimized)**:
- Revenue: $2,500
- Costs (optimized infra & AI): ~$350
- Profit Margin: **86%**

---

## Cost & Margin Projection

| Metric | Value |
|--------|-------|
| Max Paid Users | 250 |
| Price per User / Month | $10 |
| Monthly Revenue (Max) | $2,500 |
| Baseline SaaS Infra Cost | $170 |
| AI STT Cost (Max Usage) | $202.50 |
| Total Monthly Cost | $372.50 |
| Gross Margin | 85% |

---

## Privacy-First Commitments
- All speech/audio processing **remains local** unless a user explicitly opts into a cloud-based feature.
- Raw audio recordings are **never** stored on the server. They are processed in real-time and discarded immediately. Users will have the option to download their own audio at the end of a session.
- Logs redact sensitive info before storage.
- Minimal metadata (transcript text, filler word counts) is stored in Supabase for Pro users to enable session history.

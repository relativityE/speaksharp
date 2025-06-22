# SpeakSharp Product Requirements Document
**Version 6.11** | **Last Updated: August 12, 2025**

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

### Core Technologies
```
Frontend        → React + Vite
Styling         → Tailwind CSS + shadcn/ui  
Auth/Database   → Supabase
Speech API      → Web Speech API (MVP) + Whisper API (Pro)
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

## 🗓️ Development Roadmap

### PHASE 1 — MVP (Weeks 1-3)

```
┌─────────────┬──────────────────────────────┬─────────────────────────────────┐
│    WEEK     │          ENGINEERING         │       MARKETING & GROWTH        │
├─────────────┼──────────────────────────────┼─────────────────────────────────┤
│   Week 1    │ ✅ Finalize filler detection  │ • Launch email capture page    │
│             │ ✅ Supabase auth & limits     │ • Begin Reddit engagement      │
│             │ ⏳ Stripe payments            │                                │
│             │ ⏳ PostHog setup (KPI + A/B)  │                                │
├─────────────┼───────────────────────────────┼────────────────────────────────┤
│   Week 2    │ ✅ Landing page w/ real UX    │ • Publish 1 SEO article        │
│             │ ⏳ Sentry error logging       │ • Social handles + demo video  │
├─────────────┼───────────────────────────────┼────────────────────────────────┤
│   Week 3    │ ✅ QA & performance tuning    │ • Publish 2nd SEO article      │
│             │ • Launch MVP                  │ • Announce beta on Reddit      │
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
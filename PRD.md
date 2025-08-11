# SpeakSharp Product Requirements Document (PRD)

**Version**: 4.2
**Last Updated**: 2025-08-11

## 1. Executive Summary

### 1.1. Product Vision
SpeakSharp is a privacy-first, real-time speech analysis tool designed to empower users to become more confident and articulate speakers. By providing immediate, on-device feedback on filler word usage, speaking pace, and other key metrics, we help users practice and improve their communication skills in a safe and private environment.

### 1.2. Business Value & Core Proposition
Our core value is delivering a frictionless user experience that provides an instant "aha!" moment, converting casual users into long-term, paying customers. We will lead with a clear, outcome-driven message: **"Reduce your filler words by 50% in 30 days."** Our privacy-first architecture is a key differentiator in a market concerned with data security.

### 1.3. Go-to-Market Strategy
Our strategy focuses on capturing a wide user base through a compelling free tier and converting them to paid plans.
- **Initial Launch**: Target young professionals, students, and non-native English speakers through content marketing (blog posts, social media) and partnerships with educational institutions and career coaches.
- **Growth Phase**: Use social proof (testimonials, usage stats) on the landing page to build credibility. A/B test pricing and feature tiers to optimize conversion.
- **Marketing KPIs**:
    - **Homepage to Signup Conversion**: Target 15%+
    - **Session Completion Rate**: Target 80%+
    - **Mobile Bounce Rate**: Target <40%
    - **Time to First Successful Session**: Target <2 minutes

## 2. User Tiers & Pricing Model

| Tier | Price/Month | Key Features | Target User |
|---|---|---|---|
| **Free** | $0 | 2-minute trial session, 5 mins/month with account, last 3 sessions saved, 10 custom words. | Casual users, students |
| **Pro** | $5.99 | Unlimited practice time, full session history, unlimited custom words, advanced analytics. | Engaged individuals, professionals |
| **Premium** | $9.99 | All Pro features, plus high-accuracy cloud transcription (optional), PDF reports. | Power users, executives, coaches |

## 3. Financial Projections (Hypothetical)

This is a simplified model assuming 10,000 Monthly Active Users (MAU).

### 3.1. Assumptions
- **Conversion Rate**: 5% of MAU convert to a paid plan.
- **Tier Split**: 80% of paid users choose Pro, 20% choose Premium.
- **Monthly Costs**: ~$100 (Vercel, Supabase, Sentry, Resend at scale).

### 3.2. Revenue Calculation
- **Total Paid Users**: 10,000 MAU * 5% = 500 users
- **Pro Users**: 500 * 80% = 400 users
- **Premium Users**: 500 * 20% = 100 users
- **Monthly Revenue**: (400 * $5.99) + (100 * $9.99) = $2,396 + $999 = **$3,395**

### 3.3. Profit Margin
- **Gross Profit**: $3,395 (Revenue) - $100 (Costs) = $3,295
- **Profit Margin**: ($3,295 / $3,395) * 100 = **~97%**

## 4. Feature Checklist & Implementation Status

### 4.1. Core Functionality
- [x] Real-time speech analysis (on-device).
- [x] Filler word and custom word detection.
- [x] User authentication via Supabase.
- [x] Session history storage for registered users.

### 4.2. Design & UX Improvements
- [x] Increase base font size for readability.
- [x] Implement consistent button styles from the design system.
- [x] Implement a new, high-contrast color palette.
- [x] Optimize transcript panel to reduce lag.
- [x] Add loading indicators for speech processing.
- [x] Redesign landing page with a single CTA and social proof.
- [x] Relocate browser warning to a less intrusive location.
- [x] Add "Home" and "View Analytics" links to the header for improved navigation.
- [x] Add "Completed" status indicators to the session history.

### 4.3. Future Work (Post-MVP)
- [ ] **Color-Coded Confidence Levels**: Investigate and implement color-coding for filler word detection based on the speech recognition confidence score. (Note: Feasible but requires significant refactoring).
- [ ] **Offline Mode**: Implement full offline capabilities with clear indicators.
- [ ] **User Testimonials**: Replace placeholder testimonials on the landing page with real user stories and photos.

## 5. Technical Architecture
The core architecture remains as planned in `smart-mvp-plan.md`, utilizing React, Vite, Supabase, and Stripe for a scalable and maintainable application.

## Appendix A: Core Design System

### Color Palette
| Role | Color | Hex Code |
|---|---|---|
| **Primary Action** | Green | `#10B981` |
| **Primary Brand** | Purple | `#8B5CF6` |
| **Background** | Dark Blue/Purple | `#0D0C1D` |
| **Component BG** | Lighter Dark | `#1A192D` |
| **Border** | Subtle Dark | `#2A293D` |
| **Text (Headlines)**| White | `#FFFFFF` |
| **Text (Body)** | Light Gray | `#A0A0B0` |
| **Destructive** | Red | `#EF4444` |

### Typography
*   **Font Family**: **Inter**, with a fallback to `sans-serif`.
*   **Base Font Size**: 16px.
*   **Link & Button Font Size**: 16px.
*   **Tagline Font Size**: 20px.

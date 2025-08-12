# SpeakSharp Product Requirements Document (PRD)

**Version**: 5.0
**Last Updated**: 2025-08-11

## 1. Executive Summary

### 1.1. Product Vision
SpeakSharp is a privacy-first, real-time speech analysis tool designed to empower users to become more confident and articulate speakers. By providing immediate, on-device feedback on filler word usage and speaking pace, we help users practice and improve their communication skills in a safe and private environment.

### 1.2. Business Value & Go-to-Market Strategy
Our core value is delivering a frictionless user experience that provides an instant "aha!" moment, driving conversion from a generous free tier to affordable paid plans. Our privacy-first architecture is a key differentiator.

**Go-to-Market Strategy:**
- **Initial User Acquisition**: Target young professionals, students, and non-native English speakers via content marketing (blogs, social media) and partnerships with educational institutions and career coaches.
- **Growth Phase**: Use social proof (testimonials, usage stats) on the landing page to build credibility.
- **Marketing KPIs**:
    - Homepage to Signup Conversion: Target 15%+
    - Session Completion Rate: Target 80%+
    - Mobile Bounce Rate: Target <40%

## 2. User Tiers & Pricing Model

| Tier | Price/Month | Key Features | Target User |
|---|---|---|---|
| **Free** | $0 | 2-minute trial session, 5 mins/month with account, last 3 sessions saved, 10 custom words. | Casual users, students |
| **Pro** | $5.99 | Unlimited practice time, full session history, unlimited custom words, advanced analytics. | Engaged individuals, professionals |
| **Premium** | $9.99 | All Pro features, plus high-accuracy cloud transcription (optional), PDF reports. | Power users, executives, coaches |

## 3. Financial Projections (Hypothetical)
This is a simplified model based on a conservative user growth ramp-up.

### 3.1. Assumptions
- **Conversion Rate (MAU to Paid)**: 5%
- **Paid Tier Split**: 80% Pro / 20% Premium
- **Fixed Monthly Costs**: ~$100 (Vercel, Supabase, Sentry, Resend at scale)

### 3.2. Projections
| Metric | Month 1 | Month 3 | Month 6 |
|---|---|---|---|
| **MAU** | 100 | 1,000 | 2,500 |
| **Paid Users** | 5 | 50 | 125 |
| **Monthly Revenue** | $33.95 | $339.50 | $848.75 |
| **Monthly Profit** | -$66.05 | $239.50 | $748.75 |
| **Profit Margin** | -195% | 70.5% | 88.2% |

## 4. Implementation Status & Roadmap

### 4.1. Completed Work
- [x] **Critical Bug Fix**: Corrected detection logic for 'Uh', 'Ah', and 'Oh' filler words.
- [x] **Core UI Polish**: Replaced the header text link with a home icon, fixed systemic font size issues in UI components, and improved the primary theme color for sharper contrast.
- [x] **New Design System**: Implemented a new, high-contrast color palette and increased base font sizes for improved readability.
- [x] **Component Styling**: Standardized button and card styles.
- [x] **Landing Page Overhaul**: Redesigned the hero and value proposition sections to focus on outcomes and social proof.
- [x] **Improved Navigation**: Added "Home" and "View Analytics" links to the main header.
- [x] **UX Enhancements**: Added loading indicators for session processing and "Completed" status badges in the session history.
- [x] **Performance Optimization**: Fixed a rendering issue that caused the live transcript to lag.
- [x] **File Cleanup**: Removed temporary log files and consolidated documentation.

### 4.2. Future Work (Backlog)
- [ ] **Implement Free Tier Limitations**: Track user's monthly usage to enforce the 5-minute cap for free accounts as a prerequisite for monetization.
- [ ] **Color-Coded Confidence Levels**: Investigate and implement color-coding for filler word detection based on speech recognition confidence scores. (Note: Feasible but requires significant refactoring).
- [ ] **Offline Mode**: Implement full offline capabilities with clear indicators for users on unstable connections.
- [ ] **User Testimonials**: Replace placeholder testimonials on the landing page with real user stories and photos.

## Appendix A: Core Design System

#### Color Palette
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

#### Typography
*   **Font Family**: **Inter**, with a fallback to `sans-serif`.
*   **Base Font Size**: 16px.
*   **Link & Button Font Size**: 16px.
*   **Tagline Font Size**: 20px.

# SpeakSharp - Product Requirements Document (PRD)

**Version**: 4.0
**Last Updated**: 2025-08-10

## 1. Executive Summary
SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users improve their communication skills. The product processes speech locally in the browser, ensuring user privacy.

**Core Value Proposition**: Immediate, private feedback on filler word usage to improve verbal clarity, with a frictionless entry point and a clear path to powerful premium features.
**Guiding Philosophy**: This PRD follows a **"Smart MVP"** model. The primary goal is to launch a professional and trustworthy product quickly, building on a stable and scalable foundation from day one.

## 2. User Flow & Tiers (MVP)

### Anonymous Free Trial
- **Goal**: Maximize user adoption and deliver an instant "aha!" moment with zero friction.
- **Flow**: User can immediately start a **2-minute trial session** without an account.

### Free Tier (Account Required via Supabase)
- **Goal**: Convert trial users into registered users.
- **Includes**:
  - **5 minutes/month** of local analysis time.
  - Storage for the **last 3 sessions**.
  - Up to **10 custom filler words**.

### Pro Tier ($9.99/month)
- **Goal**: Monetize engaged individuals.
- **Includes**: Everything in Free, plus **unlimited** practice time, custom words, session history, and advanced analytics.

### Premium Tier ($19.99/month)
- **Goal**: Serve power users and professionals.
- **Includes**: Everything in Pro, plus **high-accuracy cloud transcription** (optional) and detailed PDF reports.

## 3. Proposed Architecture (MVP)
The MVP stack is chosen for a balance of speed, low initial cost, and long-term scalability.

| Component | Tech Stack | Purpose |
|---|---|---|
| Frontend | **React + Vite** (on Vercel) | Fast, modern, and cheap to host. |
| Auth & Database | **Supabase** | Handles user auth, database, and serverless functions. |
| Payment Processing | **Stripe Checkout & Portal** | Easiest way to implement and manage subscriptions. |
| Monitoring | **Sentry & Vercel Analytics** | Essential for proactive error tracking and performance monitoring. |
| Transactional Email | **Resend** | Reliable email delivery for password resets and notifications. |

## 4. Privacy & Security Requirements
- **No storage of audio or transcripts** without explicit user consent.
- Only filler word counts and analysis data are stored for registered users.
- **Row Level Security (RLS)** will be enabled in Supabase to ensure users can only access their own data.
- All API requests must be validated.
- **Legal documents** (Privacy Policy, ToS) must be in place before launch.

## 5. Cost Breakdown (MVP)
| Service | Free Tier | Cost at Scale |
|---|---|---|
| **Vercel** | 100GB bandwidth | $20/month |
| **Supabase** | 50K MAU, 500MB DB | $25/month |
| **Stripe** | No monthly fee | 2.9% + $0.30/txn |
| **Sentry** | 5,000 errors/mo | $26/month |
| **Resend** | 3,000 emails/mo | $20/month |
| **Legal Templates** | N/A | ~$200 (one-time) |
| **Total** | **$0/month** | **~$91/month** |

## 6. Development Roadmap (4-Week MVP)
The development will follow a 4-week timeline to launch a professional and monetizable MVP. The detailed technical plan is available in `smart-mvp-plan.md`.

- **Week 0-1: Foundation & Legal:** Set up Supabase, integrate auth, create legal documents, and configure data backups.
- **Week 2: Core Features & Email:** Implement usage limits, build the paywall, and set up transactional emails with Resend.
- **Week 3: Payments & Support:** Integrate Stripe Checkout and the Customer Portal, set up Sentry monitoring, and build a support contact system.
- **Week 4: Polish & Launch:** Conduct final end-to-end testing, deploy to production, and monitor the first users.

## 7. Pre-Launch Success Checklist
Before launch, we must be able to answer "Yes" to all of the following:
- [ ] Can a user sign up and immediately start using the product?
- [ ] Can a user upgrade to Pro and have it work instantly?
- [ ] Can a user cancel their subscription without contacting support?
- [ ] If something breaks, will the team be notified within 30 minutes?
- [ ] If a user emails support, will the team receive it?
- [ ] Are we legally compliant to collect payments and user data?
- [ ] If the database disappeared, could we recover user data?

## 8. Risk Mitigation

### **Technical Risks:**
1. **Supabase integration issues** → Mitigation: Isolate and test auth and database connections in Week 0.
2. **Payment failures** → Mitigation: Thoroughly test with Stripe's test mode before launch.
3. **Email deliverability** → Mitigation: Use a reputable service like Resend and test all transactional emails.

### **Business Risks:**
1. **No user interest** → Mitigation: Offer a compelling free tier to attract users and gather feedback.
2. **Price resistance** → Mitigation: Be prepared to A/B test pricing post-launch.
3. **Competition** → Mitigation: Emphasize the privacy-first angle and superior user experience.

## 9. Project Structure
- **/src**: Contains all the application source code.
- `PRD.md`: This document.
- `smart-mvp-plan.md`: The detailed technical roadmap for the Smart MVP.

## 10. User Feedback & Design Improvements

This section captures feedback from user testing and design reviews.

### General Design System
- **Typography**: Increase base font size across the application for better readability.
- **Buttons**: Ensure all buttons are consistent in size, style, and state (hover, active, disabled).
- **Color Palette**: Adjust the background theme to a color with sharper contrast for improved accessibility and visual appeal.
- **Mobile-First**: Prioritize mobile-first design principles in all future development.

### UI/UX & Interaction
- **Error Handling**: Implement robust error handling for all user flows.
- **Offline Mode**:
    - Clearly indicate when the application is operating in an offline mode.
    - Implement graceful degradation for users on slow or unstable network connections.
- **Loading States**: Add loading indicators during speech processing and other asynchronous operations to provide feedback to the user.

### Performance
- **Transcript Rendering**: Optimize the transcript component to prevent re-rendering on every word, which causes UI lag.

### Page-Specific Feedback

#### Landing Page
- **Hero Section**:
    - Feature a single, prominent Call-to-Action (CTA) button: "Try Free Session".
    - Relocate the browser compatibility warning to a less intrusive area, such as a settings or help section.
- **Navigation**: Ensure a clear navigation path from the landing page to the Analysis page.

#### Analysis Page
- **Navigation**: Add a clear link or button to return to the Home page.
- **Data Visualization**:
    - Use color-coding to indicate confidence levels for filler word detection.
    - Display clear status indicators for the current session (e.g., "Processing", "Complete").
    - Replace or augment word frequency data with a horizontal bar chart that includes numerical counts.

#### Sessions Page
- **Navigation**: Add a clear link or button to return to the Home page.

## 11. Success Metrics & KPIs

### Key Performance Indicators (KPIs)
- **Homepage to Signup Conversion Rate**: Target **15%** or higher.
- **Session Completion Rate**: Target **80%** or higher for users who start a session.
- **Mobile Bounce Rate**: Target below **40%**.
- **Time to First Successful Session**: Target under **2 minutes** from the first visit.

### Marketing & Copywriting
- **Lead with Outcome**: Frame the value proposition around user outcomes (e.g., "Reduce your filler words by 50% in 30 days").
- **Social Proof**:
    - Add real user testimonials, complete with photos.
    - Include usage statistics like "10,000+ sessions completed".
    - Create urgency and build community with messages like "Join 500+ professionals improving daily".
- **Value Proposition Simplification**:
    - Replace the three value proposition cards with a single, clear benefit statement.
    - Enhance credibility with statements like "Used by 1000+ professionals".

## 12. Implementation Notes

This section documents key decisions and clarifications made during the implementation of the design feedback from Section 10.

-   **Button Styles**: The `default` button variant has been updated to be the green "Primary Action" button, as specified in the `DESIGN_SYSTEM.md`. A new `brand` variant was created to house the previous purple style for use in non-primary actions.

-   **Browser Warning**: The browser compatibility warning was relocated to a new section just above the footer on the main page. A dedicated settings/help page was deemed out of scope for the current work, and this placement makes the warning accessible without cluttering the main hero section.

-   **Landing Page Content**: The three feature cards on the landing page have been replaced with a new social proof section. This section includes placeholder testimonials that should be replaced with real user content.

-   **Confidence Levels**: An investigation into implementing color-coded confidence levels for filler words was completed. The feature is technically feasible via the Web Speech API's `confidence` property. However, the implementation requires a significant refactoring of the `useSpeechRecognition` hook and its dependent components. This feature has been deferred for future consideration due to its complexity.

-   **Session Transcript Storage**: The investigation also confirmed that, in line with the privacy requirements, the full session transcript is not saved to the database.

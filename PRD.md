# SayLess AI - Product Requirements Document (PRD)

**Version**: 1.5

## 1. Executive Summary
This document outlines the requirements for transforming SayLess AI from a client-side tool into a full-stack SaaS platform. The goal is to introduce user accounts, subscription billing, and premium features while maintaining the core value proposition of a privacy-first, real-time speech analysis tool.

## 2. Known Issues
- The real-time detection for common filler words like "uh" and "um" can be inconsistent, requiring improvements to the detection logic.

## 3. Proposed Architecture
A brief overview of the technology stack chosen to build the SaaS platform.

- **Frontend Framework**: Next.js 15 with App Router
  - **Why**: To enable server-side logic and API routes, which are essential for a scalable SaaS product.
- **Authentication & Database**: Supabase (Auth & PostgreSQL)
  - **Why**: To accelerate development with a managed, all-in-one backend for user accounts and data storage.
- **Payment Processing**: Stripe
  - **Why**: To securely handle payments and subscriptions, forming the core of the business model.
- **Bug Reporting & Monitoring**: PostHog
  - **Why**: To consolidate product analytics and error tracking into a single platform for a holistic view of app health.

## 4. Phased Rollout & Feature Tiers
This section outlines the features to be built and how they will be bundled into different subscription tiers.

### Free Tier
**Goal**: User acquisition and product validation.
- **Feature**: **Real-time Filler Word Detection**
  - **Description**: The core real-time analysis engine.
  - **Why**: To provide immediate value and showcase the product's primary functionality.
- **Feature**: **30 Minutes of Analysis per Month**
  - **Description**: A monthly quota for free analysis time.
  - **Why**: To allow users to experience the product's value without initial cost, encouraging adoption.
- **Feature**: **Save Last 3 Sessions**
  - **Description**: A limited session history for users to review recent performance.
  - **Why**: To give users a taste of the value of tracking progress over time, creating an incentive to upgrade.
- **Feature**: **1 Custom Filler Word**
  - **Description**: The ability to track one user-defined word or phrase.
  - **Why**: To offer a degree of personalization and demonstrate the power of the custom word feature.

### Pro Tier ($9.99/month)
**Goal**: Primary revenue driver for engaged users.
- **Includes**: Everything in the Free Tier, plus:
- **Feature**: **Unlimited Analysis & Session History**
  - **Description**: No limits on analysis time or the number of saved sessions.
  - **Why**: This is the core value proposition for serious users who want to track their progress long-term.
- **Feature**: **Advanced Analytics Dashboard**
  - **Description**: A dashboard to visualize progress and trends over time.
  - **Why**: To provide users with actionable insights and a clear, visual representation of their improvement.
- **Feature**: **Unlimited Custom Filler Words**
  - **Description**: The ability to track an unlimited number of custom words.
  - **Why**: To provide a fully personalized experience for users with specific needs.
- **Feature**: **Data Export**
  - **Description**: The ability to export transcripts and reports as PDF or CSV.
  - **Why**: To allow users to own their data and use it in other contexts (e.g., reports, coaching).

### Premium Tier ($19.99/month)
**Goal**: For power users, professionals, and future B2B offerings.
- **Includes**: Everything in the Pro Tier, plus:
- **Feature**: **Cloud-Powered STT**
  - **Description**: An optional, high-accuracy transcription service (e.g., Whisper).
  - **Why**: To provide a premium, high-accuracy alternative for users in noisy environments or those who need the best possible transcription.
- **Feature**: **Team Collaboration & API Access** (Future)
  - **Description**: Features for teams to share analytics and for developers to integrate with other tools.
  - **Why**: To expand the product's market to include business and power users, creating new revenue opportunities.

## 5. Design & UX Requirements
- **UI Refresh**: The application will be updated with a modern, clean, and crisp color palette.
- **Data Privacy**: The UI must be exceptionally clear about what data is being stored and when processing is happening locally versus in the cloud. User control and transparency are paramount.

## 6. Security Considerations
- All API inputs must be validated.
- Use secure, HTTP-only cookies for session management.
- Implement CSRF protection and rate limiting.
- Leverage Supabase Row Level Security for data access control.
- Never store raw audio recordings on the server.

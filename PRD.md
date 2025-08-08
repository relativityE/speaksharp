# SayLess AI - Product Requirements Document (PRD)

**Version**: 1.4

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

## 4. Feature Requirements

### Phase 1: Foundation & SaaS MVP Launch

#### 4.1. Next.js Migration
- **Description**: Migrate the existing Vite/React frontend to a Next.js 15 application.
- **Why**: This is the foundational step to enable server-side logic and a scalable structure.

#### 4.2. Database & Authentication Setup
- **Description**: Design the database schema and configure Supabase for user management.
- **Why**: To create a structured and scalable foundation for all user-related data.

#### 4.3. Authentication Flow
- **Description**: Implement all UI and logic for user sign-up, login, and account management.
- **Why**: To allow users to securely create accounts, a prerequisite for any personalized or paid features.

#### 4.4. Subscription Management
- **Description**: Integrate Stripe to handle payments and manage user subscriptions.
- **Why**: To enable the application's business model by allowing users to purchase premium plans.

### Phase 2: Core User Experience

#### 4.5. Session Management
- **Description**: Allow users to save their practice sessions to the database and view them in a history list.
- **Why**: To provide the core value of tracking progress, letting users review and learn from past sessions.

#### 4.6. Analytics Dashboard
- **Description**: Create a dashboard to visualize user progress and trends over time.
- **Why**: To provide users with actionable insights and a clear, visual representation of their improvement.

### Phase 3: Premium & Advanced Features

#### 4.7. Custom Filler Words
- **Description**: Allow users to define their own custom words or phrases to track.
- **Why**: To offer a personalized experience that caters to individual user needs and speaking habits.

#### 4.8. Cloud-Powered STT (Premium Feature)
- **Description**: Integrate a third-party STT service (e.g., Whisper) to offer higher accuracy transcription as an opt-in feature.
- **Why**: To provide a premium, high-accuracy alternative for users who need it, creating a compelling reason to upgrade.

## 5. Pricing Tiers

- **Free Tier**:
  - **Goal**: User acquisition and product validation.
  - **Features**: 30 minutes of analysis/month, save last 3 sessions, full real-time detection, 1 custom filler word.
- **Pro Tier ($9.99/month)**:
  - **Goal**: Primary revenue driver.
  - **Features**: Unlimited analysis & history, advanced analytics, data export, unlimited custom words.
- **Premium Tier ($19.99/month)**:
  - **Goal**: Power user and B2B upsell.
  - **Features**: Everything in Pro, plus optional Cloud-Powered STT, team features, and API access.

## 6. Design & UX Requirements

- **UI Refresh**: The application will be updated with a modern, clean, and crisp color palette.
- **Data Privacy**: The UI must be exceptionally clear about what data is being stored and when processing is happening locally versus in the cloud. User control and transparency are paramount.

## 7. Security Considerations
- All API inputs must be validated.
- Use secure, HTTP-only cookies for session management.
- Implement CSRF protection and rate limiting.
- Leverage Supabase Row Level Security for data access control.
- Never store raw audio recordings on the server.

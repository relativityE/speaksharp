# SpeakSharp

A real-time speech analysis tool built on two pillars: speed and privacy. Our "privacy by design" approach means we never store your audio. We provide a local-first transcription experience for free, with premium cloud-based features for Pro users. Our goal is to help you speak more confidently without compromising your privacy.

## Features

- **Real-time Filler Word Detection**: Counts common filler words (e.g., "um", "like") in real-time.
- **On-Device Transcription (Free Tier)**: Your speech is processed locally on your device using Transformers.js, ensuring your privacy.
- **High-Accuracy Cloud Transcription (Pro Tier)**: Pro users can opt-in to use a premium cloud-based engine for even higher accuracy.
- **Comprehensive Analytics**: Free users can track their progress with trend dashboards, while Pro users unlock deep per-session analytics and history.
- **Custom Filler Words**: Track your own unique filler words. (Limited in Free tier, unlimited for Pro).
- **PDF Export (Pro Feature)**: Pro users can download detailed PDF reports of their sessions.
- **Modern UI**: A clean, responsive interface with a new "Midnight Blue & Electric Lime" theme.

## Technology Stack

- **Frontend**: React (with [Vite](https://vitejs.dev/))
- **Styling**: Tailwind CSS & shadcn/ui
- **Testing**: Vitest & Playwright
- **Backend & Database**: Supabase
- **Speech Processing**:
    - **On-Device (Default)**: Transformers.js for private, in-browser transcription.
    - **Cloud-Based (Pro Option)**: AssemblyAI for premium, high-accuracy transcription.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v10.4.1 or higher)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    cd speaksharp
    ```

2.  Install dependencies:
    ```bash
    pnpm install
    ```

3.  Set up your environment variables.
    Create a file named `.env.local` in the root of the project. This file is ignored by git and is where you will store your secret keys. Add the following variables:

    ```
    # Supabase
    VITE_SUPABASE_URL=your_supabase_project_url_here
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

    # (Optional) Developer Mode Universal Bypass
    # Set this to true to bypass all authentication and usage checks in Supabase functions.
    # This should ONLY be used for local testing.
    SUPER_DEV_MODE=true

    # Sentry
    VITE_SENTRY_DSN=your_sentry_dsn_here

    # PostHog
    VITE_POSTHOG_KEY=your_posthog_project_api_key_here
    VITE_POSTHOG_HOST=your_posthog_api_host_here

    # Stripe
    VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here
    VITE_STRIPE_SECRET_KEY=your_stripe_secret_key_here
    VITE_STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here

    # (Optional) Developer Mode Universal Bypass
    # Set this to true to bypass all authentication and usage checks in Supabase functions.
    # This should ONLY be used for local testing.
    SUPER_DEV_MODE=true
    ```

    **Note on Environment Variables:** In Vite-based projects, it is standard practice to prefix all client-side environment variables with `VITE_`. This is a security measure to prevent accidental exposure of sensitive keys to the browser. Any variable without this prefix will not be accessible in the application's frontend code. For more details, see the official [Vite documentation](https://vitejs.dev/guide/env-and-mode.html).

    **Developer Mode for Cloud Transcription:**
    To simplify testing, you can enable a universal developer mode. Set `SUPER_DEV_MODE=true` in your `.env.local` file and also set it as a secret in your Supabase project. When this variable is detected, all backend functions will bypass authentication and usage limit checks, allowing you to test premium features freely.

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Known Issues

The development team is currently undertaking a focused effort (Phase 1) to launch a stable MVP. The following issues are known and are the primary targets of the current work:

*   **Unreliable Transcription Modes:** The application's core transcription services are unstable. The "Local Mode" is non-functional, and the "Native Browser" fallback is unreliable. The MVP plan is to deliver a single, high-quality "Cloud Mode" with a reliable native fallback.
*   **Broken Developer Workflow:** The process for developers to test premium features is broken and insecure. This is being replaced with a simple, environment-based bypass.
*   **Missing User Feedback:** The application lacks a global notification system, meaning errors often happen silently. This will be fixed by implementing a global toast notification system.

## Production Ready Checklist
*****************************************************************
*                                                               *
*   DANGEROUS!  ALERT!  DANGEROUS!  ALERT!  DANGEROUS!  ALERT!   *
*                                                               *
*   The following keys MUST be rolled before any production     *
*   deployment. These are development keys and should not be    *
*   used in a live environment.                                 *
*                                                               *
*   - VITE_SUPABASE_URL                                         *
*   - VITE_SUPABASE_ANON_KEY                                    *
*   - VITE_ASSEMBLYAI_API_KEY                                   *
*   - VITE_SENTRY_DSN                                           *
*   - VITE_POSTHOG_KEY                                          *
*   - VITE_POSTHOG_HOST                                         *
*   - VITE_STRIPE_PUBLISHABLE_KEY                               *
*   - VITE_STRIPE_SECRET_KEY                                    *
*   - VITE_STRIPE_WEBHOOK_SECRET                                *
*                                                               *
*****************************************************************


## How to Test the Application

This project uses a hybrid testing strategy:

-   **Unit & Integration Tests (Vitest):** For most application logic and components. Run with `pnpm test`.
-   **End-to-End Tests (Playwright):** For testing features in a real browser environment. Run with `npx playwright test`.
-   **Backend Function Tests (Deno):** For testing Supabase Edge Functions. Run with `pnpm run test:functions`.

To run the entire test suite (Vitest and Deno tests), use:
```bash
pnpm run test:all
```


For most of the application logic and component testing, we use Vitest, a fast and modern test runner. These tests run in a simulated JSDOM environment, which is fast but not a real browser.

To run the main test suite, use the following command:

```bash
pnpm test
```

This command is configured to execute all `*.test.jsx` files located under the `src` directory.

### 2. End-to-End & Browser-Specific Tests (Playwright)

For features that rely on browser-native APIs (like the `TranscriptionService`'s audio processing) and are difficult to test reliably in JSDOM, we use [Playwright](https://playwright.dev/). These tests run in a real browser environment, providing a more accurate and stable testing ground for complex features.

To run the Playwright tests, use the following command:

```bash
npx playwright test
```

This command looks for test files in the `playwright-tests` directory and runs them in a headless browser.

## Usage

This section outlines the features available at each of the three user tiers.

### 1. Anonymous Users (Trial)
- **Session Limit**: A single, 2-minute trial session.
- **Transcription**: Privacy-first, on-device transcription.
- **Analytics**: Can view a demo of the analytics page, but no data is saved.

### 2. Free Tier Users
- **Session Limit**: A 30-minute monthly usage quota.
- **Transcription**: All transcription is processed locally on-device.
- **Session History**: Automatically saves session metadata (excluding transcripts) to the user's account.
- **Analytics**: Access to trend-based dashboards.
- **Custom Filler Words**: Track up to 3 custom filler words.

### 3. Pro Tier Users
Pro users unlock the full power of the tool, including:
- Unlimited session time and history.
- The option to use premium, high-accuracy cloud transcription.
- Advanced, per-session analytics and data export (including PDF reports).
- Unlimited custom filler words.

## User Tiers & Authentication

The application is built with a "public-first" approach. Core pages like the main session recorder and analytics dashboard are viewable by anyone. However, to persist data and unlock features, users must create an account.

-   **Authentication Provider**: We use **Supabase Auth** for handling user sign-up, sign-in, and password recovery.
-   **Sign-Up**: When a new user signs up, Supabase sends a confirmation email with a verification link. The user must click this link to activate their account.
-   **Password Reset**: Users can request a password reset link from the Sign-In page. This also uses Supabase's secure email-based recovery flow.
-   **Session Management**: User sessions are managed via the `AuthContext`, which provides user and profile data throughout the application.

This model allows for a low-friction initial experience while providing a clear path to engagement and feature unlock for registered users.

## Project Status & Roadmap

This project is currently being developed into a full-stack SaaS application with a **"Speed Over Perfection"** philosophy. The immediate goal is to launch a monetizable MVP within 3 weeks to gather user feedback and iterate quickly.

The high-level roadmap is a two-phase plan:
1.  **Phase 1: Fast Development & Testing (AssemblyAI)**
    - Goal: Quickly test features, get user feedback, and fix bugs using a cloud-based transcription service.
    - This phase prioritizes speed of iteration over privacy-first features.
2.  **Phase 2: Privacy-First Production (Whisper.cpp On-Device)**
    - Goal: Deliver on the "privacy-first" promise by moving transcription to the user's device.
    - This phase will involve integrating Whisper.cpp to ensure no audio leaves the device.

## How to Deploy to Vercel

1.  **Fork the repository** to your own GitHub account.
2.  **Create a new project on Vercel** and connect it to your forked repository.
3.  **Configure the environment variables** in the Vercel project settings. You will need to add all the variables from your `.env.local` file.
4.  **Deploy!** Vercel will automatically build and deploy your application. Any new pushes to the `main` branch will trigger a new deployment.


## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

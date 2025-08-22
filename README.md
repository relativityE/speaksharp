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

    # AssemblyAI - This is now a server-side secret, not a client-side variable.
    # See the Supabase setup instructions for how to set the ASSEMBLYAI_API_KEY for the Edge Function.

    # Sentry
    VITE_SENTRY_DSN=your_sentry_dsn_here

    # PostHog
    VITE_POSTHOG_KEY=your_posthog_project_api_key_here
    VITE_POSTHOG_HOST=your_posthog_api_host_here

    # Stripe
    VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here
    VITE_STRIPE_SECRET_KEY=your_stripe_secret_key_here
    VITE_STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here
    ```

    **Note on Environment Variables:** In Vite-based projects, it is standard practice to prefix all client-side environment variables with `VITE_`. This is a security measure to prevent accidental exposure of sensitive keys to the browser. Any variable without this prefix will not be accessible in the application's frontend code. For more details, see the official [Vite documentation](https://vitejs.dev/guide/env-and-mode.html).

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Known Issues

When running the application in a development environment, you may see several warnings in the browser console. Most of these are non-critical and can be safely ignored for now.

-   **`net::ERR_BLOCKED_BY_CLIENT`**: This error is typically caused by a browser ad blocker or privacy extension. It blocks tracking requests to services like Sentry and Stripe but does not affect core application functionality.
-   **PostHog Warnings**: You may see warnings about a missing API key for PostHog (our analytics service). These can be ignored if you are not actively working on analytics features.
-   **Stripe HTTPS Warning**: A warning about Stripe needing to be run over HTTPS is expected in local development and does not impact testing.

These issues are documented and will be addressed as part of the broader project polishing phase.

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

The test suites are stable and run as part of the CI/CD pipeline.

## How to Deploy to Vercel

1.  **Fork the repository** to your own GitHub account.
2.  **Create a new project on Vercel** and connect it to your forked repository.
3.  **Configure the environment variables** in the Vercel project settings. You will need to add all the variables from your `.env.local` file.
4.  **Deploy!** Vercel will automatically build and deploy your application. Any new pushes to the `main` branch will trigger a new deployment.


## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

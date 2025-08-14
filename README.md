# SpeakSharp

A mobile-first web application that detects and counts filler words in real time to help users improve verbal clarity and communication effectiveness. All processing is done locally in your browser, ensuring your privacy.

## Features

- **Real-time Filler Word Detection**: Counts common filler words (e.g., "um", "like") and custom words in real-time.
- **Color-Coded Highlighting**: Each filler word is assigned a unique color. Words are highlighted in the live transcript and color-coded in the analysis panel for immediate visual feedback.
- **Dynamic Transcript Box**: The transcript panel starts small and grows as you speak, maximizing screen real estate.
- **Live Analytics**: The sidebar provides a live-updating word count and frequency analysis.
- **Privacy First**: All audio processing is done locally in your browser; your voice data never leaves your device.
- **Session Management**: Start, stop, and save practice sessions.
- **Customizable Experience**: Add your own words to track and use a mobile-friendly, responsive interface.

## Technology Stack

- **Frontend**: React (with [Vite](https://vitejs.dev/)) - A next-generation frontend tooling that provides a faster and leaner development experience for modern web projects.
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Authentication & DB**: Supabase
- **Speech Processing**: Browser's Web Speech API

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

    # Sentry
    VITE_SENTRY_DSN=your_sentry_dsn_here

    # PostHog
    VITE_POSTHOG_KEY=your_posthog_project_api_key_here
    VITE_POSTHOG_HOST=your_posthog_api_host_here

    # Stripe
    VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here
    VITE_STRIPE_PRICE_ID=your_stripe_price_id_here
    # The following keys are used in Supabase Edge Functions and should NOT be exposed to the client.
    # Do not add the VITE_ prefix to them.
    STRIPE_SECRET_KEY=your_stripe_secret_key_here
    STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here
    ```

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

4.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## How to Test the Application

This project uses a hybrid testing strategy to ensure both speed and reliability.

### 1. Unit & Integration Tests (Vitest)

For most of the application logic and component testing, we use [Vitest](https://vitest.dev/), a fast and modern test runner that works seamlessly with Vite. These tests run in a simulated JSDOM environment, which is fast but not a real browser.

To run the main test suite, use the following command:

```bash
pnpm test
```

This command executes all `*.test.jsx` files located under the `src` directory.

### 2. End-to-End & Browser-Specific Tests (Playwright)

For features that rely on browser-native APIs (like the Web Speech API) and are difficult to test reliably in JSDOM, we use [Playwright](https://playwright.dev/). These tests run in a real browser environment, providing a more accurate and stable testing ground for complex features.

To run the Playwright tests, use the following command:

```bash
npx playwright test
```

This command looks for test files in the `playwright-tests` directory and runs them in a headless browser.

## Usage

SpeakSharp uses a "progressive reveal" model. All pages are accessible to everyone, but more features are unlocked when you sign up for an account.

### Anonymous Users
-   **Start a Session**: Anyone can start a recording session from the main page to try the core functionality.
-   **No Data Persistence**: Sessions for anonymous users are not saved. To save your progress, you must create a free account.
-   **View Analytics Page**: You can view the Analytics page, but it will show a demo and a prompt to sign up.

### Authenticated Users (Free Tier)
-   **Sign Up / Login**: Create a free account to save your session history.
-   **5-Minute Monthly Limit**: Free accounts have a 5-minute (300-second) monthly usage limit for recorded sessions.
-   **Save Session History**: Your sessions are automatically saved to your account.
-   **Track Progress**: The Analytics page will show your full session history and progress charts.

### Authenticated Users (Pro Tier)
-   **Upgrade to Pro**: Users can upgrade to a Pro account via Stripe to unlock all features.
-   **Unlimited Usage**: The 5-minute monthly limit is removed.
-   **Custom Filler Words**: Pro users can add and track their own list of custom filler words.

## User Tiers & Authentication

The application is built with a "public-first" approach. Core pages like the main session recorder and analytics dashboard are viewable by anyone. However, to persist data and unlock features, users must create an account.

-   **Authentication Provider**: We use **Supabase Auth** for handling user sign-up, sign-in, and password recovery.
-   **Sign-Up**: When a new user signs up, Supabase sends a confirmation email with a verification link. The user must click this link to activate their account.
-   **Password Reset**: Users can request a password reset link from the Sign-In page. This also uses Supabase's secure email-based recovery flow.
-   **Session Management**: User sessions are managed via the `AuthContext`, which provides user and profile data throughout the application.

This model allows for a low-friction initial experience while providing a clear path to engagement and feature unlock for registered users.

## Project Status & Roadmap

This project is currently being developed into a full-stack SaaS application with a **"Speed Over Perfection"** philosophy. The immediate goal is to launch a monetizable MVP within 3 weeks to gather user feedback and iterate quickly.

The high-level roadmap is to:
1.  **Launch a functional MVP** with authentication, free/paid tiers, and payment processing.
2.  **Gather user feedback** and iterate on the core features.
3.  **Expand the feature set** based on user demand, including advanced analytics and cloud-powered transcription.


## Known Issues

-   **Testing Web Speech API**: The browser's Web Speech API has an auto-restart behavior that can cause infinite loops in some testing environments (like JSDOM). The application logic in `src/hooks/useSpeechRecognition.js` includes a workaround to disable this auto-restart when running under the Vitest testing framework.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

# SpeakSharp

A mobile-first web application that detects and counts filler words in real time to help users improve verbal clarity and communication effectiveness. All processing is done locally in your browser, ensuring your privacy.

## Features

- **Real-time Filler Word Detection**: Counts common filler words (e.g., "um", "like") and custom words in real-time.
- **Color-Coded Highlighting**: Each filler word is assigned a unique color. Words are highlighted in the live transcript and color-coded in the analysis panel for immediate visual feedback.
- **Dynamic Transcript Box**: The transcript panel starts small and grows as you speak, maximizing screen real estate.
- **Live Analytics**: The sidebar provides a live-updating word count and frequency analysis.
- **Hybrid Speech Processing**: Supports both local, in-browser speech recognition for privacy and a cloud-based option (AssemblyAI) for higher accuracy.
- **Session Management**: Start, stop, and save practice sessions.
- **Customizable Experience**: Add your own words to track and use a mobile-friendly, responsive interface.

## Technology Stack

- **Frontend**: React (with [Vite](https://vitejs.dev/)) - A next-generation frontend tooling that provides a faster and leaner development experience for modern web projects.
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Authentication & DB**: Supabase
- **Speech Processing**:
    - **Phase 1 (Current)**: AssemblyAI for cloud-based transcription.
    - **Phase 2 (Planned)**: Whisper.cpp for local, on-device transcription to ensure privacy.

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

    # AssemblyAI
    VITE_ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here

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

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

5.  Open `http://localhost:5173` in your browser.

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

For features that rely on browser-native APIs (like the `TranscriptionService`'s audio processing) and are difficult to test reliably in JSDOM, we use [Playwright](https://playwright.dev/). These tests run in a real browser environment, providing a more accurate and stable testing ground for complex features.

To run the Playwright tests, use the following command:

```bash
npx playwright test
```

This command looks for test files in the `playwright-tests` directory and runs them in a headless browser.

## Usage

SpeakSharp uses a "progressive reveal" model. All pages are accessible to everyone, but more features are unlocked when you sign up for a free account.

### Anonymous Users (Free Trial)
-   **Start a Session**: Anyone can start a recording session from the main page.
-   **2-Minute Limit**: Trial sessions are limited to 2 minutes. A checkbox is available for developers to override this limit.
-   **View Analytics Page**: You can view the Analytics page, but it will show a demo and a prompt to sign up to save and view your history.

### Authenticated Users (Free Tier)
-   **Sign Up / Login**: Create a free account to unlock more features.
-   **Save Session History**: Your sessions are automatically saved to your account.
-   **Track Progress**: The Analytics page will show your full session history and progress charts.
-   **Unlimited Session Length**: The 2-minute limit is removed.
-   **Custom Filler Words**: Add and track your own list of custom filler words.

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

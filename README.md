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
    Create a file named `.env.local` in the root of the project and add the necessary keys for Supabase and other services. See the `.env.example` file for a full list.

    For a detailed explanation of the developer workflow and how to use the shared secret for testing, please see the **"Developer Workflow & Local Testing"** section in the `System Architecture.md` document.

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Known Issues

All known issues, bugs, and technical debt are tracked in our [Product Requirements Document (PRD.md#known-issues)](PRD.md#known-issues). This ensures a single source of truth for the project's status.

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

## How to Deploy to Vercel

1.  **Fork the repository** to your own GitHub account.
2.  **Create a new project on Vercel** and connect it to your forked repository.
3.  **Configure the environment variables** in the Vercel project settings. You will need to add all the variables from your `.env.local` file.
4.  **Deploy!** Vercel will automatically build and deploy your application. Any new pushes to the `main` branch will trigger a new deployment.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

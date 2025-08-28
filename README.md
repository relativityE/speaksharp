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

    To test cloud-based features locally, you can enable developer mode by setting `VITE_DEV_MODE=true` in your `.env.local` file. This will use a secure anonymous sign-in to generate a temporary user session.

4.  Start the development server:
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Known Issues

### Cloud Transcription Connection Failure

**Status:** Under Active Investigation (as of Aug 28, 2025)

**Summary:** The real-time transcription feature using the "Cloud AI" option is currently failing to establish a connection. A detailed investigation has pinpointed the failure to the handoff between the Supabase platform gateway and the `assemblyai-token` Edge Function handler.

**Technical Analysis (The Facts):**

1.  **Frontend Action:** The app calls `supabase.functions.invoke('assemblyai-token', { body: {} })`. Browser logs confirm a valid authentication token is available and the function call is dispatched correctly.
2.  **Supabase Gateway Receives Request:** Supabase platform logs confirm the request is received and the function container is booted (we see an `"event_message": "booted"` log).
3.  **Communication Breakdown:** The code execution **never enters the function handler**. The first line of our function code (`console.log("assemblyai-token function invoked.");`) never executes, and its log message never appears in the Supabase logs.
4.  **Result:** The frontend call hangs indefinitely, waiting for a response from the function that never comes.

**Conclusion:** The available evidence suggests the request is being dropped or blocked by the Supabase platform *after* the gateway accepts it, but *before* the function handler is invoked. The issue does not appear to be solvable within the application codebase. The next step is to present these findings to an external developer or Supabase support.


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

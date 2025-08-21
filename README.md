# DevFolio - A Developer Portfolio Template

A modern, responsive, and customizable developer portfolio template built with React, Vite, and Tailwind CSS, featuring a "Midnight Blue & Electric Lime" theme.

## Features

- **Futuristic "Midnight & Lime" Theme**: A visually striking dark theme with a midnight blue background and electric lime accents.
- **Responsive Design**: Looks great on all devices, from mobile phones to desktop monitors.
- **Component-Based Architecture**: Built with React and `shadcn/ui` for a clean and maintainable codebase.
- **Sidebar Navigation**: A fixed sidebar provides easy navigation through the portfolio sections.
- **Portfolio Sections**: Includes pre-built sections for:
    - **Hero**: A prominent section to introduce yourself.
    - **Technical Skills**: Showcase your expertise.
    - **Featured Projects**: Display your best work in a card-based layout.
    - **Stats**: Highlight key metrics like years of experience and projects completed.
    - **Contact CTA**: A call-to-action to encourage visitors to get in touch.
- **Supabase Integration**: Includes a functional backend setup with Supabase for features like authentication and payments (though these are currently being worked on).

## Technology Stack

- **Frontend**: React (with [Vite](https://vitejs.dev/))
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Backend (Optional)**: Supabase (Auth, Database, Edge Functions)
- **Payments (Optional)**: Stripe

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v10.4.1 or higher)

### Installation

1.  Clone the repository.
2.  Install dependencies: `pnpm install`
3.  Set up your environment variables in a `.env.local` file. The original `README.md` can be consulted for the full list of required variables.
4.  Start the development server: `pnpm run dev`

---

## Current Status & Known Issues (As of Checkpoint)

This project is a checkpoint of a significant refactoring effort. The original "SpeakSharp" application has been successfully transformed into the "DevFolio" portfolio theme. However, there are critical outstanding issues.

### Work Completed
- **Full Theme Redesign**: The UI has been completely overhauled with the new "Midnight & Lime" theme. This includes new colors, typography, a new sidebar layout, and a completely rebuilt main page.
- **Critical Security Fixes**: The Supabase edge functions (`assemblyai-token`, `stripe-checkout`, `stripe-webhook`) have been patched to fix critical security vulnerabilities, including adding authentication and input validation.
- **Session Page Bugfix**: A bug preventing the transcription mode from being changed on the Session Page has been fixed.

### Work Outstanding
- **High-Priority Stability Fixes**: Several high-priority issues from a code review remain, including optimizing UI performance and adding documentation to critical services.
- **Auth Page Theming**: The `AuthPage.jsx` has not been fully restyled to match the new theme.

### 🚨 BROKEN: Test Suite 🚨
The test suite is currently non-functional and is the highest priority technical debt.

-   **Issue**: The test suite consistently fails with a "JavaScript heap out of memory" error, indicating a severe memory leak.
-   **Suspicion**: The root cause is likely a memory leak in the test setup (`src/test/setup.js`), where one or more mocked browser APIs (especially the `MediaRecorder` mock) are not being properly cleaned up between tests. The leak is severe enough that it crashes the test process even when tests are run serially.
-   **Troubleshooting Attempts**:
    1.  **Mock Cleanup**: An attempt was made to fix the `MediaRecorder` mock by adding a static `cleanupAll` method to track and destroy all instances after each test. This was not sufficient.
    2.  **Vitest Configuration**: The `vitest.config.js` file was updated to force single-threaded execution, increase timeouts, and enable mock clearing between tests, as per user guidance. This did not resolve the memory crash.
    3.  **Test-Specific Fixes**: A `React is not defined` error in `App.test.jsx` was fixed.
-   **Next Steps**: The next step is to debug the `act()` warnings in the test files, as these may point to the underlying cause of the state update issues that could be contributing to the memory leak.

---

## How to Test the Application

**The test suite is currently broken.** When functional, the commands are:

-   **Unit & Integration Tests (Vitest)**: `pnpm test`
-   **End-to-End Tests (Playwright)**: `npx playwright test`

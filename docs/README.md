# SpeakSharp

SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users improve their public speaking skills. It provides instant, on-device feedback and is built as a modern, serverless SaaS web application using React (Vite) and Supabase.

## 📚 Documentation

All project documentation is located in the `/docs` directory. For a complete overview and map of the documentation, please see **[./OUTLINE.md](./OUTLINE.md)**.

Here are the direct links to the core documents:

*   **[PRD.md](./PRD.md)**: The "What & Why" - Product Requirements Document.
*   **[ARCHITECTURE.md](./ARCHITECTURE.md)**: The "How" - System Architecture and technical deep dive.
*   **[ROADMAP.md](./ROADMAP.md)**: The "When & Status" - Development plan and project status.

## 🚀 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [pnpm](https://pnpm.io/)
*   [Supabase CLI](https://supabase.com/docs/guides/cli)
*   [Docker](https://www.docker.com/) (must be running for local Supabase services)

### Installation and Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd speaksharp
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```
    This will also trigger the `postinstall` script, which initializes Mock Service Worker (`msw`) for API mocking in the test environment.

3.  **Environment Variables:**
    This project uses Vite, which automatically loads environment variables based on the mode. For local development and testing, the file `.env.test` is already included in the repository root and is used by default. **No action is required** unless you need to add or modify API keys for your own cloud services.

4.  **Local Database Setup:**
    To run the application locally, you need to start the Supabase services. Make sure the Docker daemon is running first.
    ```bash
    supabase start
    ```
    To reset your local Supabase database to a clean state, which runs all migrations and populates the database with the seed data from `supabase/seed.sql`, use the following command:
    ```bash
    supabase db reset
    ```
    This command is useful for starting fresh or if you encounter data-related issues during development.

### Development Workflow

Our goal is to make local development as smooth as possible. Here are some key scripts and variables to help you.

*   **Testing Pro Features Locally:**
    To test Pro features without a real Stripe subscription, you can grant any user 'pro' status on the client-side. Add the following line to your `.env.test` file:
    ```
    VITE_DEV_PRO_ACCESS=true
    ```
    When this variable is set, any user you are logged in as will have their subscription status overridden to `pro` in the app.

*   **Managing On-Device ML Models:**
    The on-device transcription feature requires ML model files to be hosted locally in the `/public/models` directory. To download or update a model from Hugging Face, use the `update-model.sh` script:
    ```bash
    bash scripts/update-model.sh Xenova/whisper-tiny.en
    ```
    Replace `Xenova/whisper-tiny.en` with the desired model name.

### Running the Development Server

To start the Vite development server, run:

```bash
pnpm dev
```

The application will be available at `http://localhost:5173`.

### Troubleshooting
*   **`rounded-pill` error on startup:** This is often a caching issue with Vite. Try deleting the `node_modules/.vite` directory and restarting the dev server.
*   **API Key errors (401 Unauthorized):** Ensure your `.env.test` file is correctly populated with the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you are using your own Supabase project.
*   **`toast` notifications not appearing:** This is a known issue in local development. Please see the full list of [Known Issues in the PRD](./PRD.md#3-known-issues) for status.

## ✅ Testing

This project uses a suite of scripts to ensure code quality, run tests, and generate software quality metrics. The entire pipeline has been orchestrated into a single, robust command.

### Running the Full CI Pipeline

To run the entire suite of checks (linting, type-checking, unit tests, E2E tests, build, etc.) exactly as it runs in the CI environment, use the main orchestrator script:

```bash
./ci-run-all.sh
```

This script executes all the necessary steps in the correct order, leveraging caching to run efficiently. It is the single source of truth for validating the application.

### Forcing a Full Environment Recovery

If the test environment becomes unstable, you can force a full cleanup before running the pipeline by setting the `FORCE_VM_RECOVERY` environment variable:

```bash
FORCE_VM_RECOVERY=1 ./ci-run-all.sh
```

This will delete all build artifacts and `node_modules` before reinstalling and running the tests.

## Linting

To check the code for linting errors, run:

```bash
pnpm run lint
```

## Code Quality

This project uses a pre-commit hook to enforce code quality standards. The hook is managed by [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged).

Before each commit, the following checks are run on the staged files:
- **ESLint:** Fixes formatting and style issues.
- **TypeScript Compiler (`tsc`):** Performs a type check to catch any type-related errors.

If any of these checks fail, the commit will be aborted. This ensures that only high-quality, error-free code is committed to the repository.

## Project Governance

### PM Perspective (Process & Documentation)

**Doing Well:**

*   Comprehensive [PRD.md](./PRD.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).
*   Phased milestones + MoSCoW prioritization in [ROADMAP.md](./ROADMAP.md).

**Gaps / Fixes:**

*   Documentation was scattered; now consolidated into `/docs`.
*   Outdated root `README.md` replaced with accurate project overview.

**Strategic Guidance:**

*   Enforce **documentation governance**: each doc has a single purpose, reviewed quarterly.
*   For scaling: consider migrating to GitBook/Docusaurus once team >10 contributors.

### Cross-Reference Map

*   **PRD.md** → What & Why (vision, roles, financials)
*   **ARCHITECTURE.md** → How (system design, block diagrams)
*   **ROADMAP.md** → When & Status (tasks, milestones, gating checks)
*   **REVIEW.md** → Who & So What (leadership insight & direction)

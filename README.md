**Owner:** [unassigned]
**Last Reviewed:** 2026-02-09

# SpeakSharp

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

### 🎙️ Core Features

-   **Triple-Engine Transcription:** 
    -   **Private Mode:** High-performance on-device processing via `whisper-turbo` (WebGPU/WASM) for maximum privacy.
    -   **Cloud Mode:** High-fidelity transcription via AssemblyAI Streaming with custom vocabulary boosting.
    -   **Native Mode:** Universal compatibility using the browser's Web Speech API.
-   **Advanced Vocal Analytics:**
    -   **Adaptive Noise Floor:** Intelligently filters background noise to provide precision pause detection.
    -   **Rolling WPM:** Smooth, 15-second rolling window for real-time speaking pace feedback.
    -   **Optimal Pace Targeting:** Real-time guidance toward the 130-150 WPM professional standard.
-   **Session History & Insights:** 
    -   Interactive dashboards with streak tracking.
    -   AI-powered speaking tips and clarity scores.
    -   Detailed PDF report export for every session.
-   **Production Grade:** Full Sentry monitoring, PostHog product analytics, and Stripe payment integration.

---

## 🛠️ Tech Stack & Architecture

-   **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Zustand.
-   **Backend:** Supabase (Auth, Postgres, Edge Functions).
-   **Infrastructure:** GitHub Actions CI/CD with parallelized sharding and multi-stage audits.
-   **Monitoring:** Sentry (Error Tracking), PostHog (Product Analytics).

## Project Structure

The codebase is organized into clearly separated directories:

```
speaksharp/
├── frontend/          # React application
│   ├── src/          # Application source code
│   ├── tests/        # Frontend-specific tests
│   │   └── integration/ # Real DB integration tests
│   ├── public/       # Static assets
│   └── *.config.*    # Frontend build configs (Vite, Vitest, etc.)
├── backend/           # Supabase backend services
│   ├── functions/    # Edge functions
│   ├── migrations/   # Database migrations
│   └── config.toml
├── scripts/           # Build, test, and maintenance scripts
│   ├── test-audit.sh
│   ├── run-metrics.sh
│   └── ...
├── tests/             # All tests (E2E, unit, fixtures, POMs)
│   ├── e2e/
│   ├── unit/
│   ├── fixtures/
│   └── pom/
```

### Test File Locations

| Test Type | Location | Pattern |
|-----------|----------|---------|
| **Unit Tests** | `frontend/src/**/__tests__/` | `*.test.ts` (Logic) |
| **Component Tests** | `frontend/src/**/__tests__/` | `*.component.test.tsx` (DOM) |
| **Integration Tests** | `frontend/tests/integration/` | `*.spec.ts` |
| **E2E Tests** | `tests/e2e/` | `*.e2e.spec.ts` |
| **Soak/Canary Tests** | `tests/soak/`, `tests/e2e/` | `*.spec.ts` |

> **Note:** Unit tests are co-located with source files (not in a separate `tests/unit/` directory) following the pattern recommended by Vitest for better maintainability.

**Why `__tests__/`?**
- Jest/Vitest automatically discover `*.test.ts` files in `__tests__/` directories
- Double underscores = "this is special/internal" (convention borrowed from Python's `__init__.py`)
- Bundlers (Vite/Webpack) exclude these directories from production builds

## Getting Started

To get started with SpeakSharp, you'll need to have Node.js (version 22.12.0 or higher) and pnpm (v10.29.1 enforced) installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    ```
2.  **Change into the directory:**
    ```bash
    cd speaksharp
    ```
3.  **Install Dependencies from Lockfile:**
    ```bash
    pnpm run setup
    ```
    > **Tip:** For a complete development setup (dependencies + Playwright browsers), you can run `./scripts/dev-init.sh`.
4.  **Configure Environment Variables:**
    
    Create a `.env` file in the project root with these required variables:
    
    ```bash
    # Frontend (Vite) - Required for build
    VITE_SUPABASE_URL=https://your-project.supabase.co
    VITE_SUPABASE_ANON_KEY=your-anon-key-here
    VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your-key-here
    ```
    
    **The build will fail immediately if any required variables are missing.**  
    See `env.required` for the complete list or copy `.env.example` to `.env` and fill in your values.

    **Backend (Supabase Edge Functions):**
    
    These are Supabase secrets, set via `supabase secrets set` or the Supabase Dashboard:
    
    ```bash
    ASSEMBLYAI_API_KEY=your-assemblyai-key    # For cloud transcription
    STRIPE_SECRET_KEY=sk_test_your-key        # For payment processing
    STRIPE_WEBHOOK_SECRET=whsec_your-secret   # For webhook verification
    SUPABASE_SERVICE_ROLE_KEY=your-role-key   # For admin DB operations
    PROMO_GEN_ADMIN_SECRET=1234567            # For promo generation (secret-driven)
    ```

    > **Promo Administration:** We use a secure, secret-driven system for generating tester promo codes. You can generate a new one-time code at any time using `pnpm generate-promo`, which calls the backend Admin Edge Function (gated by `PROMO_GEN_ADMIN_SECRET`).

5.  **Run the development server:**
    ```bash
    pnpm dev
    ```

6.  **(Optional) Install Playwright browsers for E2E testing:**
    ```bash
    pnpm pw:install       # Chromium only (faster)
    pnpm pw:install:all   # All browsers
    ```

## Asset Organization

This project uses a hybrid approach for managing image assets:

### Public Assets (`frontend/public/assets/`)
- **Static files** that don't require build-time processing (e.g., `speaksharp-logo.png`)
- Referenced directly in code as `/assets/filename.ext`
- Served as-is by Vite

### Source Assets (`frontend/src/assets/`)
- **Build-optimized assets** that go through Vite's import pipeline
- SVG assets (`react.svg`) are stored directly in `frontend/src/assets/`
- Complex UI visualizations (like the Hero and Analytics dashboards) are implemented as **code-driven components** (e.g., `HeroStatsDashboard.tsx`) rather than static images, ensuring high performance and rich interactivity.

### Stabilizing the Environment by Enforcing the Lockfile

**This is a critical step to prevent \"works on my machine\" issues.**

This project uses a strict `pnpm-lock.yaml` file to guarantee that every developer and every CI run uses the exact same dependency versions. If you encounter unexpected build, type-check, or linting errors in a fresh environment, it is likely due to dependency drift.

**To fix this, you must enforce the lockfile:**

1.  **Delete the `node_modules` directory:**
    ```bash
    rm -rf node_modules
    ```
2.  **Re-install using the canonical setup script:**
    ```bash
    pnpm run setup
    ```

The `pnpm run setup` command executes `pnpm install --frozen-lockfile`, which is the **only** correct way to install dependencies in this project. It forces pnpm to install the exact versions specified in the lockfile, ensuring a reproducible environment.

## Running the Full Test & Audit Suite

This project uses a unified testing strategy centered around a single, robust script (`scripts/test-audit.sh`) that is accessed via simple `pnpm` commands. This ensures that local validation and the CI pipeline are perfectly aligned.

### The Canonical Test Commands

For all local testing and validation, use the following `pnpm` scripts. They are the **single source of truth** for ensuring code quality.

*   **Run the complete CI pipeline locally (recommended before any commit):**
    ```bash
    pnpm test:all
    ```
    **Why?** This is the canonical command for a full local quality check. It runs the same sequence as the CI `prepare` stage (Preflight, Lint, Typecheck, Unit Tests, Build) and then runs the **entire** End-to-End (E2E) test suite. It is the best way to guarantee your changes will pass CI.

*   **Run a fast "health check" of the application:**
    ```bash
    pnpm test:health-check
    ```
    **Why?** This is your go-to command during active development. It skips the time-consuming unit test suite and focuses purely on the canonical E2E "health check" journey (Home -> Session -> Analytics). This provides an instant, high-level verification of the app's critical path.

*   **Run only the unit tests:**
    ```bash
    pnpm test
    ```
    **Why?** The fastest possible feedback loop, useful when practicing Test-Driven Development (TDD) on a specific component.

### Software Quality Metrics (SQM)

This section provides an up-to-date snapshot of the project's software quality. These metrics are generated by running `pnpm test:all` and are automatically updated in the `docs/PRD.md` file.

**Lighthouse Scores** (2026-02-09):
- **Performance:** 94%
- **Accessibility:** 94%
- **Best Practices:** 93%
- **SEO:** 91%

For detailed test metrics, coverage, and E2E results, see the latest [PRD.md Software Quality Metrics](./docs/PRD.md#software-quality-metrics-sqm) section.
The test runner automatically generates a Software Quality Metrics report.
*   When run locally (e.g., `pnpm test:all` or `pnpm test:health-check`), a summary is printed to your console.
*   When run in CI, the full report is automatically generated and committed to `docs/PRD.md`.

## Scripts Reference

This project provides multiple npm scripts for different use cases. Use this decision tree to find the right command:

### Testing & Validation

**🎯 Want to run the full CI simulation locally?**
```bash
pnpm run ci:local
```
- Runs frozen lockfile check, quality checks, build, E2E shards (1-4), Lighthouse CI
- Mirrors GitHub CI workflow exactly
- **Use before:** Major commits, PRs

**🚀 Want quick validation during development?**
```bash
pnpm test:health-check
```
- Runs preflight, build, and the **canonical Core Journey E2E test**
- **Note:** The `test:health-check` script executes the test suite defined in `tests/e2e/core-journey.e2e.spec.ts`.
- **Core journey verifies:** Homepage, Session Flow, Transcription, and Analytics persistence.
- Optimized for speed by bypassing unit tests and code quality checks.
- **Use for:** Rapid "critical path" verification.

**⚡ Want the fastest local feedback (unit tests only)?**
```bash
pnpm test
```
- Runs Vitest with coverage
- **Use for:** TDD, component development

**🧪 Want to run the complete E2E suite?**
```bash
pnpm test:all
```
- Runs quality checks + full E2E suite (all test files)
- **Use for:** Final validation before merge

**🔥 Want to run tests against REAL live services?**
```bash
pnpm test:live
```
- Runs specific E2E tests (`tests/live/*.spec.ts`) against a real database and real Whisper engine (simulating production environment locally)
- Requires proper `.env` setup with live credentials (DB, Stripe, etc.)
- **Use for:** Verifying integrations that cannot be mocked (e.g., precise audio decoding, real database transactions)

**🐦 Want to verify Staging/Production?**
```bash
pnpm test:canary
```
- Runs smoke tests against the deployed URL (or local via config config).
- **Use for:** Post-deployment verification.

### E2E Debugging

**🐛 Want to debug E2E tests interactively?**
```bash
pnpm run test:e2e:ui        # Playwright UI mode
pnpm run test:e2e:debug     # Headed mode with trace
```

**🔦 Want to run Lighthouse audits?**
```bash
pnpm run lighthouse:ci
```

### Soak & Load Testing

### Soak & Load Testing

**🌊 Want to stress test the backend APIs?**
```bash
pnpm test:soak:api
```
- Runs a lightweight Node.js load test against standard APIs (Auth, Session, Edge Functions).
- Bypasses UI to simulate high concurrency (default: 10 concurrent users).
- **Configuration:** Control user counts with `NUM_FREE_USERS=N` and `NUM_PRO_USERS=N` in `.env`.

**⏳ Want to verify UI stability over time?**
```bash
pnpm test:soak
```
- Runs Playwright-based soak tests to check for memory leaks and UI stability.

**📡 Want to run the Soak Test remotely (GitHub Actions)?**
```bash
pnpm test:soak:remote
# OR with custom user counts
pnpm test:soak:remote 15 5
# OR wait for completion
pnpm test:soak:remote:wait
```
- Dispatches the "Soak Test" workflow to GitHub Actions (secure execution).
- Uses remote secrets securely without local configuration.
- Returns a link to view the live run.
- `--wait` flag monitors execution until completion.

### Build & Preview

**📦 Want to build for production?**
```bash
pnpm run build
```

**📦 Want to build for E2E testing?**
```bash
pnpm run build:test
```

**👀 Want to preview the production build?**
```bash
pnpm run preview
pnpm run preview:test    # For test mode
```

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the `scripts/test-audit.sh` script. This ensures perfect consistency between the developer environment and the CI environment.


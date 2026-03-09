**Owner:** [unassigned]
**Last Reviewed:** 2026-03-01

# SpeakSharp
**v3.5.5-dev** | **Last Updated: 2026-03-07**

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

### 🎙️ Core Features

-   **Triple-Engine Transcription:** 
    -   **Private Mode:** High-performance on-device processing via `whisper-turbo` (WebGPU/WASM) for maximum privacy.
    -   **Cloud Mode:** High-fidelity transcription via AssemblyAI Streaming with user word boosting.
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
-   **Phase 2 Hardening (Feb 2026):** 100% production-ready infrastructure featuring:
    -   **Memory Leak Protection:** Strict Disposable pattern for all audio/ML instances.
    -   **Race Condition Guards:** Ref-based finalization and stable callback proxies for React hooks.
    -   **Security Hardening:** Constant-time comparison for secrets and atomic SQL increments for usage tracking.
    -   **Failure Isolation:** Granular error boundaries and robust global rejection handlers.
-   **Phase 3/4 Hardening (Feb 2026):** **"Zero-Debt" & Scalability Baseline**.
    -   **O(1) Live Analytics:** Infinite-duration sessions supported via incremental observer pattern.
    -   **NLP Caching:** 500x faster re-renders for multi-speaker dialog via LRU document cache.
    -   **Atomic Consistency:** Restored row-locking prevents usage limit bypass under high concurrency.
-   **Mar 2026 Hardening:** **Live UI & STT Stabilization**.
    -   **UI Redesign:** High-fidelity `LiveRecordingCard` overhaul (Vertical center-stack, Proportionality).
    -   **Benchmarking:** Modular STT hardware benchmarks with Pro-user authentication support.
    -   **Environment Reliability:** Unified Vite root-env resolution for project-wide `.env` loading.

---

## 🛠️ Tech Stack & Architecture

-   **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Zustand.
-   **Backend:** Supabase (Auth, Postgres, Edge Functions).
-   **Infrastructure:** GitHub Actions CI/CD with parallelized sharding and multi-stage audits.
-   **Monitoring:** Sentry (Error Tracking), PostHog (Product Analytics).

## 🗺️ Documentation Map

Before diving deeper, **all new developers must read [docs/OUTLINE.md](./docs/OUTLINE.md)**. 

SpeakSharp maintains an extensive, interconnected documentation architecture. `OUTLINE.md` acts as the definitive map ("Single Source of Truth") for where specific types of information (Architecture, Testing Strategy, Roadmaps, Changelogs) are stored, preventing documentation drift and duplication.

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

## Getting Started (How to Run)

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
    pnpm setup
    ```
    > **Tip:** For a complete development setup (dependencies + Playwright browsers), you can run `./scripts/dev-init.sh`.
    
4.  **Verify Environment Health (Required):**
    ```bash
    ./scripts/preflight.sh
    ```
    This script ensures your system meets the strict Node.js, pnpm, and dependency requirements before you start.

5.  **Configure Environment Variables:**
    
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

7.  **Validate Your Local Installation:**
    If you're a new developer setting up the project, it's highly recommended to run the canonical health check to ensure your local environment is sound:
    ```bash
    pnpm test:health:local
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
    pnpm setup
    ```

The `pnpm setup` command executes `pnpm install --frozen-lockfile`, which is the **only** correct way to install dependencies in this project. It forces pnpm to install the exact versions specified in the lockfile, ensuring a reproducible environment.

## How to Test (Full Audit Suite)

This project uses a unified testing strategy centered around a single, robust script (`scripts/test-audit.sh`) that is accessed via simple `pnpm` commands. This ensures that local validation and the CI pipeline are perfectly aligned.

All test scripts follow a strict **Level : Env : Mode** taxonomy: `test:<level>:<env>[:<mode>]`

### The Canonical Test Commands

*   **Run the isolated Agent-Safe test loop (recommended for AI debugging):**
    ```bash
    pnpm test:agent
    ```

*   **Run the complete CI pipeline locally (recommended before any commit):**
    ```bash
    pnpm test:all:local
    ```

*   **Run a fast "health check" of the application:**
    ```bash
    pnpm test:health:local
    ```

*   **Run only the unit tests:**
    ```bash
    pnpm test:unit:local
    ```

### Software Quality Metrics (SQM)

This section provides an up-to-date snapshot of the project's software quality. These metrics are generated by running `pnpm test:all:local` and are automatically updated in the `docs/PRD.md` file.

**Lighthouse Scores** (2026-03-01):
- **Performance:** 97%
- **Accessibility:** 94%
- **Best Practices:** 100%
- **SEO:** 91%

For detailed test metrics, coverage, and E2E results, see the latest [PRD.md Software Quality Metrics](./docs/PRD.md#software-quality-metrics-sqm) section.
The test runner automatically generates a Software Quality Metrics report.
*   When run locally (e.g., `pnpm test:all:local` or `pnpm test:health:local`), a summary is printed to your console.
*   When run in CI, the full report is automatically generated and committed to `docs/PRD.md`.

## Scripts Reference

This project provides multiple npm scripts for different use cases. All test scripts follow `test:<level>:<env>[:<mode>]`.

### Testing & Validation

**🎯 Want to run the full CI simulation locally?**
```bash
pnpm ci:full:local
```
- Runs frozen lockfile check, quality checks, build, E2E shards (1-4), Lighthouse CI
- Mirrors GitHub CI workflow exactly
- **Use before:** Major commits, PRs

**🚀 Want quick validation during development?**
```bash
pnpm test:health:local
```
- Runs preflight, build, and the **canonical Core Journey E2E test**
- **Core journey verifies:** Homepage, Session Flow, Transcription, and Analytics persistence.
- **Use for:** Rapid "critical path" verification.

**⚡ Want the fastest local feedback (unit tests only)?**
```bash
pnpm test
```
- Alias for `test:unit:local`. Runs Vitest with coverage.
- **Use for:** TDD, component development

**🧪 Want to run the complete E2E suite?**
```bash
pnpm test:all:local
```
- Runs quality checks + full E2E suite (all test files)
- **Use for:** Final validation before merge

**🔬 Want to run integration tests against real Supabase?**
```bash
pnpm test:int:local
```
- Runs auth, upgrade, analytics-journey specs against real Supabase (no hardware needed)
- Requires `.env.development` with DB credentials
- **Use for:** Validating real API integrations

**🖥️ Want to run full system tests (real DB + real STT + hardware)?**
```bash
pnpm test:system:local:headed
```
- All `tests/live/*.spec.ts` in headed Chrome with real Whisper/Native STT
- Requires `.env.development` with live credentials + audio hardware
- **Use for:** Full-stack integration verification

**🐦 Want to verify Staging/Production deployment?**
```bash
pnpm test:deploy          # Production (default)
pnpm test:deploy:local    # Against localhost:5173
```
- Runs smoke tests against the deployed URL (production by default).
- **Use for:** Post-deployment verification.

**☁️ Want to dispatch cloud test suites?**
```bash
pnpm ci:dispatch:deploy   # Deploy smoke on GitHub Actions
pnpm ci:dispatch:soak     # Soak test on GitHub Actions
```
- Each dispatches a single workflow. Requires `gh` CLI authenticated.
- **Use for:** Triggering tests that require GitHub secrets.

### E2E Debugging

**🐛 Want to debug E2E tests interactively?**
```bash
pnpm test:e2e:mock:headed    # Playwright UI mode
pnpm test:e2e:mock:debug     # Headed mode with trace
```

**🔦 Want to run Lighthouse audits?**
```bash
pnpm run lighthouse:ci
```

### Soak & Load Testing

**🌊 Want to stress test the backend APIs?**
```bash
pnpm test:soak:api:cloud
```
- Runs a lightweight Node.js load test against standard APIs (Auth, Session, Edge Functions).
- Bypasses UI to simulate high concurrency (default: 10 concurrent users).
- **Configuration:** Control user counts with `NUM_FREE_USERS=N` and `NUM_PRO_USERS=N` in `.env`.

**⏳ Want to verify UI stability over time?**
```bash
pnpm test:soak:ui:cloud
```
- Runs Playwright-based soak tests to check for memory leaks and UI stability.

**📡 Want to run soak tests remotely (GitHub Actions)?**
```bash
pnpm ci:dispatch:soak
pnpm ci:dispatch:soak:wait   # Wait for completion
```
- Dispatches the "Soak Test" workflow to GitHub Actions (secure execution).

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


<!-- SQM:START -->
## 6. Software Quality Metrics

**Last Updated:** Sun, 08 Mar 2026 19:20:50 GMT

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

**Metric Definitions:**
- **Total Source Size:** Sum of all code in src, backend, tests, docs, and scripts.
- **Total Project Size:** Total disk footprint including node_modules and assets.
- **Initial Chunk Size:** The size of the largest initial JavaScript bundle.
- **Code Bloat Index:** Ratio of Initial Chunk Size to Total Source Size (lower is better).

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | 626 (556 unit + 70 E2E) |
| Unit tests              | 556   |
| E2E tests (Playwright)  | 70  |
| Passing tests           | 626 (556 unit + 70 E2E)   |
| Failing tests           | 0   |
| Disabled/skipped tests  | 0 (E2E only)   |
| Passing unit tests      | 556/556 (100.0%)   |
| Passing E2E tests       | 70/70 (100.0%)   |
| Total runtime           | 2m 24s   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | 85.5%   |
| Branches   | 78.2%   |
| Functions  | 82.1%   |
| Lines      | 85.5%   |

---

### Code Bloat & Performance

| Metric              | Value |
| ------------------- | ----- |
| Total Source Size   | 3.5MB   |
| Total Project Size  | 214MB   |
| Initial Chunk Size  | 933KB   |
| Code Bloat Index    | 26.3%   |
| Lighthouse Scores   | P: 97, A: 94, BP: 100, SEO: 91 |

---
<!-- SQM:END -->

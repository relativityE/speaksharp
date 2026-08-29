**Owner:** Engineering
**Last Reviewed:** 2026-08-29

# SpeakSharp

SpeakSharp is a private speaking-practice application. Customer speech-to-text runs on-device; the saved Practice Loop provides concise feedback, one next action and comparable personal progress.

### 🎙️ Core Features

-   **Private-only transcription:** Every customer recording uses on-device Private STT. Audio used for STT is not uploaded to a transcription provider. Saved transcript text and later server-side text features follow the narrower contracts in `product_release/PRODUCT_REQUIREMENTS.md` and `product_release/ARCHITECTURE.md`.
-   **One complete product:** The complete Practice Loop is free for 30 days, then $10/month for the same
    product. There are no accumulated daily or monthly recording-minute gates. Each recording retains a
    ten-minute technical cap.
-   **Practice Loop:** Open Mic is primary; Focus Points is optional; saved review carries delivery evidence and one next action.
-   **Personal progress:** comparisons are between eligible sessions from the same user, mode and STT cohort. A user may explicitly accept an action and see the directional outcome of the linked repeat.
-   **Bounded retention:** transcript text is retained for the two newest transcript-bearing sessions; older text expires while derived metrics remain.
-   **Fail-closed commercial path:** the product contract is 30 days then $10/month, but payments remain disabled until separately qualified and authorized.

---

## 🛠️ Tech Stack & Architecture

-   **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Zustand.
-   **Backend:** Supabase (Auth, Postgres, Edge Functions).
-   **Infrastructure:** GitHub Actions CI/CD with parallelized sharding and multi-stage audits.
-   **Monitoring:** Sentry (Error Tracking), PostHog (Product Analytics).

## 🗺️ Documentation Map

Before diving deeper, read the [product-release documentation portal](./product_release/README.md).

Current release posture, blockers, and latest workflow evidence live in [product_release/RELEASE_STATUS.md](./product_release/RELEASE_STATUS.md). The canonical document map and archive pointers live in [product_release/README.md](./product_release/README.md).

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
    
4.  **Verify Environment Health (Required):**
    ```bash
    pnpm preflight
    ```
    This script ensures your system meets the strict Node.js, pnpm, and dependency requirements before you start.
    If it fails, follow the "Dead Environment Trap" troubleshooting in `README.md` to stabilize your environment via `pnpm reset:clean`.

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
    STRIPE_SECRET_KEY=sk_test_your-key        # For payment processing
    STRIPE_WEBHOOK_SECRET=whsec_your-secret   # For webhook verification
    SUPABASE_SERVICE_ROLE_KEY=your-role-key   # For admin DB operations
    ```

    > **Commercial activation:** Source support for the 30-day trial and $10/month continuation is kept
    > fail-closed until the separately authorized migration and payment activation sequence completes.

5.  **Run the development server:**
    ```bash
    pnpm dev
    ```

6.  **(Optional) Install Playwright browsers for E2E testing:**
    ```bash
    pnpm pw:install       # Chromium only (faster)
    pnpm pw:install:all   # All browsers
    ```

    If you're a new developer setting up the project, it's highly recommended to run the **Infrastructure Probe** to ensure your local environment is sound:
    ```bash
    pnpm test:infra
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

The `pnpm setup` command executes `pnpm install --frozen-lockfile`, which is the **only** correct way to install dependencies in this project. It forces pnpm to install the exact versions specified in the lockfile, ensuring a reproducible environment. Do not proceed until this script completes successfully. If it fails, follow the "Dead Environment Trap" troubleshooting in `README.md` to stabilize your environment via `pnpm reset:clean`.

## Troubleshooting: The "Dead Environment" Trap
 
**Status:** High Importance for AI Agents & Remote Shards
 
If you find yourself in a state where `node_modules` is missing and `pnpm install` fails due to network or environment restrictions, you are in a "Dead Environment." 
 
### Recovery Steps:
 
1.  **Run the Nuclear Clean**:
    ```bash
    pnpm reset:clean
    ```
    This kills stale processes and wipes all caches without touching your source code.
 
2.  **The "Rebase then Setup" Rule**:
    Never run `pnpm install` immediately after a large rebase if dependencies have changed significantly.
    - `git pull --rebase`
    - `./scripts/git-pull-fix.sh` (This script automates the cleanup and re-install, or use `pnpm reset:git`)
 
3.  **Check TIA Impact**:
    If your tests are not running, verify that your changes are captured in `test-impact-map.json`. If you added a new file, you **must** update this map or the `test:agent` command will skip it.
 
---
 
## How to Test

This project uses explicit `pnpm` commands for daily development, GitHub CI parity, and release-candidate validation. The everyday CI pipeline stays fast and runs from `.github/workflows/ci.yml`; the full RC gate suite is run only at release time or gate-by-gate when a specific risk needs proof.

### Behavioral Integrity Mandate
We have pivoted to **Black-Box Behavioral Testing**. We test user-facing requirements (Accuracy, Privacy, Speed) rather than internal implementation details. Tests target stable `[data-state]` and `[data-action]` attributes, ensuring resilience against CSS/HTML restructuring.

Use `test:*` for development checks, `ci:*` for CI parity/orchestration, and `rc:*` for release-candidate gates.

### Core Commands

| Need | Command | Purpose |
|---|---|---|
| Install exact dependencies | `pnpm setup` | Runs `pnpm install --frozen-lockfile`. |
| Verify local environment | `pnpm preflight` | Checks Node, pnpm, and dependency health. |
| Start local app | `pnpm dev` | Runs Vite with real local development env on port `5174`; use this for manual signup/auth checks. |
| Start mocked test app | `pnpm dev:test` | Runs Vite in mocked test mode on port `5173`; use this only for E2E/test diagnostics. |
| Install Chromium for tests | `pnpm pw:install` | Installs the browser needed by Playwright. |
| Install all Playwright browsers | `pnpm pw:install:all` | Optional broader browser install. |
| Production build | `pnpm build` | Validates production bundle and required env. |
| Test build | `pnpm build:test` | Builds the app for mocked E2E. |
| Preview build | `pnpm preview` / `pnpm preview:test` | Serves an existing build locally. |

### Local Development Modes

| Command | Port | Auth | Use for |
|---|---:|---|---|
| `pnpm dev` | `5174` | Real Supabase | Manual testing, signup/auth checks, tester rehearsal. |
| `pnpm dev:test` | `5173` | Mock auth | Playwright, E2E diagnostics, mocked infrastructure checks. |

Never use `pnpm dev:test` for manual signup testing. Never share `127.0.0.1:5173` URLs with human testers.

The app enforces this in two layers: a pre-spawn environment check blocks invalid mode/auth/port combinations before Vite starts, and a runtime guard renders a full-page local environment error if the launcher is bypassed. Test mode also displays a visible `TEST MODE · MOCK AUTH` badge.

### Development Validation

| Need | Command | Purpose |
|---|---|---|
| Default fast health check | `pnpm test` | Alias for `pnpm test:infra`. |
| Infra probe | `pnpm test:infra` | Quality, unit, test build, and the infra Playwright probe. |
| Unit tests | `pnpm test:unit` | Vitest suite. |
| Edge Function tests | `pnpm test:edge` | Deno tests for Supabase Edge Functions. |
| Mocked E2E | `pnpm test:e2e` | Builds test app and runs Playwright. |
| Full local validation | `pnpm test:full` | Quality, unit, test build, and full mocked E2E. |
| Lint/type/static quality | `pnpm quality` | Lint, TypeScript, and eslint-disable policy. |

### CI Parity

| Need | Command | Purpose |
|---|---|---|
| Local CI orchestrator | `pnpm ci:github` | Runs `scripts/run-ci.mjs --full`. |
| Alias | `pnpm ci:full` | Same as `ci:github`. |
| Alias | `pnpm ci:local` | Same as `ci:github`. |
| Unit shard | `pnpm ci:unit:shard <shard> <total>` | Runs one unit shard, matching GitHub CI shape. |
| CI timing report | `pnpm ci:timing` | Reports CI job timing deltas. |

### Release Candidate Gates

RC gates are not part of the main push/PR pipeline. They are release controls and can be run as a full suite or individually.

Local sandbox `listen EPERM` artifacts are classified as invalid evidence, not product failures and not passes. Re-run those gates from a normal terminal or GitHub Actions for CI-equivalent release evidence.

Glossary: **SAST** is Static Application Security Testing, **DAST** is Dynamic Application Security Testing, and **SCA** is Software Composition Analysis.

| Gate | Command | Purpose |
|---|---|---|
| Full RC suite | `pnpm run audit` | Runs all five RC gates. |
| Full RC suite | `pnpm rc:gates` | Same release gate suite without using the overloaded `audit` word. |
| Gate 1 | `pnpm rc:gate:1:product` | Product truth gate and CI parity. |
| Gate 2 | `pnpm rc:gate:2:sast` | SAST/OWASP code-risk tests. |
| Gate 3 | `pnpm rc:gate:3:dast` | Local and live running-app DAST checks. |
| Gate 4 | `pnpm rc:gate:4:sca` | Critical dependency audit. |
| Gate 5 | `pnpm rc:gate:5:ux` | UX smoke tests. |
| Secret scan only | `pnpm rc:sast:secrets` | Confirms provider secrets are not referenced by frontend runtime files. |
| Local DAST only | `pnpm rc:dast:local` | Mocked app DAST slice. |
| Live DAST only | `pnpm rc:dast:live` | Production/deployed live DAST slice. |

The same gates are available as a manual GitHub workflow: **Release Candidate Gates** (`.github/workflows/rc-gates.yml`).

### Software Quality Metrics (SQM)

Current quality evidence lives in CI artifacts and dated reports indexed by `product_release/EVIDENCE_INDEX.md`. Do not copy volatile test counts, coverage percentages or Lighthouse snapshots into this README. For the quality-evidence taxonomy, targets and release-test interpretation, see [product_release/QUALITY.md](./product_release/QUALITY.md).

### Live, Deploy, Soak, And Ops

| Need | Command | Purpose |
|---|---|---|
| Real Supabase integration slice | `pnpm test:int:local` | Auth, upgrade, and analytics live specs. Requires live credentials. |
| Full local live/system suite | `pnpm test:system:local:headed` | Live Playwright specs with local Chrome/audio constraints. |
| Production canary | `pnpm test:deploy` | Runs production canary specs. |
| Local canary | `pnpm test:deploy:local` | Runs canary specs against local app. |
| Dispatch deploy canary | `pnpm ci:dispatch:deploy` | Starts the GitHub canary workflow. Requires `gh` auth. |
| Backend soak | `pnpm test:soak:api:cloud` | API stress path. Requires live env. |
| UI soak | `pnpm test:soak:ui:cloud` | Playwright soak path. Requires live env. |
| Verify soak users | `pnpm test:soak:verify:local` | Checks live soak test users. |
| Dispatch soak | `pnpm ci:dispatch:soak` | Starts the GitHub soak workflow. |
| Dispatch and wait for soak | `pnpm ci:dispatch:soak:wait` | Starts soak and waits for result. |
| Download Private STT model | `pnpm model:download` | Downloads Whisper model assets. |
| Benchmark Private | `pnpm benchmark:whisper` | Node CPU Private STT benchmark. |
| Benchmark browser STT | `pnpm benchmark:browser` | Browser Native/Private benchmark specs. |

### Debugging And Recovery

| Need | Command | Purpose |
|---|---|---|
| Playwright UI/debug mode | `pnpm exec playwright test --ui` | Interactive Playwright debugging. |
| Headed E2E | `pnpm exec playwright test --headed` | Headed browser run. |
| Clear test/build caches | `pnpm reset:cache` | Non-destructive test-audit clean. |
| Nuclear local cache clean | `pnpm reset:clean` | Kills stale processes and clears caches. |
| Rebase/pull recovery | `pnpm reset:git` | Runs the repository pull-fix helper. |

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the `scripts/test-audit.sh` script. This ensures perfect consistency between the developer environment and the CI environment.

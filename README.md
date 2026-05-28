**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06

# SpeakSharp v0.6.18 (SpeechRuntime Stabilized)
**v0.6.18 (SpeechRuntime Stabilized)** | **Last Updated: 2026-05-06**

- **Phase 8: SpeechRuntime Stabilization (v0.6.18):** **Deterministic Engine Signaling**.
    - **Token-First warmUp Pattern**: Implemented safe, enqueued re-initialization in `SpeechRuntimeController.updatePolicy` to eliminate race conditions during tier-switch hydration.
    - **MockEngine Signaling Hardening**: Explicitly triggered connection status events in `MockEngine` to satisfy E2E signal chains.
    - **FSM Transition Expansion**: Allow `RESET_REQUESTED` from all active/idle states to ensure deterministic recovery.
    - **Test Precedence Sync**: Aligned all test assertions with v0.6.0 Negotiator precedence logic (User Preference > Policy Default).

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

### 🎙️ Core Features

-   **Triple-Engine Transcription:** 
    -   **Private Mode:** Recommended Pro default. On-device processing via WebGPU first, then CPU/Transformers.js, with browser-managed model caching for maximum privacy and zero variable STT cost.
    -   **Cloud Mode:** First-class Pro option for high-fidelity AssemblyAI Streaming with user word boosting.
    -   **Native Mode:** Browser Web Speech API baseline and final fallback when Private cannot initialize.
-   **Advanced Vocal Analytics:**
    -   **Adaptive Noise Floor:** Intelligently filters background noise to provide precision pause detection.
    -   **Rolling WPM:** Smooth, 15-second rolling window for real-time speaking pace feedback.
    -   **Optimal Pace Targeting:** Real-time guidance toward the 130-150 WPM professional standard.
-   **Session History & Insights:** 
    -   Interactive dashboards with streak tracking.
    -   AI-powered speaking tips and clarity scores.
    -   Detailed PDF report export for every session.
-   **Production Grade:** Full Sentry monitoring, PostHog product analytics, and Stripe payment integration.
-   **Integration & Metering Hardening (Mar 2026):** **3-PR Integration Baseline**.
    -   **SQL Extraction (PR #732):** Atomic session creation and hardened usage metering in the database layer.
    -   **Tier Limits (PR #731):** Dynamic `tier_configs` enforcement with strict concurrency protection.
    -   **3-Layer Runtime (PR #729):** Resilient STT hierarchy (WebGPU -> WASM -> Native) with model loading progress.
    -   **Zero-Debt Audit:** 100% pass rate in Vitest (Unit) and Playwright (E2E) suites.
-   **Zero-Debt & Scalability Hardening (Feb 2026):** **"Zero-Debt" & Scalability Baseline**.
    -   **O(1) Live Analytics:** Infinite-duration sessions supported via incremental observer pattern.
    -   **NLP Caching:** 500x faster re-renders for multi-speaker dialog via LRU document cache.
    -   **Atomic Consistency:** Restored row-locking prevents usage limit bypass under high concurrency.
    - **Concurrent PDF Parsing (PR #735):** ~90% reduction in extraction latency via `Promise.all` orchestration.
- **v0.6.0 Finalization (Apr 2026):** **Deterministic Bridge Baseline**.
    - **T=0 Bridge Reset:** Mandatory reset of bridge signals on page load to eliminate "Bridge Drift."
    - **isEngineInitialized Signal:** Verified unambiguous engine-level synchronization for flake-free E2E runs.
    - **Zero-Regress Audit:** Achieved 100% deterministic green status for the Infrastructure Probe.
- **Mar 2026 Stabilization Audit (v0.6.0):** **High-Fidelity Contract Baseline**.
    - **Deterministic STT Infrastructure:** Achieved 100% contract compliance via `STTEngine` unification.
    - **Environment Bridge (Strangler Pattern):** Centralized environmental logic in `TestFlags.ts` with logic-free projection in `env.ts`.
    - **Industrial Alias Resolution:** Synchronized Vitest with `tsconfig.json` paths via `vite-tsconfig-paths`.
    - **Monotonic Readiness:** Replaced `networkidle` with explicit `data-route-ready` DOM signals.
    - **Strict Zero Manifest:** Implemented `window.__SS_E2E__` as the synchronous source of truth for all environment flags.
    - **Telemetry Decoupling:** Implemented `AnalyticsBuffer` (Queue + Flush) for non-blocking boot performance.
    - **Observability Hardening:** CI-blocking console error detection and global exception escalation.

---

## 🛠️ Tech Stack & Architecture

-   **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Zustand.
-   **Backend:** Supabase (Auth, Postgres, Edge Functions).
-   **Infrastructure:** GitHub Actions CI/CD with parallelized sharding and multi-stage audits.
-   **Monitoring:** Sentry (Error Tracking), PostHog (Product Analytics).

## 🗺️ Documentation Map

Before diving deeper, read [docs/OUTLINE.md](./docs/OUTLINE.md) for the documentation map.

Current release posture, blockers, and latest workflow evidence live in [product_release/RELEASE_STATUS.md](./product_release/RELEASE_STATUS.md). The release-doc inventory and archive pointers live in [product_release/content_list.md](./product_release/content_list.md).

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
    ASSEMBLYAI_API_KEY=your-assemblyai-key    # For cloud transcription
    STRIPE_SECRET_KEY=sk_test_your-key        # For payment processing
    STRIPE_WEBHOOK_SECRET=whsec_your-secret   # For webhook verification
    SUPABASE_SERVICE_ROLE_KEY=your-role-key   # For admin DB operations
    ```

    > **Trial Access:** New accounts receive an automatic one-hour Pro trial through the database entitlement layer. No tester code or admin secret is required. Cloud STT remains paid-Pro only to avoid provider costs during trial testing.

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
| Start local app | `pnpm dev` | Runs Vite in test mode on port `5173`. |
| Install Chromium for tests | `pnpm pw:install` | Installs the browser needed by Playwright. |
| Install all Playwright browsers | `pnpm pw:install:all` | Optional broader browser install. |
| Production build | `pnpm build` | Validates production bundle and required env. |
| Test build | `pnpm build:test` | Builds the app for mocked E2E. |
| Preview build | `pnpm preview` / `pnpm preview:test` | Serves an existing build locally. |

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

This section provides an up-to-date snapshot of the project's software quality. Local runs print SQM to the console; GitHub CI owns the automated PRD metrics update.

Current release evidence lives in `product_release/` and GitHub Actions run artifacts. Do not treat old README timing/count snapshots as release proof.

**Lighthouse Scores** (2026-05-06 local audit):
- **Performance:** 87-90%
- **Accessibility:** 100%
- **Best Practices:** 78%
- **SEO:** 91%
- **Policy:** Lighthouse runs locally and in GitHub, but its threshold policy still needs final release tuning because Performance varies around the current 90% target.

For detailed test metrics, coverage, and E2E results, see the latest [PRD.md Software Quality Metrics](./docs/PRD.md#software-quality-metrics-sqm) section.

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
| Benchmark Cloud | `pnpm benchmark:cloud` | AssemblyAI benchmark. |
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

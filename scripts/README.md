# 📜 Package Scripts – Documentation

These scripts are the single source of truth for all developer and CI workflows. Use them instead of ad‑hoc commands to keep the environment consistent.

| Script | Description |
|--------|-------------|
| `setup` | Install dependencies with a frozen lockfile. |
| `dev` | Run the Vite dev server (frontend only). |
| `prebuild` / `prebuild:test` | Validate required environment variables. |
| `build` / `build:test` | Create a production or test build. |
| `preview` / `preview:test` | Serve the built app locally (prod or test). |
| `lint` | Run ESLint across source and test files. |
| `lint:fix` | Run ESLint with `--fix` to automatically fix lintable issues. |
| `typecheck` | Run TypeScript type‑checking (`tsc --build`). |
| `test` / `test:unit` | Run unit tests with Vitest (fast feedback). |
| `test:all` | Full CI simulation (`./scripts/test-audit.sh local`). |
| `test:health-check` | Quick health‑check: preflight + lint + type‑check + unit tests + minimal E2E smoke suite. |
| `check-in-validation` | Run the full CI pipeline (`./scripts/test-audit.sh ci-simulate`). Use before pushing to remote. |
| `test:e2e:install-browsers` | Install Playwright browsers with dependencies. |
| `test:e2e:ui` | Launch Playwright UI mode for interactive debugging. |
| `test:e2e:debug` | Run Playwright headed with trace collection. |
| `test:soak` | Long‑running soak test (1‑minute audio stream) to catch memory leaks or hangs. |
| `prepare` | Install Husky git hooks. |
| `postinstall` | Install Playwright browsers with dependencies. |
| `test:e2e:health` | Alias for the health‑check E2E suite. |

> **Note:** The scripts are defined in `package.json` under the `"scripts"` field. This README provides a quick reference for developers and CI pipelines.

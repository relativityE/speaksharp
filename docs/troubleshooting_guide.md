# Troubleshooting Guide – SpeakSharp

This guide provides quick, actionable steps for developers and CI engineers when encountering common errors or failures in the SpeakSharp codebase.

## 1. Build / Environment Variable Errors
- **Symptom**: `pnpm run dev` or CI fails with a missing environment variable.
- **Cause**: Required env var not defined in `.env` or `.env.example`.
- **Resolution**:
  1. Run `node scripts/validate-env.mjs` locally to see the missing variables.
  2. Copy `.env.example` to `.env` and fill in the missing values.
  3. Re‑run `pnpm install --frozen-lockfile` and then `pnpm dev`.

## 2. Linting Errors – Unused Catch Variables
- **Symptom**: ESLint reports `no-unused-vars` in a `catch (err)` block.
- **Resolution**: The ESLint config now allows unused catch variables via:
  ```js
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
  ```
  If you still need to silence a specific line, prefix the variable with an underscore (`_err`).

## 3. Supabase Authentication Failures
- **Symptom**: Tests fail at login or API calls return `401`.
- **Resolution**:
  1. Ensure the Supabase URL and anon key are set in `.env`.
  2. Verify the mock Supabase client (`src/lib/mockSupabase.ts`) is being used in the test environment (`process.env.NODE_ENV === 'test'`).
  3. If using the real Supabase instance, check that the OTP has not expired (default < 1 hour).

## 4. Playwright / E2E Test Timeouts
- **Symptom**: CI reports `TimeoutError` during E2E runs.
- **Resolution**:
  1. Confirm the preview server is running on the expected port (`4173`).
  2. Increase the timeout in `tests/e2e/helpers.ts` if the page needs more time to load:
     ```ts
     await page.waitForLoadState('domcontentloaded');
     await page.waitForTimeout(2000);
     ```
  3. Verify that `pnpm exec playwright install --with-deps chromium` succeeded.

## 5. Lighthouse CI Failures
- **Symptom**: `lhci autorun` fails or performance score is below target.
- **Resolution**:
  1. Ensure the preview server is reachable (`http://localhost:4173`).
  2. Run Lighthouse locally: `npx lhci collect && npx lhci upload` to see detailed audit results.
  3. Follow the performance‑optimization checklist in `docs/ROADMAP.md` (image lazy‑loading, code‑splitting, etc.).

## 6. Unexpected Application Crashes
- **Symptom**: The app throws an uncaught error in the console.
- **Resolution**:
  1. Check `frontend/src/lib/logger.ts` for the stack trace.
  2. Search the error message in the codebase (`grep -R "<error message>"`).
  3. If the error originates from a third‑party library, verify the library version matches the one in `package.json`.

## 7. CI Artifact Missing
- **Symptom**: GitHub Actions cannot find `frontend/dist` or test metrics.
- **Resolution**:
  1. Ensure the `prepare` stage runs successfully (`./scripts/test-audit.sh prepare`).
  2. Verify the `artifacts` directory is uploaded (`actions/upload-artifact`).
  3. Check the `download-artifact` steps in downstream jobs.

---
**When in doubt**, open an issue on the repository with the error logs and reference this guide. The engineering team will prioritize fixes based on severity.

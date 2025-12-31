# Troubleshooting Guide

This guide documents common issues encountered during development and testing of SpeakSharp, along with their resolutions.

## E2E Testing & Infrastructure

### 🔄 Environment Sync: "Configuration Required" Page
- **Issue:** The app shows "Configuration Required" even when environment variables seem correct.
- **Root Cause:** Building the app with `pnpm build` instead of `pnpm build:test` for local E2E validation. The standard build optimizes away E2E mocks.
- **Resolution:** Run `pnpm build:test` followed by `pnpm preview:test` to ensure the environment is correctly initialized for testing.

### 🧪 E2E Mock Property Mismatches
- **Issue:** E2E tests fail with 400 errors or handle responses incorrectly despite the mock being "hit".
- **Root Cause:** Property name mismatch between the frontend service and the Playwright mock handler (e.g., `url` vs `checkoutUrl`, or `code` vs `promoCode`).
- **Resolution:** 
  1. Check browser console logs for `[E2E Mock]` debug info.
  2. Verify the exact property names in the `frontend/src/` service calls and ensure the mock in `tests/e2e/mock-routes.ts` returns the identical JSON structure.
  3. Example: `stripe-checkout` expects `{ checkoutUrl: string }`, not `{ url: string }`.

---

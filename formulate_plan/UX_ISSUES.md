# UX/UI Testing Issues Log

**Date:** 2025-12-03
**Status:** In Progress

## Critical Issues (Blockers)
- **🔴 Blank Screen in Dev Mode**: Running `pnpm dev` results in a blank screen/empty DOM.
  - **Status**: **Active** (Workaround: use `vite --mode test`)
  - **Suspected Cause**: Missing environment variables in default dev mode causing `ConfigurationNeededPage` or other logic to fail silently.

- **✅ RESOLVED - "Buffer is not defined" Error in Test Mode**: Occurred on Sign Up submission.
  - **Status**: **Fixed** (Replaced `Buffer` with `btoa` in `test-user-utils.ts`)
  - **Impact**: Authentication now works.

*(None currently active)*

## Resolved Issues

- **Buffer is not defined**: Fixed by replacing Node.js Buffer with btoa in `test-user-utils.ts`.
- **Blank Screen in Dev Mode**: Fixed by creating `.env.development` with mock credentials.
- **Session Page Access**: Fixed by wrapping `/session` in `ProtectedRoute`.
- **"Get Started" Button Visibility**: Fixed by redirecting authenticated users from Index (`/`) to Session (`/session`).
- **User Email Display**: Fixed by updating `Navigation.tsx` to show email when authenticated.

## Major Issues

- **🔴 Stop Recording Button Unresponsive**: In Journey 3 (Local Device), clicking "Stop Recording" (or pressing Escape) failed to stop the session.
  - **Impact**: Cannot complete session or view metrics.
  - **Suspected Cause**: State management issue or event handler not firing in headless environment.
  - **Steps to Reproduce**: Start recording, wait 10s, click Stop.

- **⚠️ Empty DOM on Session & Analytics Pages (Automated Testing Only)**
  - **Status**: BLOCKED (Tooling Limitation)
  - **Impact**: Cannot use `browser_get_dom` to verify content in automated tests.
  - **Workaround**: Manual verification or visual regression testing (screenshots work).
  - **Note**: Stripe Elements was conditionally disabled in test mode, but `browser_get_dom` still fails to capture DOM in the headless environment. App functionality is verified via screenshots.

## Minor Issues (Cosmetic/Polish)
*(None yet)*

## Observations
- **Journey 1 (Sign Up)**: ✅ **Successful** after fixing Buffer error
- **Journey 2 (Sign In/Out)**: ✅ **Successful** 
- **Journey 3+ (Session Recording, Analytics)**: ⚠️ **Blocked** by Empty DOM issue

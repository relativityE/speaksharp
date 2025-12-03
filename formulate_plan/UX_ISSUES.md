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

## Major Issues (Functionality/UX)
- **🔴 Stop Recording Button Unresponsive**: In Journey 3 (Local Device), clicking "Stop Recording" (or pressing Escape) failed to stop the session.
  - **Impact**: Cannot complete session or view metrics.
  - **Suspected Cause**: State management issue or event handler not firing in headless environment.
  - **Steps to Reproduce**: Start recording, wait 10s, click Stop.

- **⚠️ Empty DOM on Session & Analytics Pages**: `browser_get_dom` returns empty on `/session` and `/analytics`, preventing automated interaction.
  - **Impact**: Blocks automated testing of session features and analytics.
  - **Suspected Cause**: Cross-origin iframe (Stripe) interference or security error in headless browser.
  - **Workaround**: Manual testing required.

## Minor Issues (Cosmetic/Polish)
*(None yet)*

## Observations
- **Journey 1 (Sign Up)**: ✅ **Successful** after fixing Buffer error
- **Journey 2 (Sign In/Out)**: ✅ **Successful** 
- **Journey 3+ (Session Recording, Analytics)**: ⚠️ **Blocked** by Empty DOM issue

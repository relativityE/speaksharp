# fix(ci): restore signup canary runner compatibility

## Deliverable
Confirm the signup canary runner failure and prepare a bounded Ubuntu 24.04 pin for Playwright-installing canary jobs with guard tests.

## Expected outcome
The canary can reach its signup proof rather than fail before execution on an unsupported runner, without weakening checks.

## Implementation and acceptance
Verify run 43428299133 and ownership of canary.yml including unpublished changes. Identify every Playwright-installing job, pin only necessary jobs and test negative controls. Live canary dispatch including account creation and deletion needs separately verified authorization. No live execution, merge or deployment implied.

Status: draft scope only, no implementation or qualification claimed. Maintain one-writer boundaries; final code, tests, exact-head review and CI required before any merge. This document does not authorize a production action.

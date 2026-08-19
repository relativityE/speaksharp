# P0-04 — Session, Analytics, PDF, Progress, and filler correctness

## Outcome
The deployed Practice Loop presents one internally consistent review and comparison experience.

## Required implementation
- Derive filler headline, chips, and persisted map from one authoritative finalized snapshot.
  - `{}` means measured zero.
  - `NULL` means unavailable.
  - displayed total equals the sum of displayed approved filler entries.
- Clear finalization UI when the controller reaches READY; clear save-candidate state after a successful save.
- Render exactly one valid next action for every completed session; never count an integrity-error panel as an action.
- Show retained transcript on exact-session Analytics review.
- Generate a transcript-bearing PDF only while that transcript is retained.
- Use one **Open** action in Recent Sessions; put **Download PDF** inside the opened report.
- Comparable Progress copy must distinguish:
  1. current session ineligible, with deterministic reason;
  2. first eligible session establishing baseline;
  3. eligible comparison with supporting change.
- Do not promise a percentage for runs below the eligibility floor.

## Acceptance evidence
- Regression: `0 fillers` cannot coexist with `so ×1`.
- Regression: terminal banner cannot remain after READY.
- Regression: successful save clears candidate/draft state.
- Retained review and PDF contain the correct session transcript; expired review remains metrics-only and says why.
- Two same-cohort eligible sessions (>=30 seconds and >=75 words) produce comparison evidence; short runs explain ineligibility.
- One Open button and one in-view download control.
- Unit, integration, E2E, accessibility, and exact-head full CI green.

## Human qualification
After deployment, run three same-cohort Private sessions, each >=35 seconds and >=90 words, under the exact-release CDP harness.

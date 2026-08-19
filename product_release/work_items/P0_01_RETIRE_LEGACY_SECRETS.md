# P0-01 — Retire legacy secret names

## Outcome
GitHub and the tracked repository contain no active or literal references to the retired Basic/canary credential aliases.

## Required implementation
- Capture a names-only `gh secret list` and `gh variable list` preflight; never print values.
- Delete the confirmed retired repository secrets:
  - `BASIC_TEST_EMAIL`
  - `BASIC_TEST_PASSWORD`
  - `STRIPE_BASIC_PRICE_ID`
  - `STRIPE_LIVE_BASIC_PRICE_ID`
- Do not delete or rename current `FREE_TEST_*`, `PRO_TEST_*`, `CANARY_TRIAL_*`, `CANARY_PAID_*`, Stripe test-mode, Supabase, or deployment credentials.
- Remove literal retired names from active documentation and source.
- Construct forbidden names from fragments inside the regression guard so the guard does not violate its own zero-literal contract.
- Make `scripts/retired-secret-names.mjs --check` compare configured names with the retired-name set without reading values or mutating GitHub.

## Acceptance evidence
- Before/after names-only inventories attached to the PR.
- Post-delete `gh secret list` contains none of the four names.
- Repository-wide literal scan is zero for `BASIC_TEST_` and `CANARY_PASSWORD`; archive treatment is stated explicitly.
- Current workflow secret/variable consumers are enumerated and unchanged.
- Focused guard tests and exact-head CI green.
- No secret values appear in logs, comments, artifacts, or commits.

## Boundaries
Deleting repository secrets is a protected configuration mutation. Execute only under the Product Owner's explicit authorization and report exact names deleted. No unrelated credential rotation or billing activation.

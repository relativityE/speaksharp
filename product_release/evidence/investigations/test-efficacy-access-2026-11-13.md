# Investigative plan: efficacy, access and test inventory

Status: investigation only; no conclusions or implementation accepted. 2026-11-13.

## Deliverable
An evidence-backed report and prioritized, separately reviewable remediation PRs for the findings below, with exact current commit, reproducible commands, raw results, limitations, owners and links to existing work.

## Expected outcome
Akin can distinguish intended full-feature one-month trial access from unauthorized access, understand what test efficacy measurements actually establish, and choose safe corrective work without losing existing protections.

## Investigations and acceptance

1. Trial and paid access: map new signup, active one-month full-feature trial, expiration, paid subscription, explicit grants, cancellation and renewal. Inspect current effective SQL definitions, callers, RLS and grants, and Focus capability checks. Reproduce the reported missing-subscription-ID mutant with exact patch, test selection and restoration hashes. Distinguish trial access from paid-subscription access. Report what is proven, unknown and potentially reachable; do not claim exploit or safety without evidence. Link #1817 F01/F07 and #1795; coordinate with the separate entitlement work.
2. Mutation claims: preserve the underlying report and raw Stryker results for Progress, Focus and remaining analysis/coaching/privacy/save groups. Document sampled modules, selected tests, denominator, timeouts, equivalent mutants and limits. Verify the 70.4% and 68.1% figures and do not generalize them to all product defects.
3. Test inventory: reproduce counts of cases/files executing product code, reading repo files, or testing infrastructure; categories may overlap. Identify which protections text/contract tests provide. Report accurate denominators, examples and prioritized gaps rather than equating absence of imports with uselessness.
4. False greens and cleanup: verify silent returns, skipped and uncollected tests, missing assertions and purported dead code. Design candidate guards with valid throw/contract-test controls and exceptions. Inventory check and branch-protection dependencies before proposing any CI reduction or deletion; preserve substantive merge, security and product protections. Changes require separate PRs.
5. STT: #1760 and #1801 are merged foundations, not open work. Link them when proposing a new separate investigation or experiment PR. Preserve real repeated words/fillers, representative long recordings, comparable app/evaluator inputs and no default-model change without a separate decision.

## Boundaries
Read-only investigation by default. No production mutation, live account creation/deletion, payments, migration, deployment, security or permissions changes, gate bypass or merge. Respect existing file ownership and preserve unpublished work. Production data access and live test actions require applicable approvals. Partial results and unknowns must be explicit.

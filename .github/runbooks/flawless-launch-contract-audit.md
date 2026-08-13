# Flawless-launch product-contract audit remediation

> Temporary PR #1290 implementation and closure packet. This runbook is not product authority and
> must be reconciled into the canonical documentation set at the final accepted checkpoint.

## Purpose

This document is the scope and closure contract for the dedicated audit-remediation PR. It prevents the cross-repository corrections from expanding PR #1282 beyond its original trial-and-billing ticket.

## Locked customer contract

- SpeakSharp is one Private Practice product.
- A new account receives the complete product for 30 days.
- The same product continues for exactly $10/month (1,000 cents).
- There is no permanent feature-limited Free product and no five-minute Private sample.
- Private is not a paid differentiator; active-trial and paid users receive the same customer functionality.
- No daily or monthly accumulated-minute entitlement limit may deny or auto-stop an active-trial or paid user.
- The existing 10-minute (600-second) maximum per individual recording remains as a technical safety bound. It applies identically to trial and paid users, safely finalizes the current recording, permits a new recording immediately afterward, and is never a quota or upsell trigger.
- Customer engine entitlement is Private only. Browser and Cloud are not customer entitlements. Native remains an internal deterministic E2E hook only.
- Expired users retain read, export, history, Progress, account, billing-management and upgrade access, but cannot create, save or analyze new recordings.
- Payments remain fail-closed until separately activated.

## Boundary with PR #1282

PR #1282 remains responsible only for its original ticket contract:

1. immutable new-account 30-day grant and authorized one-time legacy activation;
2. server-authoritative before/exact/after-expiry behavior and the expired-user permission matrix;
3. exact $10 monthly checkout validation, first-checkout identity binding, and accepted #1287 webhook-snapshot consumption;
4. paid continuity/lapse handling; and
5. the canonical Private-only entitlement result used by the application.

This audit PR must consume those accepted seams. It must not duplicate #1282's trial clock, checkout binding, webhook lifecycle, activation stamp or expiry architecture.

## Audit-remediation scope

### Runtime and persistence

- Retire the five-minute Private-sample concept from active runtime authority.
- Remove sample countdowns, sample prompts, sample-specific errors, sample telemetry and sample branches.
- Make legacy sample columns inert compatibility/telemetry data or retire them through a safe converging migration; never rewrite migration history.
- Remove daily/monthly accumulated-minute denial and auto-stop authority for active-trial and paid users.
- Usage totals may remain content-free telemetry only.
- Preserve and directly prove the shared 600-second per-recording safety stop.
- Remove customer Cloud/Browser entitlement and fallback behavior.
- Keep Native inaccessible to customers and reachable only through the explicit internal E2E seam.

### UI and customer copy

- Replace the live root-page five-minute offer with the complete 30-day product.
- Remove permanent-Free, expanded-limit, recording-time-upsell, Cloud-upsell and Private-upsell language.
- Present trial as a trial, not as paid Pro.
- Make expired-state messaging match the retained-access matrix.
- Reconcile routed pages, reusable/dead marketing components, navigation, dialogs, analytics empty states, accessibility labels and metadata.

### Billing consistency outside #1282

- Change repository price audits, workflow expectations and launch documents from 999 cents/$9.99 to exactly 1,000 cents/$10.
- Remove Basic as a current/future launch-product requirement unless it is explicitly quarantined as non-launch historical material.
- Keep billing fail-closed and do not activate payments.

### Workflows and operational gates

- Remove or rewrite required/default lanes that enforce Browser-first, Private-sample, Cloud-Pro, Native-as-product or finite aggregate quotas.
- Reclassify Cloud/provider benchmarks as optional internal research, never customer entitlement or GO evidence.
- Reconcile the Edge deployment manifest so obsolete customer Cloud infrastructure is not a release prerequisite.
- Replace the current canary contract with:
  1. a primary active-trial Private journey; and
  2. a secondary genuine paid-continuation Private journey.
- No required workflow is allowed to fail. Deprecated lanes must be removed from the required/default graph rather than accepted red.

### Tests and mocks

- Replace Free/Basic/Pro feature-tier fixtures with trial-active, paid, expired and terminal-lapse lifecycle fixtures.
- Remove sample and accumulated-quota expectations.
- Remove customer Cloud/Browser/Native switching expectations.
- Strengthen the public-copy scanner to reject five-minute/session/trial synonyms, Browser/Cloud customer claims, quota upsells, $9.99/999-cent launch pricing and permanent-Free claims.
- Make E2E mocks use the same server-authoritative entitlement shape as production.

### Documentation

Reconcile README, USER_GUIDE and every current product_release contract, tester guide, operational checklist, release gate, inventory and ledger. Old sample/Cloud/Browser/quota evidence may remain only when prominently classified as historical and excluded from current policy and GO gates.

## Required closure evidence

The exact review head must provide a closure matrix covering all of the following:

1. Active-trial and paid accounts can record, save and analyze despite exhausted legacy sample fields.
2. Active-trial and paid accounts can record, save and analyze above the former 1h/2h daily and 50h monthly thresholds.
3. Only entitlement expiry or terminal paid lapse blocks new record/save/analyze.
4. The 600-second per-recording bound safely finalizes for both lifecycle states and immediately permits another recording.
5. Customer entitlement is exactly Private; Browser, Cloud, Native, provider names, aliases and model variants are rejected.
6. The actual `/` route communicates the complete 30-day product and contains no retired offer.
7. Trial UI is not presented as paid Pro; expired access matches the retained-access matrix.
8. Repository price audits and customer/operations copy require exactly $10/1,000 cents.
9. Primary active-trial and secondary paid-continuation canaries pass at the deployed merge SHA.
10. Unit, controller, E2E, contract, copy-scanner, build, typecheck, lint, U3, SCA and all required CI workflows are terminal green.
11. Any new/converging database contract passes replay plus disposable PostgreSQL 15/16/17.
12. A zero-reference scan proves no active customer/runtime/release-gate references remain for the retired sample, quota, Browser/Cloud entitlement or $9.99 product. Historical evidence is separately enumerated.
13. A visual desktop/mobile pass covers root acquisition, trial-active recording, the 10-minute safety stop, paid continuity and expired-state retained access.

## Sequencing and safety

- This PR is an independent draft implementation carrier and does not alter #1282's acceptance boundary.
- Dependency-safe UI, test, workflow and documentation slices may proceed now.
- Before exact-head review, rebase once onto the accepted post-#1279/post-#1282 main and remove any superseded compatibility work.
- Do not merge this PR before #1282's accepted entitlement seam is on main.
- Merge, deployment, migration, billing activation, production dispatch, issue closure and tagging remain separately authorized operations.
- Stop editing at a coherent terminal-green head and request independent PM review with a binary ACCEPT/RETURN closure matrix.

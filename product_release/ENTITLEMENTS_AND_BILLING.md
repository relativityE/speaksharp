## Account-exit policy boundary

Routine deletion is account-scoped, as confirmed in [#1643 policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298). Page navigation or email issuance is not destructive confirmation. Verified explicit confirmation records durable pending intent for that account, prevents new admission, and allows already accepted saves, coaching and billing work to finish and reconcile. Unknown outcomes remain pending: neither elapsed timeout nor an accepted request establishes settlement or deletion. Only verified DB/storage/Auth final state supports a deleted result. Other users continue normally; routine deletion requires no global shutdown.

Cancellation is distinct: preserve account/login/history and verified remaining access while stopping renewal under the actual provider outcome. Cancellation alone schedules no deletion. Existing runtime generation/configuration and operational guards remain implementation prerequisites until a reviewed replacement is integrated; this policy does not remove them or invent global worker termination. The bounded legacy direct-checkout cutover still needs its own reconciliation. Backend staging or202 pending is not a completed customer journey, and source preparation authorizes no account/provider operation.

**Status:** Authoritative product contract
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-15 — the 30-day/$10 single-product contract remains unchanged; #1475 is the sole landing-page implementation owner.
**Applies To:** Private Practice Loop commercial launch
**Class:** Entitlement and billing policy
**Authority:** Product terms, commercial access, expiry permissions, Private-only customer entitlement, and activation boundaries.
**Not Authoritative For:** Current implementation, deployment, migration, activation, qualification, or GO/HOLD status (→ `RELEASE_STATUS.md`).
**Supersedes:** The former Free/Pro feature-tier, external-transcription, one-shot, and accumulated-minute policy in this file.
**Evidence Sources:** Product Owner contract for #1266/#1282/#1290; executable proof remains required before release acceptance.

<!-- pm-currentization:2026-09-15 -->
> [!IMPORTANT]
> **Currentized 15 Sep 2026 — no policy change.** SpeakSharp remains one complete product free for 30 days, then $10/month. Candidate selection, AI-review recovery, filler completeness, and RWT work may not create a customer tier or quota gate. #1475 is the sole implementation owner for the approved landing/pricing presentation; payment activation and any live commercial action remain separately authorized.
<!-- /pm-currentization:2026-09-15 -->

# SpeakSharp Entitlements and Billing

Historical #1475 ownership references above do not assign a current writer. Its
unfinished landing, payment-state, route, telemetry and accessibility acceptance is
preserved in the [#1674 receiving contract](https://github.com/relativityE/speaksharp/pull/1674#issuecomment-6459850817).
Paid-user, cancellation/expiry, portal and complete account-exit journeys remain
separate acceptance obligations; neither planning-workbook arithmetic nor a source
merge proves them. Current observations belong in `RELEASE_STATUS.md`.

This document defines product authority. It does not authorize a merge, migration, deployment, commercial
trial stamp, payment activation, production mutation, or charge.

## One product

SpeakSharp is one Private Practice product:

- every customer recording uses on-device Private STT;
- Open Mic is primary and Focus Points is optional guidance;
- Native is an isolated internal deterministic E2E hook, never a customer entitlement;
- no external transcription provider is a customer entitlement or fallback.

## Commercial contract

- A new account receives the complete product free for **30 days**.
- After 30 days, the same product costs **$10/month**.
- Trial and paid accounts receive the same product capabilities. This includes **Focus Points**: its server
  capability (`has_objective_capability()`, 20260928120000) grants an active trial by the same rule as the
  canonical entitlement (immutable trial grant marker and an unexpired server-side window), besides paid Pro and
  explicit per-account grants. An expired trial is refused.
- There is no permanent feature-limited free product.
- There is no accumulated daily or monthly recording-minute gate for an active trial or paid account.
- Usage counters may remain as content-free telemetry but cannot deny or auto-stop an entitled recording.
- Each individual recording retains a **ten-minute technical cap**. This is a runtime safety boundary, not a
  commercial quota.

## Server authority and expiry

The database is authoritative for commercial time and entitlement. Client time, copy, cached profile state,
and raw tier labels cannot extend access.

At exact expiry, an unpaid account cannot create, record, save, or analyze a new recording. It retains access
to exact-session reads, History, Progress, PDF/export, account management/deletion, and upgrade.

A paid account remains active while its verified subscription snapshot is entitled. Webhook or checkout
identity uncertainty fails closed and remains retryable. Existing paid users retain billing-management access.

## Trial grant and activation

- The foundation must establish an immutable commercial-trial grant marker before provisioning relies on it.
- New accounts atomically receive one marker and one 30-day server-time window.
- Legacy unpaid accounts remain unmarked until a separately authorized commercial activation.
- That activation grants each eligible legacy unpaid account exactly once from one recorded server timestamp.
- Reruns cannot reset, shorten, or extend a window; paid accounts are untouched.

## Price and checkout

The only approved customer offer is one active recurring Price in the configured currency for exactly
**$10.00**, monthly, with interval count one. Checkout and hydrated subscription identity must match exactly;
missing or uncertain metadata, customer, subscription, or Price facts return non-success so Stripe can retry.

The customer engine allow-list is exactly `ARRAY['private']`. Provider/model names, implementation variants,
Native, and any external transcription path are rejected as customer entitlements.

## Fail-closed activation

Payment availability requires the separately authorized source, database prerequisite, migrations, approved
Price configuration, frontend/backend switches, webhook verification, and launch-window checks. Keys or copy
alone never activate checkout. No source document authorizes a live charge.

## Required launch proof

Executed evidence must cover trial start, immediately before expiry, exact expiry, immediately after expiry,
client-clock tampering, one-time legacy activation, paid continuity, the expired permission matrix, and
Private-only behavior for both trial and paid accounts. Accounts with exhausted historical one-shot fields or
usage above former aggregate thresholds must remain able to record, save, and analyze while entitled and fail
only at server-authoritative expiry.

---

## #1367 reconciliation (2026-08-29)

Four states that must never be reported as one (dated audit: [`DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md`](./evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md) §10.9):

| State | Status |
|---|---|
| Contracted pricing | Defined in this document |
| Implemented Stripe components | Built; checkout → webhook → billing-portal journey proven in **test mode** |
| Activation qualification | **Not activated** — both payment switches on, aligned live configuration, and separate written owner authorization are all required |
| Actual revenue | **None** — the billing freeze forbids live charges in testing |

"Stripe is implemented" therefore does not mean billing is live, and neither implies revenue.

**Competitor pricing must be dated and reverified from an authoritative source before use.**
`research/pricing_analysis.md` carries competitor prices with no visible as-of date and no source citation; it
must not be quoted as current.

<!-- clause-closeout:2026-10-28 -->
## Consolidated predecessor controls and interpretation

### Inherited public-entry and commercial controls

Keep public signup, repeat sign-in and recovery, useful first Private session, immutable trial grant/expiry and client-clock negatives, paid continuation, checkout-to-entitlement persistence across refresh/sign-out, portal access, cancellation, unpaid/past_due/failure handling, duplicate/replayed webhooks and RPC failure handling as distinct acceptance controls. A test-mode journey can establish functional behavior; it does not activate production payments. Activation still requires both payment switches, aligned live configuration and webhook/price/entitlement verification under explicit owner authority. Real-money transactions are not required proof or a launch gate. Historical Free/Basic, Cloud/Native, sample, 2h/day and 50h/month policies are superseded by the current one-product commercial contract, not new exceptions.

### Genuine paid-fixture acceptance boundary

For a separately authorized genuine paid canary, bind the exact profile to nonblank customer/subscription identities and independently read Stripe: that subscription belongs to that customer, is active, and contains the approved active monthly Price, configured currency, 1,000-unit amount and interval count 1. Local profile fields alone are not Stripe authority. Preserve the one-account ceiling and no recording/trial reset or extension. Wrong identity, status or Price, an active conflicting run, or an uncertain response is HOLD. The old #1288 paid-only cutover, 05:00 schedule and immediate-merge sequence are historical; current canary scheduling and trial/test-mode lanes are governed by OPERATIONS_AND_SECURITY. This receipt neither authorizes an entitlement mutation nor activates payments.

### Inherited commercial-remediation acceptance matrix

The #1290 audit contributes controls beyond billing configuration: trial-active and paid fixtures must ignore exhausted legacy sample fields and former accumulated-minute thresholds; only expiry or terminal paid lapse blocks new recording/save/analysis. Both lifecycle states share the 600-second per-recording safety stop and can start again afterward. Entitlement rejects all customer engines except Private. Root-route acquisition, trial labels, expired retained access, dead/reusable marketing surfaces, accessibility labels, exact $10 pricing, and mocks must agree with the server contract. Preserve replay and disposable PostgreSQL 15/16/17 proof for applicable database changes, zero active references to retired policies, desktop/mobile visual evidence and every required CI gate. A deprecated lane must be explicitly retired from the required graph, never waived as an accepted red. Historical migration sequencing and a two-lane every-push canary are superseded by current release and canary controls; source coverage does not close the integrated real-device Practice Loop.

### Historical entitlement-drift interpretation

The old Pro-limit evidence compared a dead Infinity constant with enforcing 7,200s/day and 180,000s/month database paths, then recorded the owner’s #769 consistency fix. That historical quota policy is superseded by the current no-accumulated-minute contract; it must not be revived through a test fixture or copied limit. Its useful audit method remains: follow the actual consuming RPC and latest applicable migration, distinguish dead configuration from enforcement, and separately obtain authorized deployed readback before claiming source equals live state. The historical 20/day AI quota and cached bypass are reported source findings, not a new current price/usage promise. Multiple CREATE OR REPLACE definitions require effective-order analysis; no migration-history rewrite or deployment is authorized here.
<!-- /clause-closeout:2026-10-28 -->

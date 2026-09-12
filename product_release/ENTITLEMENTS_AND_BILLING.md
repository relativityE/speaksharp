**Status:** Authoritative product contract
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-04
**Last Verified:** 2026-09-04 — reconciled to the 4 Sep Production human-test findings and current PO decisions; shipped behavior and approved-not-shipped remedies are distinguished below.
**Applies To:** Private Practice Loop commercial launch
**Class:** Entitlement and billing policy
**Authority:** Product terms, commercial access, expiry permissions, Private-only customer entitlement, and activation boundaries.
**Not Authoritative For:** Current implementation, deployment, migration, activation, qualification, or GO/HOLD status (→ `RELEASE_STATUS.md`).
**Supersedes:** The former Free/Pro feature-tier, external-transcription, one-shot, and accumulated-minute policy in this file.
**Evidence Sources:** Product Owner contract for #1266/#1282/#1290; executable proof remains required before release acceptance.

<!-- pm-currentization:2026-09-04 -->
> [!IMPORTANT]
> **Currentized 4 Sep 2026.** The Production biopsy does not change the 30-day/$10 entitlement contract. Model comparison controls are operator-only runtime configuration on the canonical Production app and never a customer tier, entitlement, paid feature, alternate build, or URL. Product recovery work may not introduce a new commercial gate.

<!-- /pm-currentization:2026-09-04 -->

# SpeakSharp Entitlements and Billing

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
- Trial and paid accounts receive the same product capabilities.
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

# Release Status

**Owner:** Prod Owner (relativityE).
**Last Reviewed:** 2026-07-24
**Last Verified:** 2026-07-24 (baselines verified against `origin/main` via GitHub; `#1006` state verified via GitHub; release mechanism verified in `frontend/vite.config.mjs` + `index.html` per #1027).
**Scope:** Single source of truth (SSOT) for current release/deployment posture. If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational and RC-gate docs; current ship status lives here only.

## Current baseline & production posture

Four distinct identities — do not conflate them:

| Identity | Value | How to verify |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `05643fbd` at last review (`#1030`, read-only audit tooling) | **Moving** — verify the live pointer directly on GitHub (`git rev-parse origin/main`); do not treat this SHA as fixed. |
| **Last product-behavior release** | `c25b2178` (`#1024`, issue-report metadata hygiene) atop `a37a6ba1` (`#1027`, stale-chunk P0: recovery + stable content-hash assets + SPA 404 fallback) and `c99208b9` (`#1022`, `/practice` default entry, Guided unavailable) | Product commits on `main`; each shipped a runtime/product-behavior change. |
| **Later docs/audit/tooling commits (NOT product-behavior deployments)** | `#1028` (`ab46cc84`), `#1029` (`85118374`), `#1030` (`05643fbd`) — read-only tester-evidence audit tooling | These change **no** deployed product behavior; they only add the `workflow_dispatch` audit. |
| **Deployed product release** | Vercel auto-deploys `main`; runtime identity = the exact `window.__APP_RELEASE__` in the deployed `index.html` | Read `window.__APP_RELEASE__` (or `window.__APP_RUNTIME_CONFIG__.release`) from the deployed page. |

**Release-identity mechanism (per #1027):** the deployed `index.html` injects an inline `window.__APP_RELEASE__ = <VERCEL_GIT_COMMIT_SHA>`, surfaced at runtime as `window.__APP_RUNTIME_CONFIG__.release`. The old `__BUILD_ID__` JS `define` was **removed** in #1027 (it rotated chunk hashes every deploy → stale-chunk crashes); Sentry release is set at **runtime** (`release.inject:false`). Verify SHA-equality by reading `window.__APP_RELEASE__` from the deployed `index.html` — see [frontend/vite.config.mjs](../frontend/vite.config.mjs) + [CODEBASE_MAP.md](CODEBASE_MAP.md).

**Historical frozen tag:** `v0.9.0-rc4` (annotated) peels to `df909805…` — a **historical, frozen** release point, **NOT** the current `main`/product baseline.

| Item | Value |
|---|---|
| Deployment | Auto-deploy on push to `main`. Live gate posture is read from the required workflows on `main` (**CI - Test Audit**, **RC Gates** incl. live Gate 3 DAST, **OSV SCA — Gate 4**, **Production Canary**, **Ops Health**, **Billing Freeze**, **DB grant**) — see [RC_GATES.md](RC_GATES.md); do not copy run IDs here. |
| Payments | **Closed.** Billing is independently fail-closed in frontend AND backend — **either switch OFF keeps checkout closed**; the billing-freeze check proves CLOSED. Opening paid enrollment requires ALL of: `VITE_PAYMENTS_ENABLED=true`, `PAYMENTS_ENABLED=true`, aligned live Stripe keys, and webhook/price/entitlement verification. A separate future sequence, not a pending test. |
| CORS | Exact-origin CORS deployed and live-DAST proven (rc-gates Gate 3; allowlist in [backend/supabase/functions/_shared/cors.ts](../backend/supabase/functions/_shared/cors.ts)). |
| Private v4 | **OFF.** `VITE_PRIVATE_STT_V4_DISABLED` hard-kill; primary control is PostHog flags, default off. |

## Current merged product posture
- **`/practice` default entry (#1022):** authenticated home is `/practice` (#1025 hotfix; #1026 canary asserts it); Guided is surfaced-but-unavailable; the rollout flag is retired.
- **Stale-chunk P0 hardened (#1027):** `preloadError` recovery + stable content-hash asset names + SPA 404 fallback; release identity moved to `window.__APP_RELEASE__` (above).
- **Private-first UX (through #1007/#1008, still current):** Private = Recommended/main; **Quick Preview (Browser)** = the free convenience preview (internal engine token remains `native`); Cloud = Pro (unavailable to Free testers in the no-billing beta; existing paid-Pro accounts retain access). One authoritative post-save `StatusNotificationBar`; completion toast / "Next: Analytics" overlay deleted.
- **Issue-report hygiene (#1024):** raw `appRuntimeConfig.url` no longer persisted in report metadata.
- Billing closed, exact-origin CORS hardened, v4 off (as above).

## Beta posture
- **Controlled, invite-only, no-billing beta.** No Cloud for Free testers; v4 off. (No hard-coded tester count here — reconcile any count to the authoritative invitation roster before publishing it.)
- **Tester invitations are gated on the read-only tester-evidence audit (#1030 `workflow_dispatch`).** The audit is HELD pending a Product Owner correction to the `AUDIT_EXCLUDED_EMAILS_JSON` exclusion manifest (a `synthetic` category data issue); it fails closed and publishes no totals until corrected.

## Current open work
- **Documentation canonicalization (PR #1032, unmerged):** establishes the approved 14-canonical-document system + migration ledger + SSOT repair (this file). Governs later consolidation PRs 2–6.
- **Adversarial-review roadmap (sequential):** durable engine-attribution (**OPEN GAP** — proposed fix in unmerged PR #1033, not proven/deployed), central entitlement selector, unified STT evidence harness, PRD v1, Architecture/STT ADRs, Quick Preview (Browser) display-label.
- **#1006 is CLOSED** (draft, not activated) — no longer current work; the durable-delivery/observability remediation is not shipped/deployed/activated.

## Private STT finalization — accepted RC limitation
A full **five-minute single Private (v2 / whisper-base.en) recording finalizes in ≈90 seconds** of post-stop processing — the accepted limitation for the controlled beta, surfaced as honest "Finalizing…" progress. This is an **accepted limitation, not a measured p95**. The earlier `<30s` requirement is obsolete/withdrawn. Faster finalization is a post-limitation improvement lane, not a blocker.

## STT availability by tier

| Engine | Availability | Notes |
|---|---|---|
| Quick Preview (Browser) (Web Speech; internal token `native`) | All tiers (default preview) | Convenience preview; **not** local/offline/on-device (Chrome routes audio to Google); weakest path; never an automatic fallback. Nudge Private after a preview session. |
| Private (v2 / whisper-base.en) | All tiers (local, download on first use) | Default Private engine. v4 WebGPU OFF (`VITE_PRIVATE_STT_V4_DISABLED`; PostHog flags default off). |
| **Cloud (AssemblyAI)** | **Paid Pro only** | Requires real paid Pro entitlement (`stripe_subscription_id`). Not available to Free testers during the no-billing beta; existing paid-Pro accounts retain access. Strongest STT path. |

## Release-track posture

| Track | Status |
|---|---|
| Controlled paid Early Access (enrollment currently disabled for this cohort) | **Underway** — invite-only; paid enrollment disabled (both switches OFF), no Cloud for Free, v4 off. Re-enabling requires the full activation contract + Prod Owner authorization. Any confirmed P0/P1 pauses expansion. |
| Paid public launch (live checkout) | **NO-GO** — requires ALL of `VITE_PAYMENTS_ENABLED=true` + `PAYMENTS_ENABLED=true` + aligned live Stripe keys + webhook/price/entitlement verification. Either switch OFF keeps checkout closed. |
| Broad public launch | **NO-GO** — separately gated. |

## Historical evidence (pointers, not current status)
- **Attribution history sanitation** (2026-07-15): historical SHA crosswalk + provenance in [attribution-sanitation-crosswalk.md](attribution-sanitation-crosswalk.md). Historical PostHog `release_sha` values retain OLD SHAs (immutable telemetry) — correlate via the crosswalk.

## Evidence contract + named STT gate artifacts
The stable **Evidence Freshness Contract** (latest complete passing run; a newer failing run returns the parent gate to red; `Last updated by: [initials] [date] [artifact path]`) and the **Named STT Gate Artifacts** now live in **[RC_GATES.md](RC_GATES.md)**. This file keeps only current run/status posture.

## Update rule
Only this file receives changing release/deployment status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence.

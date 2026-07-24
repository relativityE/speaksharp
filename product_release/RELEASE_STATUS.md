# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Last Verified:** 2026-07-24T17:10:25Z (production `window.__APP_RELEASE__` read read-only from `https://speaksharp-public.vercel.app/` = `05643fbd991a503f8c183a4ac19ab2aa8d2d2f95`, HTTP 200; baselines verified against `origin/main` via GitHub; release mechanism verified in `frontend/vite.config.mjs` + the served `index.html` per #1027). The `#1006` remediation is CLOSED (draft, not activated) — see "Current open work".
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`); documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/` or older files.
**Evidence Sources:** GitHub `origin/main`; the production deployment's `window.__APP_RELEASE__`; the required release workflows (see `RC_GATES.md`).

## Current baseline & production posture

Four distinct identities — do not conflate them:

| Identity | Value | How to verify |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `05643fbd991a503f8c183a4ac19ab2aa8d2d2f95` at last review (`#1030`, read-only audit tooling) | **Moving** — verify the live pointer directly on GitHub (`git rev-parse origin/main`); do not treat this SHA as fixed. |
| **Last product-behavior release** | `c25b2178` (`#1024`, issue-report metadata hygiene) atop `a37a6ba1` (`#1027`, stale-chunk P0: recovery + stable content-hash assets + SPA 404 fallback) and `c99208b9` (`#1022`, `/practice` default entry, Guided unavailable) | Product commits on `main`; each shipped a runtime/product-behavior change. |
| **Later docs/audit/tooling commits (NOT product-behavior deployments)** | `#1028` (`ab46cc84`), `#1029` (`85118374`), `#1030` (`05643fbd991a503f8c183a4ac19ab2aa8d2d2f95`) — read-only tester-evidence audit tooling | These change **no** deployed product behavior; they only add the `workflow_dispatch` audit. |
| **Deployed product release (verified)** | `window.__APP_RELEASE__ = 05643fbd991a503f8c183a4ac19ab2aa8d2d2f95`, read read-only from `https://speaksharp-public.vercel.app/` (HTTP 200) at **2026-07-24T17:10:25Z**. At that check production == `main` HEAD, but this is **not** guaranteed by auto-deploy alone: a Vercel "Ignored Build Step" can leave production behind `main`, so the deployed SHA must be **read**, not inferred. | Re-read `window.__APP_RELEASE__` (or `window.__APP_RUNTIME_CONFIG__.release`) from the deployed page and update the value + UTC timestamp here. |

**Release-identity mechanism (per #1027):** the deployed `index.html` injects an inline `window.__APP_RELEASE__ = <VERCEL_GIT_COMMIT_SHA>`, surfaced at runtime as `window.__APP_RUNTIME_CONFIG__.release`. The old `__BUILD_ID__` JS `define` was **removed** in #1027 (it rotated chunk hashes every deploy → stale-chunk crashes); Sentry release is set at **runtime** (`release.inject:false`). Verify SHA-equality by reading `window.__APP_RELEASE__` from the deployed `index.html` — see [frontend/vite.config.mjs](../frontend/vite.config.mjs) + [CODEBASE_MAP.md](CODEBASE_MAP.md).

**Historical frozen tag:** `v0.9.0-rc4` (annotated) peels to `df909805…` — a **historical, frozen** release point, **NOT** the current `main`/product baseline.

| Item | Value |
|---|---|
| Deployment | Auto-deploy on push to `main`. Live gate posture is read from the required workflows on `main` (**CI - Test Audit**, **RC Gates** incl. live Gate 3 DAST, **OSV SCA — Gate 4**, **Production Canary**, **Ops Health**, **Billing Freeze**, **DB grant**) — see [RC_GATES.md](RC_GATES.md); do not copy run IDs here. |
| Payments | **Closed.** Billing is independently fail-closed in frontend AND backend — **either switch OFF keeps checkout closed**; the billing-freeze check proves CLOSED. Opening paid enrollment requires ALL of: `VITE_PAYMENTS_ENABLED=true`, `PAYMENTS_ENABLED=true`, aligned live Stripe keys, and webhook/price/entitlement verification. A separate future sequence, not a pending test. |
| CORS | Exact-origin CORS deployed and live-DAST proven (rc-gates Gate 3; allowlist in [backend/supabase/functions/_shared/cors.ts](../backend/supabase/functions/_shared/cors.ts)). |
| Private v4 | **OFF.** The `VITE_PRIVATE_STT_V4_DISABLED` build-time hard kill is **authoritative** — when set it disables v4 unconditionally. PostHog flags are a **secondary** rollout control and **cannot override** the hard kill. |

## Current merged product posture
- **`/practice` default entry (#1022):** authenticated home is `/practice` (#1025 hotfix; #1026 canary asserts it); Guided is surfaced-but-unavailable; the rollout flag is retired.
- **Stale-chunk P0 hardened (#1027):** `preloadError` recovery + stable content-hash asset names + SPA 404 fallback; release identity moved to `window.__APP_RELEASE__` (above).
- **Private-first UX (through #1007/#1008, still current):** Private = Recommended/main; the free browser convenience preview = Cloud = Pro (unavailable to Free testers in the no-billing beta; existing paid-Pro accounts retain access). One authoritative post-save `StatusNotificationBar`; completion toast / "Next: Analytics" overlay deleted.
- **STT mode labels (deployed vs approved):** the wording **currently visible in production** for the Web Speech engine is **"Quick preview"** (shipped #1007/#1008). **"Quick Preview (Browser)"** is the **approved** replacement label but is **not deployed** until its UI-copy PR lands. The internal engine token / telemetry / DB value remains **`native`** and is unchanged by either label.
- **Issue-report hygiene (#1024):** raw `appRuntimeConfig.url` no longer persisted in report metadata.
- Billing closed, exact-origin CORS hardened, v4 off (as above).

## Beta posture
- **Controlled, invite-only, no-billing beta.** No Cloud for Free testers; v4 off. (No hard-coded tester count here — reconcile any count to the authoritative invitation roster before publishing it.)
- **Tester invitations are gated on the read-only tester-evidence audit (#1030 `workflow_dispatch`).** The audit is HELD pending a Product Owner correction to the `AUDIT_EXCLUDED_EMAILS_JSON` exclusion manifest (a `synthetic` category data issue); it fails closed and publishes no totals until corrected.

## Current open work
- **Documentation canonicalization (in progress):** establishing the approved 14-canonical-document system + migration ledger + SSOT repair (this file); governs the later consolidation steps. (Track current PR/thread state in the relevant PR, not here.)
- **Adversarial-review roadmap (sequential):** durable engine-attribution (**OPEN GAP** — proposed fix not yet proven/deployed), central entitlement selector (tracked as an issue), STT evidence orchestrator (tracked as an issue), PRD v1, Architecture/STT ADRs, the browser-preview display-label copy change.
- **#1006 is CLOSED** (draft, not activated) — no longer current work; the durable-delivery/observability remediation is not shipped/deployed/activated.

## Private STT finalization — accepted planning budget (not a measured p95)
The **≈90 seconds** of post-stop processing quoted for a full five-minute single Private (v2 / whisper-base.en) recording is an **accepted planning budget / risk allowance** for the controlled beta — **not** an observed production performance fact and **not** a measured p95. It is surfaced to the user as honest "Finalizing…" progress. The earlier `<30s` requirement is obsolete/withdrawn. A measured percentile would need a dedicated instrumentation run (STT evidence lane); faster finalization is a post-limitation improvement lane, not a blocker.

## STT availability by tier

| Engine | Availability | Notes |
|---|---|---|
| Browser preview (Web Speech; deployed label "Quick preview"; approved label "Quick Preview (Browser)"; internal token `native`) | All tiers (default preview) | Convenience preview; **not** local/offline/on-device (Chrome routes audio to Google); weakest path; never an automatic fallback. Nudge Private after a preview session. |
| Private (v2 / whisper-base.en) | All tiers (local, download on first use) | Default Private engine. v4 WebGPU OFF — `VITE_PRIVATE_STT_V4_DISABLED` hard kill is authoritative; PostHog flags are secondary and cannot override it. |
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

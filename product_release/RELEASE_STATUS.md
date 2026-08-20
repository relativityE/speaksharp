# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-20
**Last Verified:** 2026-08-20 (GitHub: `main` = `307462931905ddcaac1eac303821c4291b7e0257`; #1314's accepted application-qualified head is `95c4f5f3c60fb6d3f183d72a9017f3e54c0a165e`; #1317 (delivery-lifecycle enforcement) review/merge is now first in the queue. Production release identity was not re-read during this documentation update and must be read from `window.__APP_RELEASE__` before the next deployed/browser qualification.)
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`); documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/` or older files.
**Evidence Sources:** GitHub `origin/main`; the production deployment's `window.__APP_RELEASE__`; the required release workflows (see `RC_GATES.md`).

## Current MVP override — 2026-08-19

This section is the current authority when an older entry below conflicts. The older July
baseline and product-posture material is retained temporarily as historical provenance
pending consolidation; do not use it to qualify the MVP.

| Item | Current status |
|---|---|
| Repository `main` | `307462931905ddcaac1eac303821c4291b7e0257` at this verification. Moving pointer; re-read before every claim. |
| Production release | The #1309 deployment evidence identifies release `30746293…`; it was not re-read in this documentation update. Every deployed/browser run must read `window.__APP_RELEASE__` and match the intended SHA or return `VOID`. |
| #1314 Private-STT findings | Application-qualified head `95c4f5f3c60fb6d3f183d72a9017f3e54c0a165e`. The migration artifact/proof is **APPLICATION QUALIFIED**; production migration application remains **HOLD pending separate Product Owner authorization**. This does not qualify the product or close the remaining user-facing findings. Queued behind #1317: no #1314 review/apply resumes until #1317 passes its correction and is separately merge-authorized. |
| #1316 / #1317 delivery controls | Issue #1316 (v2) and Draft PR #1317 add the **two-clock trusted bot**: enforcement resolves the validator/risk-map/schema from the trusted base (never the PR head); the bot owns GitHub facts and writes an idempotent managed block keyed to the code clock (actual head SHA) and intent clock (governing-issue Acceptance-criteria hash); risk tier LIGHT/FULL is classified from trusted path rules with no author self-downgrade; structured evidence uses status enums; defect-class mutants are proven. Source-only until separate review and merge authorization; nothing else requests review until #1317 passes and merges. |
| Real-device acceptance | The earlier two-session run is `VOID` because it used a stale browser bundle and an invalid short Progress sample. A fresh-release three-session Private-STT run remains required after migration application, client adoption, UI/retention/PDF/progress fixes, deployment, and release-identity verification. |
| MVP STT/AI product ruling | **Private STT only.** AssemblyAI/Cloud STT is not an MVP launch path and must not be used as qualification evidence or described as the plan. Gemini is used only for AI suggestions. |

### Current qualification sequence

1. Review and separately merge-authorize #1317 (the regenerated delivery-lifecycle enforcement boundary). Nothing else requests review until this lands.
2. Bounded review of #1314's application-qualified migration artifact (`95c4f5f3`).
3. Separate Product Owner authorization for migration apply; execute apply, enforcing
   postflight/readback, schema reload verification, and rollback triggers.
4. Adopt `complete_session_v2` in the client and prove the authoritative save path.
5. Close the remaining retention, Analytics, PDF, filler, Progress, and finalization
   findings from the human run.
6. Deploy the exact reviewed head.
7. Start a new browser context or reload with cache disabled, read
   `window.__APP_RELEASE__`, compare it to the deployed SHA, and verify current
   harness/selectors. Missing or mismatch means `VOID`.
8. Run the three-session real-device Private-STT acceptance with controlled WER evidence,
   runtime/audio metrics, zero-Cloud proof, newest-two transcript retention/PDF review,
   session-over-session progress, and no stale finalization state.
9. Continue the remaining MVP release ledger only after that acceptance result.

### Current evidence/review control

Before any review request, the PR must identify its governing issue and exact pushed SHA;
attest local/remote/base/worktree/allowlist/tool/hash freshness; separate completed from
pending evidence; provide mutation/failure proof for new gates; state limitations; and use
one of `OPEN`, `IMPLEMENTED/NOT QUALIFIED`, `VOID`, `QUALIFIED`, or `BLOCKED`.
Required pending evidence must be `None.` and status must be `QUALIFIED`. Diagnostic
substitutes never qualify an authoritative boundary.

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
- **Private-first UX (through #1007/#1008, still current):** Private = Recommended/main; Browser (method name, carrying a secondary "Quick preview" descriptor badge; #1041) = the free convenience path; Cloud = paid-Pro-only and unavailable to Free testers during the no-billing beta (existing paid-Pro accounts retain access). One authoritative post-save `StatusNotificationBar`; completion toast / "Next: Analytics" overlay deleted.
- **STT mode labels (SHIPPED — #1041 / PR #1060, main `8aae87b8`):** the user-facing **transcription-method name is "Browser"**, with **"Quick preview"** retained as a **secondary descriptor badge** on the Browser option. Approved description: *"Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended."* Accessibility: accessible name = "Browser"; the "Quick preview" descriptor + description are exposed as the option's accessible description. The internal engine token / telemetry / DB value remains **`native`**, unchanged. (Supersedes the earlier **"Quick Preview (Browser)"** primary-label proposal, which is retired.)
- **Issue-report hygiene (#1024):** raw `appRuntimeConfig.url` no longer persisted in report metadata.
- **`get_analytics_summary` authorization P0 (#1096 — APPLIED TO PRODUCTION 2026-07-29):** migration `20260729120000_secure_get_analytics_summary_authz.sql` merged to `main` (`b9ac4ca`) and applied to the production DB (project `yxlapjuovrsvjswkwnrk`) via the sanctioned `deploy-supabase-migrations.yml` run [`30496437018`](https://github.com/relativityE/speaksharp/actions/runs/30496437018).
  - **Applied and recorded:** `db push` dry-ran (scope = only this migration), then `Applying migration 20260729120000_secure_get_analytics_summary_authz.sql... ✅ Migrations applied successfully` — so `db push` both **applied and recorded** `20260729120000` in the remote migration history. (The workflow's `migration repair` step in the same run concerned an **older** migration, `20260116000000`, not this one.)
  - **Production-proven:** the workflow completed successfully; an unauthenticated probe (`anon` publishable key, no user JWT) of `get_analytics_summary(<nil-uuid>)` changed from **HTTP 200 with a payload** (pre-fix) to **HTTP 401 `42501 permission denied for function`** (post-fix); the deployed frontend release identity **remained `b9ac4ca`** (read from prod `window.__APP_RELEASE__`) — this is a DB-only change. No customer data accessed (the nil UUID owns no rows).
  - **Exact-artifact evidence (byte-identical migration on PostgreSQL 15/16/17 in CI + local 17.10):** null-safe fail-closed guard `auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid()`; ACL = `REVOKE EXECUTE FROM PUBLIC`/`anon`, `GRANT` to `authenticated` + `service_role`; `service_role` retains its grant yet a keyless call is guard-rejected; `SET search_path = public, pg_temp` (pg_temp explicit and last).
  - **Rollback constraint:** any rollback MUST retain the PUBLIC/anon revokes, the null-safe guard, and the safe `search_path = public, pg_temp`. **Never restore the vulnerable prior function body verbatim** — reverting only the evidence-validity aggregate, not the authorization controls.
- Billing closed, exact-origin CORS hardened, v4 off (as above).

## Beta posture
- **Controlled, invite-only, no-billing beta.** No Cloud for Free testers; v4 off. (No hard-coded tester count here — reconcile any count to the authoritative invitation roster before publishing it.)
- **Tester invitations are gated on the read-only tester-evidence audit (#1030 `workflow_dispatch`).** The audit is HELD pending a Product Owner correction to the `AUDIT_EXCLUDED_EMAILS_JSON` exclusion manifest (a `synthetic` category data issue); it fails closed and publishes no totals until corrected.

## Current open work
- **Documentation canonicalization (in progress):** establishing the approved 14-canonical-document system + migration ledger + SSOT repair (this file); governs the later consolidation steps. (Track current PR/thread state in the relevant PR, not here.)
- **Adversarial-review roadmap (sequential):** central entitlement selector (tracked as an issue), STT evidence orchestrator (tracked as an issue), PRD v1, Architecture/STT ADRs, and further items tracked in the #1052 ledger. **Shipped and no longer open:** durable engine-attribution (#1033 — merged, migration applied, deployed, live-proven) and the Browser display-label change (#1041 via PR #1060).
- **#1006 is CLOSED** (draft, not activated) — no longer current work; the durable-delivery/observability remediation is not shipped/deployed/activated.

## Private STT finalization — accepted planning budget (not a measured p95)
The **≈90 seconds** of post-stop processing quoted for a full five-minute single Private (v2 / whisper-base.en) recording is an **accepted planning budget / risk allowance** for the controlled beta — **not** an observed production performance fact and **not** a measured p95. It is surfaced to the user as honest "Finalizing…" progress. The earlier `<30s` requirement is obsolete/withdrawn. A measured percentile would need a dedicated instrumentation run (STT evidence lane); faster finalization is a post-limitation improvement lane, not a blocker.

## STT availability by tier

| Engine | Availability | Notes |
|---|---|---|
| Browser (Web Speech; method name **"Browser"** + secondary **"Quick preview"** descriptor badge, shipped #1041; internal token `native`) | All tiers (default preview) | Convenience path; **not** local/offline/on-device (Chrome routes audio to Google); weakest path; never an automatic fallback. Nudge Private after a preview session. |
| Private (v2 / whisper-base.en) | All tiers (local, download on first use) | Default Private engine. v4 WebGPU OFF — `VITE_PRIVATE_STT_V4_DISABLED` hard kill is authoritative; PostHog flags are secondary and cannot override it. |
| **Cloud (AssemblyAI) — not an MVP path** | **Out of MVP / must not be used for launch qualification** | Current product ruling is Private STT only. Treat any remaining Cloud code/config as legacy exposure to inventory and close deliberately; do not present it as the launch plan. |

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

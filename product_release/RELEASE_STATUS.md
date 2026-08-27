# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-27
**Last Verified:** 2026-08-27 (production `window.__APP_RELEASE__` read read-only and CACHE-BUSTED from `https://speaksharp-public.vercel.app/` = `5f3788984467b13a810d7ae14c9ee9bf842c90f2`, HTTP 200; `origin/main` verified by `git rev-parse` at the same time. Production **==** `main` HEAD at this read.)

> **Currency correction.** This file previously carried `Last Reviewed: 2026-07-24` — 34 days stale — while `AGENTS.md` names it *the only authority for current release/deployment posture, blockers, baselines, and workflow evidence*. It asserted a deployed release of `05643fbd` and described `#1006` as the current open work. Every agent instructed to consult it was being pointed at a product state that no longer exists. The values below are verified reads taken on 2026-08-27, not copied forward.
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
| **Repository `main` (moving branch pointer)** | `5f3788984467b13a810d7ae14c9ee9bf842c90f2` (#1357, #1304 Task 2) at 2026-08-27 | **Moving** — verify the live pointer directly (`git rev-parse origin/main`); do not treat this SHA as fixed. |
| **Last product-behavior release** | `781e8ad6` (#1355, #1354 recorder Progress gate — the last commit changing runtime product behavior). `574422ed` and `5f378898` are TEST-INFRASTRUCTURE only (#1304 Tasks 1–2: the WER scorer and the benchmark specs); they deploy but change no user-facing behavior. | Product commits on `main`; check whether the diff touches `frontend/src` runtime paths. |
| **Later test/evidence commits (NOT product-behavior deployments)** | `574422ed` (#1356 certified scorer, `tests/evidence/**`), `5f378898` (#1357 benchmark specs, `tests/live/**`) | These change **no** deployed product behavior. |
| **Deployed product release (verified)** | `window.__APP_RELEASE__ = 5f3788984467b13a810d7ae14c9ee9bf842c90f2`, read cache-busted from `https://speaksharp-public.vercel.app/` (HTTP 200) on **2026-08-27**. Production == `main` HEAD at this read, but that is **not** guaranteed by auto-deploy alone: a Vercel "Ignored Build Step" can leave production behind `main`, so the deployed SHA must be **read**, not inferred. | Re-read `window.__APP_RELEASE__` from the deployed page with a cache-busting query and `Cache-Control: no-cache`, then update the value + date here. |

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

The MVP-blocking lane is **#1304 (STT down-select)**. See `ACTIVE_COORDINATION.md` for the working board; this section carries only release posture.

- **Merged and deployed (2026-08-27):** #1354 recorder Progress gate (`781e8ad6`, #1355 — the last **product-behavior** change); #1304 Task 1 certified WER scorer (`574422ed`, #1356); #1304 Task 2 authoritative benchmark specs (`5f378898`, #1357). The last two are test infrastructure and deploy without changing user-facing behavior.
- **Open:** #1346 (#1304 Task 3A — decode route identity, un-parked and rebased). Task 3 (certified harness) and Task 4 (corpus) are not started.
- **RELEASE BLOCKER — no retention verdict.** Nine production-proof attempts have failed, every one on the test harness and never on the product, so the three-session retention contract has never actually been checked. Agreed sequence: prove the contract against a throwaway database first (needs no authorization and becomes a standing CI gate), then one production run as the final gate. Until a verdict exists, release stays **HOLD**.
- **Accepted post-MVP debt:** the #1354 write-ahead obligation is client-only. If the Progress evaluation fails, the browser obligation write also fails, and the user reloads after storage recovers, the client cannot reconstruct that obligation. Eliminating it requires a server-side obligation record.
- **#1006 is CLOSED** (draft, not activated) — long since not current work; retained here only because earlier revisions of this file presented it as the open item.

## Private STT finalization — accepted planning budget (not a measured p95)
The **≈90 seconds** of post-stop processing quoted for a full five-minute single Private (v2 / whisper-base.en) recording is an **accepted planning budget / risk allowance** for the controlled beta — **not** an observed production performance fact and **not** a measured p95. It is surfaced to the user as honest "Finalizing…" progress. The earlier `<30s` requirement is obsolete/withdrawn. A measured percentile would need a dedicated instrumentation run (STT evidence lane); faster finalization is a post-limitation improvement lane, not a blocker.

## STT availability

> **Corrected 2026-08-27.** This section previously published a three-tier table — Browser "all tiers (default preview)", Private, and Cloud (AssemblyAI) "Paid Pro only … Strongest STT path". **Two of those three engines no longer exist.** `TranscriptionMode` is `'private' | 'mock'`; `frontend/src/services/transcription/engines/` contains only `MockEngine`, `PrivateSTT`, `TransformersJSEngine` and `TransformersJSV4Engine`; `modes/` contains only `PrivateWhisper.ts`. No Cloud/AssemblyAI engine and no Web Speech engine is constructible. The table below is what the code admits, verified 2026-08-27.

| Path | Availability | Notes |
|---|---|---|
| **Private v2 (`whisper-base.en`, on-device)** | The **only** user-facing transcription path, all tiers | Local; one-time model download on first use. There is no engine selector — the product is Private-only (#1184/#1229). |
| **Private v4 (WebGPU)** | Present in code, **hard OFF** | `VITE_PRIVATE_STT_V4_DISABLED` is authoritative; PostHog flags are secondary and cannot override it. Not in the release path. |
| **Mock** | Tests only | Never user-reachable. |
| ~~Browser (Web Speech)~~ | **REMOVED** | Not a `TranscriptionMode`; no engine. A vestigial `allowNative` field remains on `TranscriptionPolicy`, and `frontend/src/e2e/signalContract.ts` still names `modes/NativeBrowser.ts`, **a file that does not exist**. |
| ~~Cloud (AssemblyAI)~~ | **REMOVED** | Not a `TranscriptionMode`; no engine. Orphaned constants remain in `frontend/src/config.ts` (`ASSEMBLYAI_TOKEN_ENDPOINT`, packet-size limits) and provider-family strings in `sttIdentity.ts`. Cleanup is tracked as **#1323** (post-MVP remnants) and is not shipped; these are known cleanup, not capability. |

**No claim is made here about relative engine accuracy, in either direction.** Vendor figures are reference-only and must not be compared against our own corpus results — differing corpora and decode paths make such a comparison an artifact rather than a measurement. The #1304 lane exists to produce a defensible ranking; until it does, there is none.

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

# Release Status

**Owner:** Prod Owner (relativityE).
**Scope:** Single source of truth (SSOT) for current release/deployment posture. If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational and RC-gate docs; current ship status lives here only.

## Current baseline & production posture

| Item | Value |
|---|---|
| **Current product code baseline (`main`)** | `e9040464` — Private-first selector + opaque menu + single post-save surface (merged via #1007/#1008). |
| **Production deployment** | Vercel serves `main`. **SHA-equality verified:** the deployed bundles embed `__BUILD_ID__ = e90404642676…` (= `main`), injected at build from `VERCEL_GIT_COMMIT_SHA` ([frontend/vite.config.mjs](../frontend/vite.config.mjs)). |
| **Historical frozen tag** | `v0.9.0-rc4` (annotated) peels to `df909805…`. This is a **historical, frozen** release point — **NOT** the current `main`/product baseline. |
| Deployment | Auto-deploy on push to `main`. Post-merge gates on `e9040464` all green: **CI - Test Audit** ✅ · **RC Gates** ✅ all 5 incl. Gate 5 UX Smoke and Gate 3 live DAST/CORS · **OSV SCA — Gate 4** ✅ · **Production Canary** ✅ · **Ops Health** ✅. |
| Payments | **Closed.** Billing is independently fail-closed in frontend AND backend; the billing-freeze check proves CLOSED. Paid launch is a separate Ops key-swap cutover, not a pending test. |
| CORS | **Exact-origin CORS deployed and live-DAST proven** (rc-gates Gate 3; origin allowlist in [backend/supabase/functions/_shared/cors.ts](../backend/supabase/functions/_shared/cors.ts)). |
| Private v4 | **OFF.** Its model-pipeline smoke is repaired, but v4 activation remains disabled. |

## Current merged product posture (through #1007 / #1008)
- **Private-first UX shipped:** Private = Recommended/main; Browser = "Quick preview"; Cloud = Pro (unavailable to Free testers in the no-billing beta; existing paid-Pro accounts retain access). One controlled desktop description flyout; one touch "About transcription modes" panel; the mode dropdown is opaque.
- **Post-save consolidated:** one authoritative `StatusNotificationBar` with a single persistent, accessible (WCAG-AA) green Analytics action; the recording-card pill resets (no duplicate "Session saved"). **The completion toast / "Next: Analytics" overlay is deleted.**
- Billing closed, exact-origin CORS hardened, v4 off (as above).

## Beta posture
- **Controlled, invite-only, no-billing beta underway.** No Cloud for Free testers; v4 off. (No hard-coded tester count here — reconcile any count to the authoritative invitation roster before publishing it.)
- **The investigated Browser and Private sessions and issue report were preserved; those records do not need to be repeated.** **Attempts that never reached Supabase cannot yet be counted** and remain part of #1006.

## Current open work
- **#1006 (DRAFT, not activated)** — reliable data-retrieval / observability / durable delivery (outbox + provenance + owner-alert + protected retrieval). This is the current open incident/remediation. **Not shipped, not deployed, not activated**; migrations/workers/crons/reconciliation each require separate Prod Owner authorization. Details: `BACKLOG.md` P0.4, `ACTIVE_COORDINATION.md`.

## Private STT finalization — accepted RC limitation
A full **five-minute single Private (v2 / whisper-base.en) recording finalizes in ≈90 seconds** of post-stop processing — the accepted limitation for the controlled beta, surfaced to the user as honest "Finalizing…" progress. The earlier `<30s` requirement is obsolete/withdrawn. Faster finalization (streaming / segmentation / multithread) is a post-limitation improvement lane, not a blocker.

## STT availability by tier

| Engine | Availability | Notes |
|---|---|---|
| Browser (Web Speech) | All tiers (default preview) | "Quick preview"; weakest path; nudge Private after a Browser session. |
| Private (v2 / whisper-base.en) | All tiers (local, download on first use) | Default Private engine. v4 WebGPU OFF (`VITE_PRIVATE_STT_V4_DISABLED` hard-kill; primary control is PostHog flags, default off). |
| **Cloud (AssemblyAI)** | **Paid Pro only** | Requires real paid Pro entitlement (`stripe_subscription_id`). **NOT available in the no-billing beta.** Strongest STT path. |

## Release-track posture

| Track | Status |
|---|---|
| Controlled private beta / early-access (non-payment) | **Underway** — invite-only, no billing, no Cloud for Free, v4 off. Any confirmed P0/P1 pauses expansion. |
| Paid public launch (live checkout) | **NO-GO** — separate Ops key-swap cutover (live keys + webhook + `stripeKeyClass==="live"`). |
| Broad public launch | **NO-GO** — separately gated. |

## Open items / decisions
- **#1006 remediation** — current incident work; corrections + independent review before any activation (see `BACKLOG.md` P0.4).
- **SCA** — Gate 4 is the permanent OSV scanner (`sca-osv`, required context). GHSA-5xrq (`vitest@3.2.4`) is the single ignored advisory; a Vitest 3→4 upgrade retires the suppression (`SCA_EXCEPTIONS.md`).
- **Faster Private finalization** (<~90s) — improvement lane, not a blocker.

## Historical evidence (pointers, not current status)
- **Attribution history sanitation** (2026-07-15): historical SHA crosswalk + provenance in [attribution-sanitation-crosswalk.md](attribution-sanitation-crosswalk.md). Historical PostHog `release_sha` values retain OLD SHAs (immutable telemetry) — correlate via the crosswalk.

## Evidence Freshness Contract
A release gate is green only when its definition of green is backed by a named artifact a reviewer can inspect without operator memory. The active artifact is always the latest complete passing run; a newer failing run returns the parent gate to red until a later complete run passes every criterion.

## Named STT Gate Artifacts

| Gate | Required Current Artifact |
|---|---|
| Fresh Trial Private STT Transcript/Save/History Path | Private human artifact incl. warmup, model setup/download state, chunk RMS/duration, first partial timestamp/text, save result, history/detail proof. |
| Browser (Web Speech) Chrome human-mic proof | Artifact incl. `onspeechstart → first onresult` order, selected transcript on stop, save/history/detail + analytics proof, no unintended repeated 4-word sequence. |
| Cloud Pro proof | Artifact showing AssemblyAI token HTTP 200, transcript/save/history/detail, AI suggestions, PDF export, Pro entitlement context. |
| Custom word analytics proof | Artifact showing a custom word counted (e.g. `like = 1`) after adding it via UI, saving, and opening detail/analytics. |
| PDF export proof | Saved-session PDF whose transcript/duration/WPM/filler+custom counts/metadata match the detail view within ±15%. |
| Session Status UX | Trace/screenshot showing one clear status surface (`StatusNotificationBar`), Private setup/download/ready states, no duplicate/debug status. |

## Update rule
Only this file receives changing release/deployment status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence.

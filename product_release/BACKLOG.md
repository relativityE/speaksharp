# Release Backlog

This backlog contains **only unfinished work**. Completed, closed, refuted, superseded, and
historical material is preserved in git history and is intentionally NOT re-archived here — there is
no "Recently Closed" section by design. Reset 2026-07-18 for the private-first beta hardening cycle.

Every active row carries: (1) current evidence or a reproducible gap, (2) user/operational outcome,
(3) acceptance criteria, (4) P0–P3 priority. Rows are deleted the moment their work lands with
regression coverage — completion lives in commits, tests, and PR descriptions, not here.

---

## 1. Product Positioning Contract

1. **Private is the recommended and primary beta experience.**
2. **Browser is a quick preview** of the coaching flow — not positioned as equivalent to Private or Cloud.
3. **Cloud is the paid, Pro-quality path.**
4. **The current beta is no-billing.** Free testers must not be able to initiate checkout or gain Cloud access.
5. Do **not** spend cycles improving Browser punctuation or making Browser match Private (Browser punctuation is P3 at most).
6. **Executive Presentation Rehearsal** is the next major product expansion after this hardening cycle.
7. **Zoom/Meet/Teams live-meeting integration** comes only after the rehearsal product proves value.

---

## 2. Remaining P0

### P0.4 — Reliable data-retrieval, observability & owner notification (incident remediation)
- **Evidence/gap:** During the controlled beta, Browser + Private sessions and the tester issue report were **preserved in Supabase** (no product-data loss). The defect is on the *retrieval / observability / delivery* side: report→session linkage stored NULL (reports render outside `<Routes>`), there is no durable server-side event delivery, no server-assigned provenance to distinguish tester vs automated/seed data, and owner notification was a slow daily digest. Client PostHog capture is best-effort and is NOT proof a session/report persisted.
- **Outcome:** Authoritative, privacy-safe retrieval + observability: reports link to their session; a durable server-side outbox delivers critical events (idempotent, deduped) independent of the browser; every event carries server-assigned provenance; the owner gets a sanitized real-time alert and can retrieve full report content by ID; queues are monitored and self-heal.
- **Acceptance:** report→session linkage fixed + server-guarded; durable server-side delivery **outbox** (leases, retry/backoff, dead-letter, replay) NOT dependent on client PostHog; server-assigned provenance (`data_origin`/`cohort_id`/`test_run_id`/`test_suite`/`server_verified_release_sha`/`environment`) that is **concurrent-run-safe + time-bounded**; privacy-safe **pseudonymous** PostHog identity (HMAC of the user id, never the raw Supabase auth id; fails closed on missing key); authenticated owner-only report retrieval; queue-depth / oldest-pending-age / expired-lease / retry / dead-letter monitoring for telemetry **and** alert queues; bounded existing-record reconciliation; sanitized allowlist alert payloads (no prose/transcript/audio/email/name/tokens/PII); executable/tested rollback + worker-disable. **This is DRAFT #1006 — NOT shipped, NOT deployed, NOT activated** (merge ≠ activation; deploying migrations enables the enqueue triggers; workers stay disabled until separate Prod Owner authorization).
- **Priority:** P0.

---

## 3. Remaining P1

### P1.2 — Private-first funnel measurement
- **Gap:** no content-free funnel telemetry to answer where testers stop and whether Private delay is setup vs finalization.
- **Outcome:** operational visibility into Private adoption/completion and drop-off.
- **Acceptance:** events {mode selector viewed, mode selected, browser preview started/saved, private setup started/ready, private recording started/saved, browser→private continuation, time-to-first-text, stop-to-final-ready, sample exhausted, setup/finalization failure category}, each with `release_sha`, excluding transcript/audio/prose/PII; queries answering: % reaching Private, % completing Private, where users stop, setup-vs-finalization delay, % stopping after Browser.
- **Priority:** P1.

### P1.3 — Centralize transcription entitlement policy
- **Gap:** `isPro`/`hasPrivateSample` are interpreted across multiple hooks/components; risk of divergent entitlement decisions and stale async callbacks.
- **Outcome:** one canonical entitlement selector; no component reinterprets policy.
- **Acceptance:** single selector covering {Free Browser, Free unused sample, Free exhausted sample, Pro Private, Pro Cloud, billing-disabled beta, logout/login+reset, stale async callbacks}; tests prove the full matrix + stale-callback protection.
- **Priority:** P1.

### P1.4 — Post-#1006 three-mode / reporting regression gate
- **Gap:** once #1006's server delivery + provenance land, the three-mode + reporting matrix needs one consolidated regression gate. (SSOT documentation reconciliation was done separately in the `docs/reconcile-product-release-to-private-first-main` PR and is NOT part of this row.)
- **Outcome:** a proven three-mode + reporting regression matrix that stays green after #1006 activation.
- **Acceptance:** full matrix (Browser preview; Private sample→setup→capture→finalize→persist/detail/PDF equality; Cloud existing-Pro-only no-fallback; Free no-Cloud/no-checkout; existing-Pro Cloud works; Report Issue persists + server-delivered sanitized alert + report→session linkage). Documentation reconciliation is explicitly OUT of this row's acceptance.
- **Priority:** P1.

---

## 4. Deferred P2 / P3

**Consolidated reliability/ops epics (one canonical row each):**
- **P2 — Recording lease / no-concurrent-recording reliability epic** (was #794; single-session recording ownership).
- **P2 — Dormant v4 Private STT activation epic** (converged, activation-gated; not launched; device-adaptive WebGPU path).
- **P2 — Paid Stripe operations epic** (refund/cancel admin tooling, billing-portal, identity persistence; post-launch product-ops).
- **P2 — Pro-interest capture epic** — outcome: measure Pro demand without enabling billing. While payments are off, replace the beta-unavailable notice with a durable in-app "Notify me when Pro opens" CTA at natural value moments (Private sample consumed, locked Cloud selected, usage/history limits); sanitized interest telemetry only (no transcript/audio/PII). Acceptance: interest capture works with payments disabled, emits no `checkout_started`, and swaps to the real Upgrade CTA only when payments are enabled. Aligns with PRODUCT_FEATURES.operational.md "Upgrade / Conversion Funnel" + "Free-To-Pro Upgrade Support".
- **P2 — MFA / auth hardening security epic** (account-recovery + MFA; not in initial release).
- **P2 — Private performance epic** (reduce Private setup + ~90s finalization wait; segmented/streaming/multithread/v4 paths).
- **P2 — Dependency / bloat maintenance epic** (Browserslist refresh, ORT WASM duplication, large-chunk code-splitting).

**Activation-gated inchstones (record only; each needs a separate explicit Prod Owner authorization):**
- **P2 — Billing activation (paid Pro enrollment) — descoped; production is confirmed fail-closed.**
  - **Evidence:** Production (`eea85ceb`) is verified fail-closed: the checkout CTA is not rendered because `VITE_PAYMENTS_ENABLED` is off, and a live `POST /functions/v1/stripe-checkout {plan:'pro'}` returned HTTP 403 `payments_disabled` / `paymentsEnabled:false` (2026-07-21T12:41:39Z), rejected before auth and before any Stripe call. The `stripeKeyClass=live` publishable key cannot charge on its own. Testers cannot subscribe → no refund risk.
  - **Outcome:** paid Pro enrollment can be opened later without reworking the fail-closed floor.
  - **Acceptance (two-switch activation gate):** BOTH `VITE_PAYMENTS_ENABLED=true` and `PAYMENTS_ENABLED=true` set together; aligned live Stripe keys/webhook/prices; webhook/price/entitlement/billing-portal verified; a full production purchase→entitlement→portal smoke passes before the CTA is exposed; either switch off keeps checkout closed; the key class validates config but does not by itself open checkout — not merely a key swap; a real-money charge is not a required Dev/CI/QA proof (any controlled live smoke is post-activation only); existing paid-Pro entitlement is retained regardless. Never enable `VITE_PAYMENTS_ENABLED` alone, and never expose a clickable Upgrade that ends in a backend rejection.
  - **Priority:** P2 (activation-gated; not this cycle).
- **P2 — Private v4-vs-v2 A/B tester experiment (data-gathering for a future default decision).**
  - **Evidence:** v2-base is the Private default. Production (`eea85ceb`) has the v4 build-env hard-kill on (`VITE_PRIVATE_STT_V4_DISABLED=true` inlined), which overrides all runtime flags, so `private_stt_v4_enabled` (exists, 0% rollout) cannot activate v4 until the hard-kill is removed and the app is redeployed. WebGPU detection + fallback-to-v2 are already in the resolver. Private v4 stays off for the release path.
  - **Outcome:** collect comparable v4-vs-v2 telemetry from a controlled tester cohort to decide whether v4 (base-q4 WebGPU) should replace v2-base as the Private default; v2 remains default throughout.
  - **Acceptance:** (1) Prod Owner authorizes removing the hard-kill (Vercel `VITE_PRIVATE_STT_V4_DISABLED` off) + redeploy; (2) exposure limited to a named allowlist (or small %) via `private_stt_v4_enabled`, with v2-base default + fallback for everyone else and distil off (base-q4 only); (3) WebGPU-unsupported devices fall back to v2 with no silent fallback; (4) decision metrics tagged on Supabase-persisted `engine_version`/`model_name` (authoritative), covering setup-success, finalization latency, and error/fallback rate; (5) the accuracy/clarity comparison is held until the `um`/`uh` normalization confound and the early-cap bug are resolved, so the metric is not biased; (6) first non-owner-tester validation captured. Private v4 remains off until (1) is authorized.
  - **Priority:** P2 (activation-gated; not this cycle).

**Feature priorities (record only — do NOT implement on the hardening branch):**
- **P2 — Executive Outcome Rehearsal: build-out from the merged domain foundation.** The pure-logic domain foundation (feature flag default-off, brief validation, local deterministic coverage/evidence mapping) is proposed in PR #1012 as an *enabling foundation only — not deployed user functionality*. The remaining build inchstones, each a separate PR/review with one observable outcome: (1) pre-session Brief UI (labeled/validated inputs, min/max explained, keyboard + screen-reader); (2) existing-session integration (reuse lifecycle/recording/transcript/metrics without displacing Private-recommended); (3) post-session local Outcome Scorecard card (rendered separately from the SpeakSharp Score, which is unchanged); (4) in-session P0 timing + hide-able talking-point checklist (no modal interruptions); (5) **persistence + RLS** — rehearsal brief/scorecard as nullable columns on `sessions`, ownership via the existing `auth.uid()=user_id` policy, migration prepared with RLS/grant tests and **separately reviewed, not auto-applied**; (6) optional semantic AI nudges (default off, explicit per-user consent + disclosed cloud transcript egress before any transmission). Free-text (talking points/decision/audience) never enters telemetry.
- **P2.1 — Executive Presentation Rehearsal Sandbox:** user supplies audience, objective, desired decision/ask, and 3–7 required talking points; reuse current recording/transcript/live metrics/analytics/AI suggestions; post-session scorecard = talking-point coverage, executive framing, recommendation, business impact, risk/mitigation, explicit next step. No Zoom/Meet integration.
- **P2.2 — Rehearsal visual cue checklist:** compact not-covered/covered/clarify states during rehearsal alongside WPM/filler/pause; no verbose live paragraphs; do not alter SpeakSharp Score with unvalidated AI output.
- **P2.3 — Real-time semantic AI rehearsal cues:** feature-flagged Pro experiment; evaluate only finalized clauses / pause-bounded chunks (not every token); rate-limit cues; ≤1 short actionable cue at a time; clearly disclose cloud-AI transcript egress; keep deterministic delivery coaching if AI fails.
- **P3.1 — Live Meeting Companion:** only after Rehearsal Coach shows repeated value; reuse rehearsal brief/coaching model; cues less frequent/verbose than rehearsal; treat Meet/Zoom/Teams capture, permissions, privacy, distraction as separate risks; start with a browser-agnostic overlay prototype, not native vendor integrations.
- **P3 — Browser punctuation/filler improvement** (explicitly deprioritized; do not pursue this cycle).

---

## 5. Triage Rules

- An active row must have all four of: current evidence / reproducible gap; user or operational outcome; acceptance criteria; P0–P3 priority. Rows lacking these are removed.
- **Priorities:** P0 blocks tester release or risks billing/privacy/data integrity → fix before share. P1 fixes after active P0s are stable. P2/P3 = resilience, polish, velocity, and future features scheduled after release gates are green.
- **Delete on completion.** When implementation + regression coverage exist, delete the row. Do not add a "Recently Closed" entry; git history is the record.
- **No history in this file.** No branch/run/SHA narratives, incident transcripts, test-run ledgers, ownership tables, or closeout snapshots.
- **One canonical row per item.** Deduplicate; consolidate related work into a single epic rather than many near-duplicate rows.
- If a prior "closed" claim conflicts with current code, delete the false closure and write one concise current defect row (CORS is the known example → P0.3).
- Do not keep a row merely for useful historical context.
- **Execution order:** all P0 (in order) → P0 exit gate → all P1 (in order). New P0s discovered mid-cycle are inserted and resolved before continuing.

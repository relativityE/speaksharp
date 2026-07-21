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
7. **Zoom/Meet/Teams live-meeting integration** (Live Meeting Companion) is **removed from active
   sequencing** — future direction only, re-scoped separately after the rehearsal product proves value.
8. **Transparent personal progress replaces the opaque universal score.** The user-facing 0–10
   SpeakSharp Score is being **retired** via a staged consumer migration and replaced by
   progress against the user's **own** baseline and **own** selected targets. Do **not** rescale
   the score to 0–100 or into a new combined headline number. General practice needs **no** agenda;
   agendas are optional and belong only to Executive Rehearsal. Contract:
   `PRODUCT_FEATURES.operational.md` + `SPEAKSHARP_SESSION_SCORE.operational.md` Part A; inchstones in
   §4 below.

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
- **P3 — `RELEASE_STATUS.md` baseline reconciliation (non-blocking, separate cycle).** `RELEASE_STATUS.md`
  states the `main` baseline as `65e58a62` (#1010), but `origin/main` has since advanced to `506e574d`
  (#1012/#1013/#1014/#1015 landed after); production is SHA-equal to the current `main` (`506e574d`).
  Docs-only correction in a **separate** PR — not part of the personal-progress/rehearsal contract PR,
  and not a new documentation cycle.

**Activation-gated inchstones (record only; each needs a separate explicit Prod Owner authorization):**
- **P2 — Billing activation (paid Pro enrollment) — descoped; production is confirmed fail-closed.**
  - **Evidence:** Production checkout is fail-closed by design: the checkout CTA is not rendered while `VITE_PAYMENTS_ENABLED` is off, and the backend refuses checkout with `payments_disabled` before any Stripe call, so testers cannot subscribe (no refund risk); a live publishable key alone cannot charge. Point-in-time production proof (SHA / timestamp / probe response) lives in `RELEASE_STATUS.md` and PR evidence, not in this backlog row.
  - **Outcome:** paid Pro enrollment can be opened later without reworking the fail-closed floor.
  - **Acceptance (two-switch activation gate):** BOTH `VITE_PAYMENTS_ENABLED=true` and `PAYMENTS_ENABLED=true` set together; aligned live Stripe keys/webhook/prices; webhook/price/entitlement/billing-portal verified; a full production purchase→entitlement→portal smoke passes before the CTA is exposed; either switch off keeps checkout closed; the key class validates config but does not by itself open checkout — not merely a key swap; a real-money charge is not a required Dev/CI/QA proof (any controlled live smoke is post-activation only); existing paid-Pro entitlement is retained regardless. Never enable `VITE_PAYMENTS_ENABLED` alone, and never expose a clickable Upgrade that ends in a backend rejection.
  - **Priority:** P2 (activation-gated; not this cycle).
- **P2 — Private v4-vs-v2 A/B tester experiment (data-gathering for a future default decision).**
  - **Evidence:** v2-base is the Private default. The production build ships the v4 build-env hard-kill (`VITE_PRIVATE_STT_V4_DISABLED=true`), which overrides all runtime flags, so `private_stt_v4_enabled` cannot activate v4 until the hard-kill is removed and the app is redeployed. WebGPU detection + fallback-to-v2 are already in the resolver. Private v4 stays off for the release path.
  - **Outcome:** collect comparable v4-vs-v2 telemetry from a controlled tester cohort to decide whether v4 (base-q4 WebGPU) should replace v2-base as the Private default; v2 remains default throughout.
  - **Acceptance:** (1) Prod Owner authorizes removing the hard-kill (Vercel `VITE_PRIVATE_STT_V4_DISABLED` off) + redeploy; (2) exposure limited to a named allowlist (or small %) via `private_stt_v4_enabled`, with v2-base default + fallback for everyone else and distil off (base-q4 only); (3) WebGPU-unsupported devices fall back to v2 with no silent fallback; (4) A/B analysis MUST distinguish the **assigned** engine, the **attempted** engine, and the engine that **actually produced the saved transcript**; `sessions.engine_version` is **NOT** authoritative for the actual-producing engine until final-engine attribution after decode fallback is repaired and regression-tested — until then, treat setup-success, finalization latency, and error/fallback rate as the trustworthy signals; (5) the accuracy/clarity comparison is held until the `um`/`uh` normalization confound and the early-cap bug are resolved, so the metric is not biased; (6) first non-owner-tester validation captured. Private v4 remains off until (1) is authorized.
  - **Priority:** P2 (activation-gated; not this cycle).

### Personal Progress & Executive Rehearsal feature train (record only — do NOT implement on the hardening branch)

**Direction.** Transition from the opaque universal 0–10 SpeakSharp Score to **transparent personal
progress** (progress vs the user's own baseline and own selected targets), plus the Executive
Rehearsal experience, delivered as small independently-reviewable inchstones. Canonical product
contract: `PRODUCT_FEATURES.operational.md` ("Personal Progress & Executive Rehearsal Product
Contract"); calculation contract: `SPEAKSHARP_SESSION_SCORE.operational.md` Part A. Each inchstone is
a separate branch/PR from fresh `main`, one observable outcome, regression-tested, independently
reviewable, closed before the next dependent PR begins, disabled while its user journey is
incomplete, and requires explicit Prod Owner merge authorization (and separate deployment/activation
authorization where applicable). Rehearsal free-text (talking points/decision/audience) never enters
telemetry. Builds on the Executive Rehearsal domain foundation (PR #1012 — enabling code only, not a
shipped feature; `frontend/src/services/rehearsal/`).

**Phase gating (a merge/deploy/activation boundary sits between each phase):**
- **Phase 1 — Product contract & backlog (this cycle):** definition only; docs/backlog. Returned for
  Prod Owner review. No sandbox or implementation until Phase 1 is approved.
- **Phase 2 — Localhost UX sandbox (after Phase 1 approval):** new branch `feat/executive-rehearsal-progress-sandbox`
  from then-current `main`; localhost-only, representative fixtures, flag default OFF; **no** production
  data, migrations, RLS, production AI calls, billing, Private v4, or external side effects. Fixture
  states: first-baseline; improved comparable session; regression; target-maintained; incompatible
  (no comparison); partly-covered agenda; recovered agenda point; insufficient transcript confidence.
  Iterate until the experience is approved; **do not** merge the sandbox wholesale — preserve approved
  decisions and close it as a design reference.
- **Implementation inchstones (after sandbox approval):** each from fresh `main`, per the rules above.
  **Do not** inherit sandbox code wholesale.

**SpeakSharp Score consumer inventory (migration scope for Inchstone 11).** The 0–10 score is
**never persisted** — every surface recomputes it from `frontend/src/utils/speakingScore.ts`, so there
is **no DB column to drop**; migration touches render/emit call sites and copy only.

| Bucket | Consumers |
| :--- | :--- |
| Producer | `frontend/src/utils/speakingScore.ts` (`calculateSpeakingScore`, `getTranscriptQualityCaveat`, weights/thresholds/version constants). |
| Live in-session UI | `frontend/src/components/session/LiveCoachingScoreCard.tsx`; `frontend/src/pages/SessionPage.tsx` (renders the card); `frontend/src/components/session/HelpPopover.tsx` (score explainer copy). |
| Post-session UI | `frontend/src/components/AnalyticsDashboard.tsx` (quality caveat + "SpeakSharp Score" copy). |
| Recommendations | `frontend/src/utils/coachingNarrative.ts` (mirrors score penalties/actions; no import edge — keep in sync). |
| Telemetry / experiment | `frontend/src/services/sessionCoachingExperiment.ts`; `frontend/src/services/telemetry/processors/ScoreProcessor.ts`; `shadowMetricsEngine.ts`; `contracts.ts`; `metricsSnapshot.ts`; `metricsParity.ts`; `fillerDivergence.ts` (shadow/flag-gated; a second live invocation of the engine). |
| Reports / PDF | `frontend/src/lib/pdfGenerator.ts` ("SpeakSharp Score" row + coaching suggestion). |
| Persistence | **None for the 0–10 score.** DB stores only inputs (`sessions.clarity_score`, `sessions.accuracy`, `user_goals.clarity_goal`) — do **not** retire these. |
| Tests | `speakingScore.test.ts`, `LiveCoachingScoreCard.test.tsx`, `AnalyticsDashboard.component.test.tsx`, `SessionPage.rendering.component.test.tsx`, `useSessionMetrics.test.ts`, `shadowProducers.test.ts`, `derivedMetrics.test.ts`, `tests/e2e/help-popover-mobile.e2e.spec.ts`. |
| Copy / docs | `product_release/SPEAKSHARP_SESSION_SCORE.operational.md`, `PRODUCT_FEATURES.operational.md`, `STT_BASELINE_CONTRACTS.operational.md`; **`USER_GUIDE.md`** (repo root — its separate 0–100% "Clarity Score" headline is a distinct universal grade to reconcile during migration). |

Exclude from migration: `frontend/src/services/rehearsal/outcomeScorecard.ts` (separate Outcome
Scorecard; does not touch the SpeakSharp Score) and the `clarity_score`/`accuracy` inputs above.

**Role-based ownership (applies to every inchstone below).** Implementation owner: **Product
Engineering / Dev** (executes). Product acceptance: **Prod Owner**. Security/data approval (before any
migration or production activation): **Prod Owner**. Deployment/activation decision: **Prod Owner**.
No individual names are assigned here.

**Ordered inchstones (each: implementation = Product Engineering / Dev; approval gates = Prod Owner; one closure boundary):**
- **Inchstone 1 — Directional comparison domain (no UI):** baseline eligibility, target definitions,
  per-metric distance calcs, progress calcs, comparable-session rules, confidence/exclusion reasons,
  edge-case tests. **Closes when** the domain + tests land with no user-interface change.
- **Inchstone 2 — Post-session Personal Progress:** baseline-established state; per-target raw +
  gap-closed results; named comparison session; "improved in X of Y focus areas"; one next focus; no
  combined universal percentage. **Closes when** the post-session surface renders per the contract.
- **Inchstone 3 — Quiet live guidance:** replace the prominent live 0–10 score; preserve useful
  confidence/recommendation behavior; no continuously-changing replacement score; no interruption or
  automatic cueing. **Closes when** the live 0–10 card is gone and the quiet surface ships.
- **Inchstone 4 — Analytics integration:** reuse existing session-comparison infra; previous-comparable
  view; rolling 3–5-session trend; target history/version awareness; clear exclusion explanations;
  general practice works without an agenda. **Closes when** Analytics shows personal progress.
- **Inchstone 5 — Executive Rehearsal passive agenda:** optional brief/agenda entry; recommended
  initial range per the contract; passive gray/yellow/green coverage; evidence-backed post-session
  outcome review; **no** AI remedy and **no** persistence yet unless separately authorized. **Closes
  when** passive agenda tracking + outcome review ship behind a default-OFF flag.
- **Inchstone 6 — Real transcript integration:** connect agenda evaluation to actual Session
  transcripts; require evidence for covered/partial/missing; prove no fabricated attribution; no
  automatic intervention. **Closes when** agenda states derive from real transcript evidence.
- **Inchstone 7 — User-requested remedy:** user selects one gap / asks for help; one concise remedy;
  no stacked suggestions; clear privacy/data-handling boundary. **Closes when** the request→one-remedy
  path ships.
- **Inchstone 8 — Evidence-backed recovery:** observe the user's supplement/retry; attribute to the
  prior remedy only when evidence supports it; mark "recovered" only with proof; false-positive
  regression tests. **Closes when** recovery is proven, not inferred.
- **Inchstone 9 — Persistence & history:** persist briefs, attempts, targets, target versions,
  coverage, remedies, recovery; **separate migration/RLS PR**; prove ownership isolation + retention.
  **Requires explicit Prod Owner migration authorization.** **Closes when** the schema + RLS land with
  ownership tests.
- **Inchstone 10 — Sparse pause-aware experiment:** only after passive + user-requested remedies are
  usability-proven; one cue during a genuine pause; default OFF; kill switch; cognitive-load
  evaluation; annoyance/abandonment exit criteria. **Requires separate activation authorization.**
  **Closes when** the guarded experiment is shippable behind the OFF flag.
- **Inchstone 11 — Legacy score-consumer retirement:** migrate remaining reports, telemetry,
  recommendations, PDFs, tests, and copy (see inventory above); remove the 0–10 presentation; delete
  dead score code only after all consumers migrate; prove no broken analytics/report/session
  experience. **Closes when** the last consumer is migrated and the code is removed.
- **Inchstone 12 — Controlled release:** exact-head CI/SCA; focused production smoke; authenticated
  synthetic-account validation; accessibility + responsive evidence; telemetry proving no elevated
  abandonment/errors. **Separate merge, deployment, tester-exposure, and activation decisions.**
  **Closes when** the release evidence is complete and each decision is separately authorized.

**Future direction (not sequenced):**
- **Live Meeting Companion** — **removed from active implementation sequencing**; future direction
  only. Would reuse the rehearsal brief/coaching model in a real meeting under a tighter distraction
  budget, re-scoped separately and only after Rehearsal proves value. Treat Meet/Zoom/Teams capture,
  permissions, privacy, and distraction as separate risks. **Non-goals:** avatars; body-language /
  video analysis.

**Unrelated, still valid:**
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

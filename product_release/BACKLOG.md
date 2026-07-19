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

### P0.2 — Private-first mode hierarchy
- **Evidence/gap:** The selector presents Browser and Private with near-equal weight; copy frames Private mainly as a privacy option / Browser comparison. No single "Recommended" treatment; "Browser provider" label persists.
- **Outcome:** Testers understand Private is the main beta experience and Browser is a zero-setup preview; Cloud shows as the Pro path but is unavailable to Free.
- **Acceptance:** order Private (Recommended) → Browser (Quick preview) → Cloud (Pro); only Private shows Recommended; "Browser provider" → "Quick preview"; one Browser→Private transition after a Browser save; no duplicate Private CTA; onboarding/selector/help/status-bar/invite/docs aligned; Browser STT logic unchanged; no Native punctuation heuristics; a11y + desktop/mobile screenshots.
- **Priority:** P0.

### P0.4 — Timely, privacy-safe tester feedback alert
- **Evidence/gap:** Report Issue persists to the protected store but only surfaces via a daily digest — too slow for a rolling beta.
- **Outcome:** On report submission the owner gets a sanitized real-time alert via the existing private Sentry/ops path; full content stays in the protected store; a bad alert never blocks persistence.
- **Acceptance:** alert payload allowlist = {report ID, severity, release SHA, route/page, STT mode, session ID when available, timestamp} and NOTHING else (no prose/transcript/audio/email/name/tokens/PII); dedupe by report ID; alert failure does not block persistence and is observable; P0/P1 reports elevated severity; owner can retrieve full report by ID; focused tests for persistence-on-success, persistence-on-alert-failure, payload allowlist, no-leakage, dedupe, context, severity mapping.
- **Priority:** P0.

---

## 3. Remaining P1

### P1.1 — Private-first UX polish
- **Gap:** the P0.2 hierarchy needs layout/copy/a11y polish across widths.
- **Outcome:** clean, accessible mode selection at 320/375/390/desktop with no overlap of transcript/sticky-actions/notices.
- **Acceptance:** mobile/desktop layout, copy density, Recommended badge, reduced-motion, accessible names, focus order, contrast, setup/ready/recording/finalizing/exhausted states, status-bar/toast interaction validated at the four widths.
- **Priority:** P1.

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

### P1.4 — Regression, copy & documentation reconciliation
- **Gap:** three-mode behavior + docs/copy need a consolidated pass after P0/P1.
- **Outcome:** proven three-mode matrix and reconciled docs.
- **Acceptance:** full matrix (Browser preview; Private sample→setup→capture→finalize→persist/detail/PDF equality; Cloud existing-Pro-only no-fallback; Free no-Cloud/no-checkout; existing-Pro Cloud works; Report Issue persists + sanitized alert); reconcile BACKLOG.md, RELEASE_STATUS.md, PRODUCT_FEATURES.operational.md, SOFT_RELEASE_TESTER_INSTRUCTIONS.md, UI copy/tests, telemetry docs.
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

**Feature priorities (record only — do NOT implement on the hardening branch):**
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

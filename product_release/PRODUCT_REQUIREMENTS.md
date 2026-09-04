**Status:** Authoritative (SSOT for user-visible product requirements)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-04
**Last Verified:** 2026-09-04 — reconciled to the 4 Sep Production human-test findings and current PO decisions; shipped behavior and approved-not-shipped remedies are distinguished below.
**Applies To:** The SpeakSharp individual speaking-practice product. Enterprise expansion is future direction, not current scope.
**Class:** Product requirement.
**Authority:** User-visible product guarantees, failure behavior, non-goals, and the feature contract.
**Not Authoritative For:** billing and entitlement implementation mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); Progress calculations (→ `PROGRESS_AND_NEXT_ACTION.md`); STT implementation, baselines, and SLOs (→ `STT.md`); persisted schema and retention (→ `ARCHITECTURE.md`); release sequencing (→ `ROADMAP.md`); deployed status (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier multi-product, multi-engine, Free/Pro tier, and accumulated-minute-quota statements in this file are retired.
**Evidence Sources:** Product Owner launch-contract decisions recorded on #1290; canonical owning documents listed in §12; executable repository contract guard.

<!-- pm-currentization:2026-09-04 -->
> [!CAUTION]
> **Currentized 4 Sep 2026 — approved recovery contract; not yet shipped.** The Production test failed both Open Mic and Focus Points. Required recovery: an explicit mic intent survives model preparation and starts recording exactly once when ready; real microphone data drives the waveform; recording uses the conventional red circle/white-square Stop control; provisional transcript churn is bounded; final transcript remains readable after save/teardown; Focus Points uses honest “not detected” language and preserves every entered point; the Session review renders exactly two **What went well** and two **What to improve** suggestions; Home/Open Mic/Focus Points are directly navigable; and Share feedback follows #1404’s exact two-field design. The existing newest-two transcript retention behavior remains unchanged, while customer-facing copy describes availability and expiry without advertising a numeric count. Every outcome has #1259 content-safe telemetry, but telemetry never substitutes for the behavior.

<!-- /pm-currentization:2026-09-04 -->

# SpeakSharp Product Requirements

SpeakSharp is one **Private Practice** product. It helps an individual rehearse a real speaking moment, receive useful feedback, choose one next action, and see comparable personal progress.

This document defines requirements. It does not activate billing, grant a commercial trial, apply a migration, deploy code, or claim that an unqualified release is live.

---

## 1. Target user and job

The primary user is an individual professional rehearsing an interview, update, presentation, or difficult conversation who wants private practice, immediate actionable feedback, and visible personal progress.

The product must let that user:

- rehearse privately without exposure or judgment;
- receive one useful next action rather than a wall of metrics;
- compare progress with their own earlier comparable practice; and
- understand where their audio and saved records go.

Enterprise and team features are deferred until the individual Practice Loop proves demand.

### Strategic hierarchy and present evidence

These terms are deliberately separate; shipping a feature does not prove the next layer:

| Level | SpeakSharp position | Present evidence state |
|---|---|---|
| **Differentiator** | On-device transcription combined with a private Practice Loop, one next action and personal comparable progress | **Credible and implemented.** The precise promise is local STT audio processing, not that every transcript-derived operation is local. |
| **Value proposition** | Rehearse an important speaking moment privately, understand one thing to change and see whether comparable practice improves | **Clear product hypothesis; customer demand and willingness to pay are unvalidated.** |
| **Competitive advantage** | Trust from a specific data boundary plus low marginal transcription cost and a focused repeat-practice experience | **Possible, not proven.** No conversion, retention, CAC, serving-cost or gross-margin evidence establishes superior economics. |
| **Economic moat** | Privacy reputation plus accumulated, consented personal progress and evidence about which accepted actions are followed by improvement | **No established moat.** The recommendation→attempt→directional-outcome loop exists technically, but durable retention, outcome lift and pricing power are not demonstrated. Compliance/test machinery may support trust and enterprise sales; it is reproducible and is not a moat by itself. |
| **Alpha** | Excess investor return from an underpriced durable business | **Not applicable today.** SpeakSharp is private and pre-revenue; the analogous privacy-constrained demand thesis remains untested. |

Filler counts, pace, clarity metrics, generic AI advice, reports and real-time feedback are competitive-parity capabilities. They support the Practice Loop but do not carry the strategy alone. Personal Progress being implemented is also not proof of switching costs: users must return, accept actions and value the accumulated history before that claim is earned.

---

## 2. Private Practice Loop

The repeatable loop is:

> Practice → review feedback → try one focused improvement → see progress → repeat.

Requirements:

- **Open Mic is primary.** A user can begin an unscripted practice without preparing an objective.
- **Focus Points is optional guidance.** A user may prepare a brief and review point coverage, but Focus Points state must never leak into a later Open Mic take.
- Every successfully finalized recording persists the user-owned evidence required for review and comparable Progress.
- Progress is measured against the user's own eligible practice history, never an unexplained universal grade.
- The product presents one next action at a time.

The detailed comparison and repair rules belong to `PROGRESS_AND_NEXT_ACTION.md`.

---

## 3. Customer surfaces and journey

The active customer journey is:

> Public Home → Account Access → Practice Home → Open Mic or optional Focus Points → Practice Session → saved review and Progress.

Existing authenticated users may skip Account Access. Public, signup, Practice, Pricing, Analytics, legal, and tester surfaces must all describe the same Private-only product.

Guided Rehearsal and Live Meeting Companion are not active customer products. They must not appear as available choices or entitlements.

---

## 4. Transcription contract

- Every customer recording uses **Private**, on-device speech-to-text.
- Audio used for Private transcription does not leave the user's device.
- A one-time model download may require a network connection. After setup, transcription runs locally subject to documented platform limitations.
- A recording has exactly one STT producer. There is no mid-recording engine switch and no silent fallback.
- Browser and Cloud transcription are not customer choices or entitlements.
- Native exists only as an isolated deterministic E2E hook. It is not a customer entitlement, production fallback, or public product term.
- A Private transcription failure must show an honest retry or failure state; it must not route the recording to another provider.

The implementation and attribution contracts belong to `STT.md`.

---

## 5. Recording and feedback contract

- The individual-recording technical safety cap is **10 minutes**.
- The 10-minute cap is not a commercial quota and does not reduce or accumulate across recordings.
- Active-trial and paid users have no daily or monthly recording-minute allowance.
- Usage counters may support sanitized operations or telemetry, but they must never deny, nudge, or auto-stop an entitled user.
- During a session, the interface may show the transcript and delivery evidence supported by Private STT.
- After save, the interface shows one authoritative completion/status surface with review and next actions.
- A recording is evaluated only after the mode-specific save requirements are satisfied. Focus Points evaluation additionally requires confirmed objective registration.

---

## 6. Commercial access contract

SpeakSharp is one product, not a feature-tier ladder:

- A new eligible account receives the complete product free for **30 days**.
- After the trial, the same complete product costs **$10/month**.
- Active-trial and paid users receive the same Private-only Practice capabilities.
- Trial UI must describe a trial, not imply that the user is already paid.
- Expiry is determined from server-authoritative time. Client-clock changes cannot extend access.
- At exact expiry, an unpaid user cannot create, record, save, or analyze new practice.
- An expired user retains exact-session review, History, Progress, PDF/export, account management and deletion, billing management where applicable, and upgrade access.
- Existing paid users retain the complete product and billing-management access.
- Commercial-trial grants are immutable and one-time. Activation must not reset, shorten, or extend a prior grant, and paid accounts must not be changed by legacy activation.
- Payments, checkout, webhook entitlement, and commercial activation remain fail-closed until separately authorized and configured.

Exact database, checkout, webhook, activation, and price-validation mechanics belong to `ENTITLEMENTS_AND_BILLING.md` and their implementation PRs.

---

## 7. Privacy and trust

- Private STT audio stays on the user's device.
- Saved transcripts, session measurements, and feedback may be persisted so the user can review History and Progress.
- Audio, transcripts, and raw model output must not enter analytics or error reporting.
- Any service provider that receives customer content must be disclosed with the content and purpose.
- Copy must distinguish on-device transcription from any later server processing over saved text. It must not imply that all product processing is local when it is not.
- Saved evidence is protected by per-user access control and available to the user through the product's review, export, and deletion surfaces.
- Feedback reports persist independently of best-effort analytics or error-reporting delivery.

### 7.1 The four boundary claims (#1367)

These are four separate claims. Collapsing them produces a false promise: **"the transcript never reaches a
server" and "the transcript is never stored" are different statements, and neither is true as written.**

| Claim | Status | Where it is decided in code |
|---|---|---|
| Audio transcription runs on the user's device | **True** | Same-origin worker `services/transcription/engines/transformers-js.worker.ts`; no upload path exists on the Private route |
| Raw audio leaves the device | **Never** | No audio upload path; `ARCHITECTURE.md` §"Retention boundary" |
| Transcript text leaves the device | **Yes, on save** | `lib/storage.ts` sends `p_final_transcript` to `complete_session_v2`; a `failed`/discarded session sends `null` |
| Transcript text is stored server-side | **Yes, bounded** | `sessions.transcript`, retained for the two newest transcript-bearing saved sessions |
| Transcript text reaches a third party | **Yes, on user request** | `get-ai-suggestions` reads the saved transcript and sends it to Google Gemini; user-initiated, and refused unless `transcript_state = 'available'` |
| Derived metrics are stored | **Yes** | Word counts, filler counts, clarity score, WPM, pause metrics |

Customer copy may say that **audio** never leaves the device. It may **not** say or imply that nothing leaves the
device, that the transcript stays local, or that all processing is local.

Retention duration and schema details belong to `ARCHITECTURE.md`; customer-facing disclosures must match the actual deployed contract.

---

## 8. Required failure behavior

| Scenario | Required behavior |
| :--- | :--- |
| Access decision unavailable or uncertain | Fail closed for creation or analysis; do not grant optimistic access. |
| Private model setup/download failure | Show accurate setup, retry, or failure status; never silently switch providers. |
| Private runtime unsupported or slow | Use the approved Private fallback within the on-device implementation; do not expose another customer engine. |
| Billing confirmation delayed or uncertain | Do not grant paid access until authoritative confirmation succeeds. |
| Save delayed | Show a saving state until persistence is confirmed; do not claim completion early. |
| Objective registration fails or throws ambiguously | Do not create a Focus Points evaluation. |
| Trial expires during a journey | Enforce the server-authoritative access boundary while preserving read/export/account/upgrade access. |

---

## 9. Progress contract

- Baseline and previous comparisons use only eligible prior sessions of the same user, cohort, and Practice mode.
- Chronology is deterministic by `(created_at, session_id)` so equal timestamps cannot create self, future, or cross-mode pointers.
- Open Mic and Focus Points histories remain separate.
- Runtime evaluation inputs are immutable after successful creation; deterministic repair may correct historical pointers without rewriting captured measurements.
- No movement is shown until an eligible predecessor exists.

Formulas, metric eligibility, target selection, and presentation belong to `PROGRESS_AND_NEXT_ACTION.md`.

---

## 10. Product boundaries

- No customer-visible Browser, Cloud, Native, provider, model-variant, or engine-choice entitlement.
- No retired Private sample, countdown, sample telemetry, quota upsell, or recording-time-remaining message.
- No daily or monthly accumulated recording-minute gate for active-trial or paid users.
- No avatars or body-language, facial, gesture, posture, or video analysis.
- No continuous or verbose coaching while the user speaks.
- No fabricated or unattributed testimonials.

- Private v4 is OFF unless separately promoted through evidence and Product Owner approval.

- Microphone switching mid-session is not guaranteed; concurrent recording across tabs is blocked.

Future enterprise capabilities, scenario products, or alternative transcription offerings require a new explicit product decision. They are not implied by historical code or documentation.

---

## 11. Release qualification

The product contract is not launch evidence by itself. Launch requires:

- integrated exact-head CI, security, database, and documentation checks;
- a deployed merge-SHA canary with the active-trial Private journey primary and paid-continuation Private journey secondary;
- real-device Practice Loop qualification;
- sanitized telemetry, SLO, canary, and rollback verification;
- zero unresolved critical residue; and
- an explicit GO decision and separately authorized release tag.

Green pull-request CI is not acceptance, deployment proof, migration proof, or launch qualification.

---

## 12. Traceability

- Product access and billing mechanics → `ENTITLEMENTS_AND_BILLING.md`
- Progress calculations and presentation → `PROGRESS_AND_NEXT_ACTION.md`
- STT implementation and evidence → `STT.md`
- Persistence, retention, and deletion → `ARCHITECTURE.md`
- Deferred sequencing → `ROADMAP.md`
- Integrated release posture and identities → `RELEASE_STATUS.md`

Historical documents and code may explain provenance, but they do not override this Product Owner-approved contract.

---

## 13. Strategic assessment (#1367)

Reconciled against the code on `main`; the full claim-by-claim audit is in
The dated [`DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md`](./evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md) §10 records the audit. **This assessment does
not reorder the approved MVP sequence — strategic importance and release order are separate decisions.**

| Dimension | Assessment |
|---|---|
| **Differentiator** | Precise on-device transcription and a focused private-practice loop. |
| **Value proposition** | Clear, but **not validated with users**. |
| **Competitive advantage** | Plausible trust and serving-cost advantages; **not demonstrated economics**. |
| **Moat** | **None proven today.** Longitudinal, consented coaching-outcome evidence is the strongest path. |
| **Alpha** | Not applicable in the public-market sense; the underlying market thesis remains **untested**. |

### 13.1 Validation limits — read before quoting any advantage above

**There is no user research in this repository.** No willingness-to-pay study, no conversion or retention
comparison, no CAC measurement, no cohort analysis. Actual revenue is zero and billing is not activated, so none
of these could have been measured. Every economic advantage above is a **hypothesis**, and must be labelled as
one wherever it is repeated.

Serving cost is **lower, not zero**: transcription is on-device, but AI coaching calls a paid third-party model
per request (§7.1).

### 13.2 What is built, and what that does not prove

- **Personal Progress ships** and is reachable by any authenticated user at `/session`, rendered in every session
  state. Its baseline excludes sessions under 30 seconds and sessions without a composite quality value, so a new
  user sees an insufficient-evidence state rather than an invented trend. **That it exists does not make it a
  moat** — switching costs and retention effects are unproven.
- **Focus Points coverage ships.** The broader executive-rehearsal use case — the assembled end-to-end
  experience — does **not**. "Executive Rehearsal" names a canonical USE CASE of Focus Points, not a
  separate product. These are two
  statuses, not one.
- **Pro-interest capture does not ship.** No reachable frontend action and no complete submission journey exist.
- **The advice → attempt → outcome loop is an instrumentation and attribution gap, not a database join.** The
  prior recommendation is persisted (`next_action_signal`), but attempt evidence, comparable-session eligibility,
  target-specific outcomes and stated attribution limits are all absent. Existing advice plus later improvement
  shows **association only** — never that the user attempted the advice, and never causation.
- **Filler counting is competitive parity and product quality**, currently **unqualified on annotated disfluent
  human speech**. It is not part of any moat claim.
- **The evidence and compliance discipline is genuine trust and sales collateral** and demonstrates execution
  capability. It is reproducible by a competent team and is **not** a durable moat by itself.

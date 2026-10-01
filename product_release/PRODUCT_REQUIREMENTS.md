**Status:** Authoritative (SSOT for user-visible product requirements)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-10-01
**Last Verified:** 2026-10-01 — the MVP product-polish decisions below were reconciled against `main@e4d5e9a54`; they are requirements, not claims that the polish is already shipped.
**Applies To:** The SpeakSharp individual speaking-practice product. Enterprise expansion is future direction, not current scope.
**Class:** Product requirement.
**Authority:** User-visible product guarantees, failure behavior, non-goals, and the feature contract.
**Not Authoritative For:** billing and entitlement implementation mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); Progress calculations (→ `PROGRESS_AND_NEXT_ACTION.md`); STT implementation, baselines, and SLOs (→ `STT.md`); persisted schema and retention (→ `ARCHITECTURE.md`); release sequencing (→ `ROADMAP.md`); deployed status (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier multi-product, multi-engine, Free/Pro tier, and accumulated-minute-quota statements in this file are retired.
**Evidence Sources:** Product Owner launch-contract decisions recorded on #1290; canonical owning documents listed in §12; executable repository contract guard.

<!-- pm-currentization:2026-09-15 -->
> [!CAUTION]
> **Currentized 15 Sep 2026 — shipped foundation and open product contract are distinct.** #1416 shipped direct product navigation, the accepted Share feedback form, corrected labels, and the red Stop control; #1466 shipped the bounded Practice Loop placement/reveal foundation. Still required: #1473 automatic 1+1 review availability and truthful retry, #1471/#1476 durable progress, #1472 filler completeness, and comparable **v2/v4** behavior validating v4 as provisional primary against v2 as fallback (Moonshine deferred until after RWT or MVP). #1474 owns the approved G10 during/after hierarchy and theme: the Practice Loop dominates the first usable post-save viewport while metrics/transcript are secondary. #1475 owns the approved G12 landing page and its full above-fold offer: **30 days free, no card. Then $10/month. Cancel any time.** Newest-one retention remains the approved target and is not activated by this document.
<!-- /pm-currentization:2026-09-15 -->

<!-- po-mvp-polish:2026-10-01 -->
> [!IMPORTANT]
> **PO MVP polish contract — 1 Oct 2026.** The product center is the repeatable private Practice Loop, not a dashboard of speech statistics: **give the person one evidence-backed thing to improve, let them practise it immediately, and show whether the next attempt changed.** Audio privacy is a differentiator, but customer copy must distinguish audio staying on-device from saved transcript text used for AI coaching. These requirements are accepted MVP polish and are separate from the active #1547 Open Mic freeze diagnostic. They do not authorize merge, deploy, migration, paid model execution, or Production writes.
<!-- /po-mvp-polish:2026-10-01 -->

## MVP polish contract — 2026-10-01

### Product center

The experience should make one loop obvious:

> **Speak → get one clear, evidence-backed improvement → practise it again → see whether it changed.**

A completed session is successful only when a user can quickly answer:

> **What is the one thing SpeakSharp wants me to do differently on my next attempt, and why?**

Metrics, transcript, Focus Points coverage, history, charts, and AI are evidence for that loop. They are not competing destinations or independent recommendation authorities.

### A. Immediate, low-risk corrections

These are copy/label changes or small presentation adjustments. Dev may implement them without redesigning product behavior.

1. **Sharpen the public loop + privacy line.**
   - Replace: `Speak. See what to fix. Say it again. Your audio never leaves the browser.`
   - With: **`Speak. Know what to improve. Try again. Your audio stays on your device.`**
   - Intent: clearer outcome, fewer words, device-level privacy language, and the repeat loop in one line.

2. **Use an accurate audio-privacy claim.**
   - Replace: `Your practice audio stays on your device. There is no recording to leak or delete.`
   - With: **`Your practice audio stays on your device. SpeakSharp does not upload or store it.`**
   - Do not imply that transcript text or all session data stays local.

3. **Keep inline AI disclosure provider-agnostic.**
   - Replace vendor-specific inline copy such as `Google Gemini` with:
     **`Your audio stays on this device. Your saved transcript is sent to an AI service to create coaching.`**
   - Product UI names the data and purpose, not a vendor that may change.
   - Legal/privacy documentation may name the current provider(s) and must remain truthful.

4. **Rename the user-facing destination from Analytics to Progress.**
   - Visible nav/page/action labels use **Progress**.
   - Internal route `/analytics`, component names, telemetry names, and persistence identifiers may remain unchanged for MVP.
   - Analytics are evidence inside Progress; they are not the user's goal.

5. **Make the Open Mic choice describe the outcome, not instrumentation.**
   - Replace: `Just speak. Your transcript, fillers and pace, live.`
   - With: **`Speak freely. See what worked and what to change next.`**

### B. Practice Loop behavior polish

These require implementation and focused tests; they are not copy-only changes.

6. **Keep coaching concise without crushing it into six words.**
   - Preserve the simple 1+1 review: **What went well** + **Try this next run**.
   - Remove the six-word hard limit as the product contract.
   - Prompt target: one short sentence per headline, normally **12 words or fewer**; hard parser ceiling **16 words** per headline.
   - The user must get the honest bottom line, not a paragraph or metric dump.
   - The next action must be specific, personalized, and executable on the next take.
   - A recommendation that merely restates a metric is not valid coaching.

7. **Make the supporting evidence explain the recommendation.**
   - `From this session` must be evidence for the displayed recommendation, not an unrelated measurement placed beside it.
   - Use authoritative saved facts:
     - metric + value/comparator when the recommendation is metric-driven;
     - a short transcript phrase/pattern only when it is verifiably present in the saved transcript;
     - Focus Point + detected/not-detected status + timing when Focus evidence drives the recommendation.
   - Show no more than **two short evidence lines**.
   - Where measurable, add one concise **next-run check** (for example, `All 3 points introduced before 2:00`).
   - No invented causal explanation and no unsupported transcript quotation.

8. **Establish one canonical Current Practice Target.**
   - Session review, Home resume, saved-session Progress detail, and the linked repeat must show/carry the **same target** for the same completed session.
   - Progress-wide trend analysis may recommend changing the target only by explicitly replacing it; it must not silently compete with the current target.
   - The target persists into **Practice this again** and the next comparable attempt records whether movement occurred.
   - Focus Points uses the same target concept, biased toward placement, sequencing, transitions/signposting, and pacing around the user's chosen points rather than merely repeating a detected/not-detected count.

### C. Privacy timing

The first automatic AI coaching send must not be a surprise.

- Before the first eligible transcript is sent for automatic AI coaching, the product must visibly state the provider-agnostic disclosure in A3.
- This is disclosure, not a new consent-click gate.
- Audio remains on-device; saved transcript text may leave the device for AI coaching.
- Product UI stays provider-agnostic; Privacy/Legal carries the current provider detail.

### D. RWT / MVP acceptance

RWT must explicitly verify the Practice Loop rather than only the existence of cards and metrics.

Required sequence:

> **review visible → target understood → Practice this again selected → same target carried into the repeat → next outcome measured**

The tester acceptance question is:

> **What is the one thing SpeakSharp wants you to do differently on your next attempt, and why?**

Pass requires the tester to answer both the **action** and its **evidence** from the visible product without interpreting raw charts or inventing the connection.

Under the standing observability rule, any missing telemetry needed to prove these steps becomes part of the corresponding fix.

### E. Deliberate hold

**Landing hero CTA wording remains unchanged for now.**

`Start your session` currently routes an anonymous visitor to account creation. `Start practicing free` may predict the immediate signup step more literally, but this is not accepted as an MVP change yet. Revisit with RWT/user evidence; do not change it merely for consistency.



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

Existing authenticated users may skip Account Access. Public, signup, Practice, Pricing, **Progress** (internal route `/analytics`), legal, and tester surfaces must all describe the same Private-only product.

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
| Transcript text is stored server-side | **Yes, bounded** | `sessions.transcript`, retained only for the newest transcript-bearing saved session; every older transcript expires |
| Transcript text reaches a third party | **Yes, for AI coaching** | `get-ai-suggestions` reads the saved transcript and sends the minimum required text to the configured AI coaching provider; a Focus Points take may also send its saved topic and point labels. Customer UI names the data and purpose rather than binding the product contract to one vendor; Privacy/Legal records the current provider(s). |
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

**Status:** Authoritative (SSOT for user-visible product requirements)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-27
**Last Verified:** 2026-07-27 (every requirement traced to `PRD.operational.md`, `PRODUCT_FEATURES.operational.md`, and the code paths cited inline; no volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`)
**Applies To:** The SpeakSharp beta product — individual speaking practice. Enterprise expansion is future direction, not current scope.
**Class:** Product requirement.
**Authority:** The only source for user-visible product guarantees, failure behavior, non-goals, and the feature contract.
**Not Authoritative For:** tier / entitlement / quota / billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); the Session Progress / scoring model (→ `COACHING_SCORE.md`); STT runtime and data contracts, baselines, and SLOs (→ `STT.md`); structural design (→ `ARCHITECTURE.md`); deferred / future sequencing (→ `ROADMAP.md`); current release & deployment status (→ `RELEASE_STATUS.md`).
**Supersedes:** `PRD.operational.md` and `PRODUCT_FEATURES.operational.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §2 / §3.B extraction mapping; the `frontend/` and `backend/` code paths cited inline; freshness-labeled competitive references (Product Owner-cited, not independently verified by Engineering).

# SpeakSharp Product Requirements (v1)

Canonical statement of what SpeakSharp promises to users, how it must behave when things go wrong, what it deliberately does not do, and the contract for each product surface. This document is a **requirements** doc, not a status or implementation doc: it changes only by Product Owner decision, and it carries no volatile release facts. Consolidated from `PRD.operational.md` and `PRODUCT_FEATURES.operational.md`; content that belongs to a sibling canonical doc is routed there rather than duplicated.

This is a **documentation** artifact. It defines requirements; it does not change any application code, database configuration, quota, price, payment switch, or entitlement behavior.

---

## 1. Target users & jobs-to-be-done

**Primary user.** Individual professionals rehearsing important speaking moments — interviews, executive updates, presentations, high-stakes conversations — who want private, trustworthy practice, immediate actionable feedback, and visible personal progress.

**Jobs-to-be-done.**
- Rehearse a real upcoming speaking moment in private, without exposure or judgment.
- Get feedback that is immediately useful (one thing to fix), not a wall of metrics.
- See whether they improved against **their own** previous comparable practice.
- Trust where their audio and records go, and stay in control of them.

**Secondary / deferred.** Enterprise and team expansion remains secondary and is deferred until the individual core loop proves demand. It is named here only as direction, not as current scope.

---

## 2. Product outcome & the core loop

SpeakSharp is not a transcription app; it is a private speech-practice coach. The transcript is the evidence layer for coaching — the product is the coaching, not the transcription.

The product must move a user through a short, repeatable loop:

> Practice → see useful feedback → try one focused improvement → see progress → come back.

Requirements:
- The product surfaces **one** actionable next focus at a time, rather than many simultaneous metrics.
- Progress is measured against the user's **own** baseline and self-selected/accepted targets — SpeakSharp must **not** grade the person against an unexplained universal standard.
- Raw measurements and how they combine remain transparent to the user.

The detailed Session Progress / Personal Progress model — including the staged retirement of the legacy 0–10 SpeakSharp Score — is owned by `COACHING_SCORE.md`. At the requirements level: the legacy 0–10 score is on a declared retirement path and must **not** be presented as the long-term experience, deepened, or rescaled to 0–100.

---

## 3. Surfaces & journey

**Public marketing vs authenticated product.** The public marketing home is a discovery surface for logged-out visitors; the authenticated product entry is `/practice`. (Public marketing/product-discovery requirements are tracked separately and are not part of this document's current scope.)

**Approved journey (durable).** Public Marketing Home → **Account Access** (new / logged-out users) → **Practice Choices** → direct **Practice Session** or **Guided Rehearsal**. Existing authenticated users **skip Account Access** and land on Practice Choices.

**Terminology (Product Owner decision).** The individual practice product is **Freestyle Practice** (renamed from the earlier "Quick Practice"). The recording page is the **Practice Session**. STT methods are **Private / Browser / Cloud** (no user-facing "Native"). **Guided Rehearsal** is a named, currently-unavailable product surface.

---

## 4. Product contracts (per surface)

### 4.1 Freestyle Practice & the Practice Session
- Freestyle Practice is available now: the user starts a Practice Session directly and sees a live transcript plus live delivery signals (WPM, fillers, pauses, clarity).
- Every finalized recording MUST persist a `sessions` record with the artifacts needed for returning-user comparison: transcript text, duration, total words, WPM, clarity, filler/custom-word counts, pause metrics, AI suggestions when generated, STT engine/mode metadata, and optional ground-truth/WER fields. Transcript storage is required for WER, AI-feedback caching, PDF regeneration, and session-over-session coaching until a separate redaction/encryption design exists.

### 4.2 Transcription methods (Private / Browser / Cloud)
- **Private** is the recommended method and the main beta experience: local, on-device transcription after a one-time model setup. **Private STT audio MUST NOT leave the user's browser.** Private is announced with a durable "Stays local" privacy signal. (`frontend/src/services/transcription/modes/PrivateWhisper.ts`.)
- **Browser** is a free, zero-download convenience path presented as a **"Quick preview"** — explicitly **not** equivalent to Private (it may miss punctuation and fillers). Availability and accuracy vary by browser; Chrome desktop is the recommended baseline. (`frontend/src/services/transcription/modes/NativeBrowser.ts`.)
- **Cloud** is an AssemblyAI-backed method selected explicitly by the user and gated behind Pro entitlement. Cloud STT is unavailable to Free users and remains an entitled-Pro capability; existing or explicitly comped Pro accounts retain access. (`frontend/src/services/transcription/modes/CloudAssemblyAI.ts`; entitlement mechanics → `ENTITLEMENTS_AND_BILLING.md`.)
- **No silent switching.** Private MUST NOT silently switch to Cloud (or any other method). A method change requires explicit user selection and, for Cloud, Pro entitlement.

### 4.3 One recording = one STT producer (from #1033)
One persisted recording/transcript has **exactly one** STT producer. The method selector is disabled from recording Start through finalization and save; a newly selected method applies only to the **next** recording. There is no user- or code-triggered mid-recording engine switch, no mixed-engine record, and no silent fallback. This is a product requirement; its runtime and data contract (attribution persistence, recovery) is specified in `STT.md`.

### 4.4 Guided Rehearsal (currently unavailable)
Guided Rehearsal is presented as a named product that is **not available yet** — a clear "Planned — not available yet" state and a single contextual "Product not available at this time" notice anchored to the surface, never a silent or misleading control. It is future direction (see §7), not shipped functionality.

### 4.5 Post-save experience
After a session is saved the user sees exactly **one** authoritative status surface (`StatusNotificationBar`) carrying the finalized transcript, a quiet secondary Private-continuation CTA, and a single persistent, accessible Analytics action. There is **no** completion toast and **no** "Next: Analytics" overlay. On mobile the same single bar stacks vertically. (`frontend/src/components/session/StatusNotificationBar.tsx`.)

---

## 5. Privacy & trust promises

- **Private audio stays local.** Private-method audio MUST NOT leave the user's browser.
- **Feedback records are user-owned and durable.** Issue/feedback reports MUST persist to the authoritative Supabase store independently of analytics/observability delivery; a PostHog capture or Sentry event ID is best-effort observability, NOT proof of persistence, and feedback persistence MUST NOT depend on analytics succeeding.
- **Honest processing boundary.** Private transcription can keep audio on-device, but semantic AI over transcripts or rehearsal content may require explicit cloud processing unless a local semantic model is separately built — the product must not imply all content stays on-device when it does not.
- **Provenance.** Each recording's producing method is attributed honestly (contract in `STT.md`); the product must not misrepresent which method produced a transcript.

---

## 6. User-visible failure behavior

| Scenario | Required behavior |
| :--- | :--- |
| Quota service unavailable | **Fail-closed**: no new session starts if the limit check fails. |
| Model-download failure (Private) | Notify the user, show retry/setup status, and offer Browser or Cloud only as **explicit** user-selectable alternatives — never silently route a Private user to Cloud. |
| WebGPU unsupported/slow | Continue on the launch-default CPU/Transformers.js Private path; WebGPU probing must fail fast and must not make the user wait before CPU setup proceeds. |
| Billing confirmation delayed | Keep the user on Free until entitlement is confirmed; do not grant optimistic Pro access. |
| Transcription silence | A heartbeat watchdog MUST trigger auto-reconnect or a failure state within 8s. |
| Database latency on save | Show a "Saving…" indicator until persistence is confirmed. |
| PDF export | Do not block or count PDF exports for Free users; all exported PDFs (including Pro) carry SpeakSharp branding/watermarking. |
| Cloud audio-chunk violation | Treat an AssemblyAI input-duration violation / close code `3007` as an audio-chunking defect until proven otherwise; the STT chunk contract lives in `STT.md`. |

---

## 7. Tiering & access rules

Product-level tier rules only. Exact quota limits, pricing, packaging, checkout, and entitlement mechanics are owned by `ENTITLEMENTS_AND_BILLING.md`; this document preserves current deployed behavior and does not set final policy.

- **Tiers.** Free and Pro are the current product tiers.
- **Cloud.** Cloud STT is unavailable to Free users and remains an entitled-Pro capability; existing or explicitly comped Pro accounts retain access.
- **No-billing beta.** During the temporary no-billing beta, checkout and live charges are prevented by the two payment switches (`VITE_PAYMENTS_ENABLED` and `PAYMENTS_ENABLED`); either switch off keeps checkout closed. Payment/upgrade surfaces may remain visible while actual charging is disabled.
- **Quotas.** Daily/monthly usage is capped by tier and enforced fail-closed. The **exact** daily/monthly quota values, future pricing, and final paid-Pro packaging are **unresolved** and are routed to `ENTITLEMENTS_AND_BILLING.md` and the later pricing review. Any currently deployed values (e.g., the presently-observed `1h/day` Free and `2h/day` Pro configuration) are recorded as **observed configuration, not Product Owner-approved final policy**.
- **Provenance of proof.** The accepted functional proof for paid enrollment is the test-mode checkout → webhook → entitlement journey; a real-money transaction is **not** required as an Engineering/CI/QA or launch proof. Details live in `ENTITLEMENTS_AND_BILLING.md`.

---

## 8. Success criteria

Product-level targets (measurement taxonomy and evidence live in `QUALITY.md` and `STT.md`):
- **Conversion:** target 2% Free → Pro.
- **Retention:** target > 30% Day-7 retention for active practitioners.
- **STT accuracy:** Private WER < 10%; Cloud WER < 8%. Cloud release validation requires a live transcript against the canonical fixture with matching ground truth — a `200` token and an open WebSocket are readiness evidence only, not success.

---

## 9. Competitive posture

SpeakSharp competes by protecting a defensible moat rather than matching feature breadth. Priorities:
- Lead on **trustworthy Private / on-device practice**, transparent Browser/Cloud/Private choice, **no silent engine switching**, precise provenance, and user-owned records.
- Prioritize **instant useful feedback + one next action + progress visibility + scenario practice**.
- **Defer** meeting surveillance, multi-persona roleplay, and broad enterprise administration until the individual core loop proves demand.

Scenario practice (Executive Rehearsal) and enterprise capabilities are described here as **priorities and future direction — not shipped functionality**.

Competitive references (freshness-labeled; Product Owner-cited on 2026-07-24, **not** independently verified by Engineering; re-verify URLs before relying on them): Orai (immediate feedback, daily practice, visible progress, one next action); Yoodli (scenarios, roleplay, org content, cohort analytics); Speeko (zero-data-handling + enterprise SSO as a concrete privacy operating contract). These are competitor marketing claims, not product benchmarks.

---

## 10. Non-goals & explicit boundaries

- **Testimonials stay hidden** until the Product Owner approves real, verified testimonial content. No placeholder, fabricated, synthetic, or unattributed testimonial may appear publicly.
- **The legacy 0–10 SpeakSharp Score is not the long-term experience** — it is on a staged retirement path and must not be presented as validated assessment, deepened, or rescaled to 0–100 (model → `COACHING_SCORE.md`).
- **No avatars or body-language / facial / gesture / posture / video analysis.**
- **No continuous or verbose live coaching**, no paragraphs of live advice, and no automatic intervention while the user is speaking in the first stage.
- **Executive Rehearsal is future direction, not shipped.** Its initial live behavior, when built, is **passive** agenda tracking (not-addressed / partly / covered / recovered-after-guidance) with attributable evidence; correction is user-requested first; any automatic pause-aware cue is a later, separately-activated experiment. Delivery progress and agenda coverage stay separate.
- **Live Meeting Companion is future direction only** — removed from active sequencing; re-scoped separately only after Rehearsal proves value.
- **Enterprise / team / pricing-packaging expansion is deferred** until the individual loop proves demand.
- **Private v4 activation remains OFF and out of scope** for the current product.
- **Platform boundaries:** microphone switching mid-session is not guaranteed (Bluetooth handoff); mobile-Safari offline Private STT is experimental / best-effort; concurrent recording across multiple tabs is blocked by mutex.

---

## 11. Traceability

Every requirement above maps to an extracted row in `DOC_MIGRATION_LEDGER.md` §3.B for `PRD.operational.md` and `PRODUCT_FEATURES.operational.md`, or to the code path cited inline. Content that the ledger routes elsewhere is deferred to its owner: the Personal Progress / scoring model → `COACHING_SCORE.md`; tier/quota/billing mechanics → `ENTITLEMENTS_AND_BILLING.md`; STT baselines, accuracy, and the attribution/runtime contract → `STT.md`; accepted future candidates and timing → `ROADMAP.md`; current release posture → `RELEASE_STATUS.md`.

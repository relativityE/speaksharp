**Status:** Authoritative (SSOT for user-visible product requirements)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-27
**Last Verified:** 2026-07-27 — consolidated from approved sources (`PRD.operational.md`, `PRODUCT_FEATURES.operational.md`) and checked against the cited code paths where implemented; future and provisional requirements are explicitly labeled. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta product — individual speaking practice. Enterprise expansion is future direction, not current scope.
**Class:** Product requirement.
**Authority:** The source for user-visible product guarantees, failure behavior, non-goals, and the feature contract.
**Not Authoritative For:** tier / entitlement / quota / billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); the personal progress and next-action contract, its calculation and presentation (→ `PROGRESS_AND_NEXT_ACTION.md`); STT runtime and data contracts, baselines, accuracy, and SLOs (→ `STT.md`); structural design, persisted schema, and retention (→ `ARCHITECTURE.md`); deferred / future sequencing (→ `ROADMAP.md`); current release & deployment status (→ `RELEASE_STATUS.md`).
**Supersedes:** `PRD.operational.md` and `PRODUCT_FEATURES.operational.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §2 / §3.B extraction mapping; the `frontend/` and `backend/` code paths cited inline; freshness-labeled competitive references (Product Owner-cited, not independently verified by Engineering).

# SpeakSharp Product Requirements (v1)

Canonical statement of what SpeakSharp promises to users, how it must behave when things go wrong, what it deliberately does not do, and the contract for each product surface. This is a **requirements** doc, not a status, schema, or implementation doc: it changes only by Product Owner decision, carries no volatile release facts, and routes implementation detail to its owning canonical document. Consolidated from `PRD.operational.md` and `PRODUCT_FEATURES.operational.md`.

This is a **documentation** artifact. It defines requirements; it does not change any application code, database configuration, quota, price, payment switch, or entitlement behavior. Requirements that describe future or not-yet-proven capability are labeled as such.

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

The detailed personal progress and next-action contract — including the retirement of the legacy 0–10 SpeakSharp Score — is owned by `PROGRESS_AND_NEXT_ACTION.md`. At the requirements level: the legacy 0–10 score is on a declared retirement path and must **not** be presented as the long-term experience, deepened, or rescaled to 0–100.

---

## 3. Surfaces & information architecture

Requirement-level IA (the concrete public-marketing implementation is tracked in #1061 and is out of scope here):

- **Public `/`** is the logged-out discovery / marketing surface. It must disclose **both** products — Freestyle Practice and Guided Rehearsal — with truthful availability, rather than skewing to one.
- **Authenticated `/practice`** is the next-action **Practice Home**, not duplicated marketing: it orients the returning user to their next practice and recent progress.
- **Freestyle intent continues through authentication toward `/session`** — a logged-out user choosing Freestyle is carried through Account Access into the Practice Session without losing intent.
- **Guided Rehearsal remains planned / unavailable** on both surfaces.

**Approved journey (durable).** Public Marketing Home → **Account Access** (new / logged-out users) → **Practice Choices** → direct **Practice Session** or **Guided Rehearsal**. Existing authenticated users **skip Account Access** and land on the Practice Home.

**Terminology (Product Owner decision).** The individual practice product is **Freestyle Practice** (renamed from the earlier "Quick Practice"). The recording page is the **Practice Session**. STT methods are **Private / Browser / Cloud** (no user-facing "Native"). **Guided Rehearsal** is a named, currently-unavailable product surface.

---

## 4. Product contracts (per surface)

### 4.1 Freestyle Practice & the Practice Session
- Freestyle Practice is available now: the user starts a Practice Session directly and sees a live transcript plus live delivery cues (see §4.6).
- Every finalized recording MUST persist the **user-owned evidence needed for later review and progress** — the saved session with its transcript, delivery measurements, and any generated feedback — so a returning user can review and compare their practice. The exact persisted schema, retention policy, and STT/attribution mechanics are specified in `ARCHITECTURE.md`, `STT.md`, and `PROGRESS_AND_NEXT_ACTION.md`, not here.

### 4.2 Transcription methods (Private / Browser / Cloud)
- **Private** is the on-device method: local transcription after a one-time model setup, announced with a durable **"Stays local"** privacy signal. **Private STT audio MUST NOT leave the user's browser.** After the initial model download/setup, Private transcription MUST function **without an internet connection**, subject to the platform limitations in §10. (`frontend/src/services/transcription/modes/PrivateWhisper.ts`.) *(Whether Private is additionally positioned as the "recommended" or "main" experience is a separate, explicit Product Owner decision — not asserted here, and not inferred from prior UI copy.)*
- **Browser** is a free, zero-download convenience path presented as a **"Quick preview"** — explicitly **not** equivalent to Private (it may miss punctuation and fillers). Availability and accuracy vary by browser; Chrome desktop is the recommended baseline. (`frontend/src/services/transcription/modes/NativeBrowser.ts`.)
- **Cloud** is an AssemblyAI-backed method selected explicitly by the user and gated behind Pro entitlement. Cloud STT is unavailable to Free users and remains an entitled-Pro capability; existing or explicitly comped Pro accounts retain access. (`frontend/src/services/transcription/modes/CloudAssemblyAI.ts`; entitlement mechanics → `ENTITLEMENTS_AND_BILLING.md`.)
- **No silent switching.** Private MUST NOT silently switch to Cloud (or any other method). A method change requires explicit user selection and, for Cloud, Pro entitlement.

### 4.3 One recording = one STT producer (from #1033)
One persisted recording/transcript has **exactly one** STT producer. The method selector is disabled from recording Start through finalization and save; a newly selected method applies only to the **next** recording. There is no user- or code-triggered mid-recording engine switch, no mixed-engine record, and no silent fallback. This is a product requirement; its runtime and data contract (attribution persistence, recovery) is specified in `STT.md`.

### 4.4 Guided Rehearsal (currently unavailable)
Guided Rehearsal is presented as a named product that is **not available yet** — a clear "Planned — not available yet" state and a single contextual "Product not available at this time" notice anchored to the surface, never a silent or misleading control. It is future direction (see §7 and §10), not shipped functionality.

### 4.5 Post-save experience
After a session is saved the user sees exactly **one** authoritative status surface (`StatusNotificationBar`) that displays **status plus post-save actions** — a quiet secondary Private-continuation CTA and a single persistent, accessible Analytics action. The **transcript remains in its transcript/session surface**; the status bar does not re-carry it. There is **no** completion toast and **no** "Next: Analytics" overlay. On mobile the same single bar stacks vertically. (`frontend/src/components/session/StatusNotificationBar.tsx`.)

### 4.6 Live vs post-save evidence
Live and post-save feedback are distinct and must not be conflated:
- **Live (during the Practice Session):** a live transcript and live delivery cues — for example words-per-minute and filler indications — **where the selected engine/path supports them** (support varies by method; Browser "Quick preview" may omit fillers/punctuation).
- **Post-save (analysis):** fuller delivery and content analysis — including clarity signals and semantic/AI suggestions — computed after the recording is finalized and saved.

Requirements must not claim a measurement is live unless the current code path provides it live for the selected method.

---

## 5. Privacy & trust promises

- **Private audio stays local.** Private-method audio MUST NOT leave the user's browser, and Private must keep working offline after initial setup (§4.2).
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

## 8. Personal progress contract (requirement level)

Requirement-level only; formulas, comparability rules, metric eligibility, and presentation are owned by `PROGRESS_AND_NEXT_ACTION.md`.

- The user's baseline is the **first eligible session evaluated under Progress v1 after activation** — not an ambiguous historical "first qualifying session". Sessions recorded before activation are **never** retro-fitted into a baseline. Until that first eligible session exists, no movement is shown, and an invented or fabricated change MUST NOT be displayed. (Eligibility and the full baseline rule are owned by `PROGRESS_AND_NEXT_ACTION.md`.)
- **Later comparable sessions** show both the change from the **previous** comparable session and the cumulative change from **baseline**.
- Progress is expressed against the user's **own** baseline/targets and attributable measurements — never an unexplained universal grade.

---

## 9. Success criteria (provisional planning targets)

These are **provisional planning targets, not validated product claims.** Each remains provisional until `QUALITY.md` (conversion/retention/quality evidence) or `STT.md` (accuracy evidence) supplies Product Owner-approved evidence:
- **Conversion:** planning target 2% Free → Pro.
- **Retention:** planning target > 30% Day-7 retention for active practitioners.
- **STT accuracy:** planning targets Private WER < 10%, Cloud WER < 8%. Cloud release validation requires a live transcript against the canonical fixture with matching ground truth — a `200` token and an open WebSocket are readiness evidence only, not success. Authoritative accuracy evidence lives in `STT.md`.

---

## 10. Competitive posture

SpeakSharp competes by protecting a defensible moat rather than matching feature breadth. Priorities:
- Lead on **trustworthy Private / on-device practice**, transparent Browser/Cloud/Private choice, **no silent engine switching**, precise provenance, and user-owned records.
- Prioritize **instant useful feedback + one next action + progress visibility + scenario practice**.
- **Defer** meeting surveillance, multi-persona roleplay, and broad enterprise administration until the individual core loop proves demand.

Scenario practice (Guided Rehearsal) and enterprise capabilities are described here as **priorities and future direction — not shipped functionality.**

Competitive references (freshness-labeled; Product Owner-cited on 2026-07-24, **not** independently verified by Engineering; re-verify URLs before relying on them): Orai (immediate feedback, daily practice, visible progress, one next action); Yoodli (scenarios, roleplay, org content, cohort analytics); Speeko (zero-data-handling + enterprise SSO as a concrete privacy operating contract). These are competitor marketing claims, not product benchmarks.

---

## 10a. Enterprise readiness (requirements only — no platform buildout)

Enterprise buyers expect an admin surface, SSO/SCIM, retention and deletion controls, exports, auditability and an SLA. This section **defines the requirements and the demand trigger for each**; it authorizes **no** implementation. The governing rule is: **do not build the enterprise platform ahead of a validated design partner or a signed requirement.** Entitlement mechanics live in `ENTITLEMENTS_AND_BILLING.md`; structural implications in `ARCHITECTURE.md`; sequencing in `ROADMAP.md`.

**Classification vocabulary.** *Now* = a standing obligation we already owe, independent of any enterprise deal. *Next* = do it when the named trigger fires. *Later* = real requirement, deliberately deferred until demand is proven. *Declined* = we have decided not to do it; revisiting requires a new decision.

| Capability | Class | Requirement | Implementation trigger |
|---|---|---|---|
| **Transcript & audio retention + deletion** | **Now** | **Two distinct obligations, both required — satisfying one does not satisfy the other.** (a) A user can delete a saved session and its derived evidence. (b) A retention **duration** is decided and stated plainly. This is a privacy obligation to individual users, not an enterprise feature. | None — standing obligation. **Two open gaps → `ROADMAP.md`: (a) no user-facing session deletion exists today; (b) the retention duration is an UNRESOLVED policy decision requiring Product-Owner approval** (`ARCHITECTURE.md` §15). Shipping deletion alone does **not** close this row. |
| **Zero-data / private mode** | **Now** | Stated as a concrete operating contract (below), not as generic "private" marketing copy. | None — standing obligation; Private STT already keeps audio on-device. |
| **Sub-processor & data-handling disclosure** | **Next** | Name every third party that receives customer content, what it receives, and under which terms. | First enterprise or privacy enquiry. **Gap: no DPA or sub-processor register exists in-repo; the AI-phrasing provider's terms are unverified** → `ROADMAP.md`. |
| **Auditability (admin-visible access & change log)** | **Next** | Record who accessed or changed org-scoped data, retained for a stated window. | A signed requirement naming the retention period. |
| **Organization / admin model** | **Later** | Accounts belong to an organization; an admin can see membership and org-scoped settings. | A validated design partner **or** a signed multi-seat requirement. |
| **SSO / SCIM + bulk provisioning** | **Later** | SAML/OIDC sign-in and SCIM lifecycle against a named IdP. | A signed requirement **naming the IdP** — never built speculatively. |
| **Cohort analytics & exports** | **Later** | Aggregate, non-identifying org-level reporting plus an export. | The organization model exists **and** a partner has asked for it. |
| **Custom scenarios / content** | **Later** | Organizations supply their own rehearsal scenarios. | Guided Rehearsal (#1046) shipped **and** a design partner requests it. |
| **Support / SLA / procurement terms** | **Later** | Stated response targets, uptime commitment and procurement documents. | Entering a contract negotiation. |
| **Tenant-partitioned infrastructure (separate per-tenant databases/deployments, per-tenant models, on-prem/self-hosted)** | **Declined** | **Physical partitioning** is not pursued. **This does not decline logical isolation:** if the organization model ships, org-scoped data (membership, settings, cohort reporting) **must** be isolated between organizations — layered on top of per-user RLS, which remains the base guarantee and is never weakened. What is declined is separate infrastructure per customer, per-tenant models, and on-prem/self-hosted deployment. | Reversing this requires a new Product-Owner decision, not a trigger. |

### The privacy operating contract (what "private" concretely means)

SpeakSharp's differentiator is that this is **specific and checkable**, not a checkbox:

- **Private transcription runs on the user's own device.** Audio for a Private session is not uploaded; the model runs locally (see `STT.md`).
- **Audio is never sent to analytics or error reporting.** No transcript, audio, or raw model output enters PostHog or Sentry.
- **A user's saved evidence belongs to that user**, is readable only by them under row-level security, and must be deletable by them.
- **Any third party that receives customer content must be named** before that path is offered — including any optional AI phrasing provider.
- **Cloud transcription is an explicit, entitled choice**, never a silent fallback from Private.

Where the product cannot yet honour one of these, the gap is recorded in `ROADMAP.md` rather than papered over in copy.

### Competitive references (marketing, not verified behaviour)

Enterprise expectations above are informed by competitor **marketing pages** — [Yoodli enterprise](https://e.yoodli.ai/) and [Speeko business](https://www.speeko.co/business) / [Speeko privacy](https://www.speeko.co/privacy), captured **2026-07-31**. These are **vendor marketing claims, not independently verified behaviour**, and they are used only to enumerate *what buyers ask for*. They must not be restated as factual benchmarks or as competitor capabilities we have confirmed.

---

## 11. Non-goals & explicit boundaries

- **Testimonials stay hidden** until the Product Owner approves real, verified testimonial content. No placeholder, fabricated, synthetic, or unattributed testimonial may appear publicly.
- **The legacy 0–10 SpeakSharp Score is not the long-term experience** — it is on a staged retirement path and must not be presented as validated assessment, deepened, or rescaled to 0–100 (model → `PROGRESS_AND_NEXT_ACTION.md`).
- **No avatars or body-language / facial / gesture / posture / video analysis.**
- **No continuous or verbose live coaching**, no paragraphs of live advice, and no automatic intervention while the user is speaking in the first stage.
- **Guided Rehearsal is future direction, not shipped.** Its initial live behavior, when built, is **passive** agenda tracking (not-addressed / partly / covered / recovered-after-guidance) with attributable evidence; correction is user-requested first; any automatic pause-aware cue is a later, separately-activated experiment. Delivery progress and agenda coverage stay separate.
- **Live Meeting Companion is future direction only** — removed from active sequencing; re-scoped separately only after Guided Rehearsal proves value.
- **Enterprise / team / pricing-packaging expansion is deferred** until the individual loop proves demand.
- **Private v4 activation remains OFF and out of scope** for the current product.
- **Platform boundaries:** microphone switching mid-session is not guaranteed (Bluetooth handoff); mobile-Safari offline Private STT is experimental / best-effort; concurrent recording across multiple tabs is blocked by mutex.

---

## 12. Traceability

Every requirement above maps to an extracted row in `DOC_MIGRATION_LEDGER.md` §3.B for `PRD.operational.md` and `PRODUCT_FEATURES.operational.md`, or to the code path cited inline. Content that the ledger routes elsewhere is deferred to its owner: the personal progress and next-action contract, its calculation and presentation → `PROGRESS_AND_NEXT_ACTION.md`; tier/quota/billing mechanics → `ENTITLEMENTS_AND_BILLING.md`; STT baselines, accuracy, and the attribution/runtime contract → `STT.md`; persisted schema and retention → `ARCHITECTURE.md`; accepted future candidates and timing → `ROADMAP.md`; current release posture → `RELEASE_STATUS.md`.

**Status:** Authoritative (SSOT for STT runtime & data contracts, baselines, accuracy, and SLOs)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — consolidated from approved sources (`STT_BASELINE_CONTRACTS.operational.md`, `PRIVATE_STT_ACCURACY_LEVERS.md`, `stt-perf-proof-protocol.md`, STT rows of `SERVICE_LEVELS.operational.md`) and the #1033 single-producer decision. Numeric targets are carried only where an approved source exists; every unproven target is labeled. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** The four SpeakSharp speech-to-text engines — Browser, Cloud, Private v2, Private v4 — and the shared recording/transcript lifecycle.
**Class:** Runtime & data contract.
**Authority:** The source for per-engine purpose, audio/data route, lifecycle and failure behavior, accuracy baselines, metric-validity rules, and internal STT SLOs.
**Not Authoritative For:** user-visible product guarantees and copy (→ `PRODUCT_REQUIREMENTS.md`); tier / entitlement / quota gating of engines (→ `ENTITLEMENTS_AND_BILLING.md`); the Session Progress / scoring model (→ `COACHING_SCORE.md`); persisted schema and retention (→ `ARCHITECTURE.md`); current release & deployment status (→ `RELEASE_STATUS.md`); deferred sequencing (→ `ROADMAP.md`).
**Supersedes:** `STT_BASELINE_CONTRACTS.operational.md`, `PRIVATE_STT_ACCURACY_LEVERS.md`, and the STT portions of `stt-perf-proof-protocol.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `STT_BASELINE_CONTRACTS.operational.md` (baselines, drop-in definitions, stored targets); `SERVICE_LEVELS.operational.md` §STT (SLOs, SLO/SLA vocabulary); `tests/STT_BENCHMARKS.json` (stored numeric targets); the `frontend/src/services/transcription/` code paths cited inline; issue #1033 (single-producer invariant), #1044 (v4 HOLD decision).

# SpeakSharp STT Contract (v1)

Canonical, per-engine statement of how each speech-to-text engine must behave: what it is for and who may use it, where the audio and transcript go, how it initializes / streams / stops / finalizes / saves, the conditions it supports, which metrics are valid and which are not, how it fails, and what evidence is required before an STT claim or release. It changes only by Product Owner decision and routes user-facing copy to `PRODUCT_REQUIREMENTS.md` and entitlement gating to `ENTITLEMENTS_AND_BILLING.md`.

**No numeric target appears here without an approved source.** Where a target is aspirational or unproven, it is labeled `UNPROVEN` and routed to `ROADMAP.md`; it must not be presented to users or externally as a measured result.

## Engine map (user-facing name → internal token)

| User-facing name | Internal engine token | Tier eligibility | Default? |
|---|---|---|---|
| **Browser** | `native` | All authenticated users (the free convenience path) | **Yes — the mode a new session starts on** (`defaultMode = 'native'`, `useSessionLifecycle.ts`), for zero-setup quick start |
| **Cloud** | `cloud` (AssemblyAI Universal-Streaming) | **Pro-entitled only** (real Stripe subscription id, or a comped/QA synthetic id per `ENTITLEMENTS_AND_BILLING.md` §6); never live-charged in the beta; never offered to un-entitled Free testers | No |
| **Private (v2)** | `private` / persisted `private_v2` (e.g. `private_v2:whisper-base.en`, Whisper base.en, on-device) | **Pro, OR an active one-time Free Private sample** (`canUsePrivateStt = isPro \|\| hasActivePrivateSample`, `useSessionLifecycle.ts`) — **not** all authenticated users | No auto-start — the **recommended** higher-quality engine, selected once entitled |
| **Private v4** | `private_v4` (Whisper WebGPU) | **OFF — research only** | No — hard-disabled |

Naming is a product decision owned by `PRODUCT_REQUIREMENTS.md`; the internal token / telemetry / DB value is stable and separate (e.g. Browser's DB value remains `native`).

## Shared cross-engine contract

These rules bind **every** engine.

### Single-producer recording invariant (#1033 — product requirement)
One persisted recording/transcript has **exactly one STT producer**. The engine selector is locked **synchronously from Start intent** and stays locked across the whole lifecycle — `STARTING / INITIALIZING → RECORDING → STOPPING → FINALIZING → SAVING` — and is re-enabled only after a durable save (or a clean failed start). A new engine selection applies only to the **next** recording. There is:
- **no user- or code-triggered mid-recording engine switch;**
- **no mixed-engine transcript** (a single saved transcript never blends two engines);
- **no silent fallback** — an engine that cannot start or cannot finish fails **visibly** and the recording is honestly marked; it never quietly hands off to another engine and presents the result as the selected one.

The producing engine is latched immutably per recording and recorded as `attribution_status ∈ {legacy_unknown, pending, verified, unverified}`; **only `verified` counts as accuracy/quality evidence** (see `ARCHITECTURE.md`).

### Transcript lifecycle acceptance
An STT mode is acceptable **only** when useful text becomes visible quickly, survives stop, saves correctly, and feeds history/analytics from the **same selected transcript**. Internal engine logging of text is never sufficient. Two transcript states are measured **separately** and must never be conflated:
- **live provisional** text (shown during recording; for Whisper-style chunk inference it is rough and must be labeled provisional);
- **saved/detail final** text (the durable transcript that feeds history, analytics, and scoring).

### Metric-validity rules (no fabricated or mis-attributed numbers)
- **Drop-in parity is the hard release gate**, not a published external number: the app must not be materially worse than a minimal same-engine drop-in comparator on the **same corpus + audio route**.
- **Published/vendor numbers are sanity references only**, valid as gates *only* when corpus, audio route, model, streaming mode, normalization, and scoring are comparable. SpeakSharp must never imply it beats a vendor — corpus/path differences make that a measurement artifact.
- **Harness-limited runs are not gates.** Chrome fake-audio-capture and contaminated physical-route rows can expose lifecycle bugs but must be **excluded from accuracy math**.
- WER is lower-is-better; Accuracy = `100% − WER`. Any numeric target must cite its vendor/model/benchmark source or be labeled an internal/drop-in target.
- **Journey proof is separate from accuracy.** Text must appear live, survive stop, save, and appear in history/detail — accuracy alone never releases an engine.

### SLO vs SLA (do not publish SLA language)
STT targets in this document are **internal SLOs / quality targets on controlled fixtures**, never external SLAs. Per `SERVICE_LEVELS.operational.md`: do not publish SLA language until external obligations are intentionally accepted; a public/SLC promise is shown only when supported by evidence.

---

## Browser (`native`)

- **Purpose & eligibility.** The free, zero-setup quick-start path — the browser's own speech recognition. Available to all authenticated users, and it is the **default mode a new session starts on** (`defaultMode = 'native'`). It is the free convenience option, not the recommended-quality path (Private is recommended once the user is entitled).
- **Audio/data route & privacy.** Uses the browser's built-in `SpeechRecognition`. Audio handling is the **browser vendor's**, not SpeakSharp's — depending on the browser this may send audio off-device to the vendor's servers. Copy must therefore **not** claim on-device/private for Browser (that is Private's guarantee). Approved description: *"Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended."*
- **Lifecycle.** `continuous=true`, `interimResults=true`; interim results display live, a committed final replaces them on stop. A committed final plus a same/case/punctuation-variant pending interim must **not** be appended (duplicate-on-stop regression guard, `NativeBrowser.test.ts`).
- **Supported conditions.** Chrome recommended; availability/accuracy vary by browser and OS. No offline guarantee.
- **Metrics & validity.** **No approved numeric WER target** — Web Speech is browser/server/audio-route dependent, and no credible official Google/MDN WER figure exists. Browser is judged as a **browser-product journey**, against the same-machine standalone Chrome Web Speech **drop-in parity** harness on the same corpus/route — **not** a corpus-WER claim, unless a validated fixture route is proven. Fake-audio rows are diagnostic only.
- **Failure behavior.** On unavailable/failed recognition it fails visibly (no silent fallback to Private or Cloud); the recording is marked honestly.
- **Evidence required for release.** A valid clean-input drop-in parity proof (human-style Chrome real-mic or a validated loopback with separated transcript states) + a journey proof (live → stop → save → history). Fresh human proof is still required before Browser can be called release-green. `UNPROVEN`: a numeric Browser accuracy target (none approved).

## Cloud (`cloud`, AssemblyAI Universal-Streaming / `universal-streaming-english`)

- **Purpose & eligibility.** Highest-accuracy streaming transcription for entitled users. **Pro-entitled only** — where "Pro" is `subscription_status = 'pro'` **AND** a `stripe_subscription_id` (a real Stripe subscription, or a **comped/QA synthetic id** per `ENTITLEMENTS_AND_BILLING.md` §6; **never a live charge** in the beta). Not offered to un-entitled Free testers; entered only by explicit user selection, never as a silent fallback.
- **Audio/data route & privacy.** Audio is streamed to **AssemblyAI** (third-party processor). Copy must state that audio leaves the device to the provider — it is **not** private/on-device.
- **Lifecycle.** Uses the AssemblyAI Universal-Streaming model — the production provider builds `speech_model=universal-streaming-english` — with streaming partials and post-Terminate tail handling. It **intentionally sends neither `prompt` nor `keyterms`** (those params are unproven for this route and are deliberately omitted, `CloudAssemblyAI.test.ts`).
- **Supported conditions.** Requires network + a valid `ASSEMBLYAI_API_KEY` / Pro entitlement; unavailable offline.
- **Metrics & validity.** Approved streaming target: **91.86% accuracy / 8.14% WER** (AssemblyAI published English streaming benchmark, cited; `tests/STT_BENCHMARKS.json`). SLO quality target: **Cloud STT WER < 8% on controlled fixtures** (`SERVICE_LEVELS.operational.md`). Pre-recorded/batch (e.g. 95%) is **stretch-only, `UNPROVEN`**. Provider/model/version must be recorded with any evidence.
- **Failure behavior.** **Never a silent fallback target** — no other engine's failure may quietly route to Cloud, and Cloud's own failure fails visibly. Provider/network errors surface honestly.
- **Evidence required for release.** A fresh streaming A/B against the published benchmark **with a real `ASSEMBLYAI_API_KEY`** + a Pro-account app journey proof. Local mock credentials are not release evidence.

## Private v2 (`private` / persisted `private_v2`, Whisper base.en, on-device) — RECOMMENDED (entitlement-gated)

- **Purpose & eligibility.** The **recommended** Private engine: local-first, privacy-preserving transcription. It is **entitlement-gated — available to Pro users OR a user with an active one-time Free Private sample** (`canUsePrivateStt = isPro || hasActivePrivateSample`, `useSessionLifecycle.ts`); it is **not** available to every authenticated user, and it is not the auto-start default (a new session starts on Browser until Private is selected). Multi-threaded WASM is enabled in production via cross-origin isolation (#1043).
- **Audio/data route & privacy.** Runs **on-device in the browser** (WASM). **Practice audio stays on the device**; only the resulting transcript is saved with the session. This is the sole engine that may make the on-device/private claim.
- **Lifecycle.** Model loads locally (from `/models/`); provisional text streams during recording via chunk inference; on stop, a whole-utterance finalization produces the durable transcript. Live decode-window capping, silence-tail capping, and a warm-engine idle-reset guard bound live latency.
- **Finalization latency.** Two distinct things — do not conflate them:
  - **Earlier pre-MT planning budget (~90s):** the ~90-second finalization figure for a ~5-minute recording is the **earlier pre-multi-thread planning-budget risk**, explicitly **not a measured p95** and predating the MT-WASM path. It remains a conservative planning bound, not a performance guarantee.
  - **Observed MT-WASM run (2026-07-29, n=1 — performance evidence, not a percentile):** on the production multi-threaded WASM path, a **303.5s** human recording finalized in **~39.1s total** (decode **38.702s**, finalize wait **350ms**, preparation **20ms**), an observed **real-time factor ≈ 0.128**. This is **observed performance evidence, NOT p50/p95/SLO/SLA**, and it carries **no WER/accuracy claim** (exact spoken ground truth was not scored). It is consistent with #1085's controlled MT result (1.7–2.2× faster decode with **byte-identical** transcripts — faster, WER unchanged). Evidence: `product_release/evidence/private_v2_mtwasm_human_2026-07-29.json`. A real finalization **p95** still requires the #1037 evidence orchestrator (not built).
- **Supported conditions.** Modern browser with WASM (and cross-origin isolation for multi-thread); works offline after the model is cached.
- **Metrics & validity.** Saved/detail transcript must not materially underperform a **same-model browser drop-in** control on the same audio route (the hard parity gate). Stored advisory targets: **Private CPU 93.89%** — a **historical `whisper-tiny.en` Node-CPU** control result, advisory only; it is **NOT** the current shipping `whisper-base.en` MT-WASM accuracy — and **Private WebGPU 93.00%** (`tests/STT_BENCHMARKS.json`). No current `whisper-base.en` MT-WASM **accuracy** figure is established (the 2026-07-29 MT-WASM run measured timing only, no WER). SLO quality target: **Private STT WER < 10% on controlled fixtures** (`SERVICE_LEVELS.operational.md`; do not promise globally — user environment varies). **Live provisional text is measured separately** and remains rough; it must be labeled provisional. Row-level model gaps (e.g. `like`→`light`) are tracked as model/audio gaps, **never** patched with speculative text replacement.
- **Failure behavior.** On model-load or decode failure it fails visibly; no silent fallback. A partial/failed finalize is marked honestly and the transcript is preserved where recoverable.
- **Evidence required for release.** Browser drop-in parity on the current corpus + a 10/10 journey proof (already demonstrated on Harvard-10 saved/detail). `UNPROVEN`: a measured finalization p95 (currently a planning budget only).

## Private v4 (`private-v4`, Whisper WebGPU) — OFF (research only)

- **Purpose & eligibility.** A WebGPU re-platform candidate for Private. **Hard-disabled** — `VITE_PRIVATE_STT_V4_DISABLED` is authoritative and cannot be overridden by any PostHog flag. Not on any release path.
- **Decision (#1044 — HOLD).** v4 is neither promoted nor rejected: existing evidence is **insufficient to decide** (memory, cohort failure rate, cross-browser/GPU coverage, and real-session finalization have no documented evidence; the one accuracy figure is harness-limited and not a gate). It stays off pending trustworthy evidence.
- **Audio/data route & privacy.** Same on-device model as v2 when/if enabled; requires WebGPU (non-WebGPU devices would fall back to v2 — a device-capability routing decision for a *future* recording, never a mid-recording switch).
- **Metrics & validity.** Stored target **Private v4 88.89%** is **harness-limited and NOT a gate**. No approved v4 replacement threshold exists; the eventual GO gate is defined in #1044 (build #1037, repair producing-engine attribution across fallback, agree a base.en six-metric threshold, run a cohort PostHog A/B).
- **Failure behavior / evidence required.** Not applicable while hard-off. Any future activation is a **separate, explicitly PO-approved gate** and is out of scope for this contract.

---

## Consolidated SLO / quality-target table (internal — not SLAs)

| Target | Value | Class | Source / evidence | Note |
|---|---|---|---|---|
| Primary recording path availability | 99.5% internal target | SLO (aspirational) | Canary, RC gates, live STT paths | Controlled-test evidence only; not uptime monitoring |
| Private STT WER | < 10% on controlled fixtures | Quality target (not SLA) | STT benchmark/proof artifacts | Do not promise globally (environment varies) |
| Cloud STT WER | < 8% on controlled fixtures | Quality target (not SLA) | Cloud live proof; provider/model/version recorded | Paid-Pro path |
| Cloud streaming accuracy | 91.86% / 8.14% WER | Approved streaming target | AssemblyAI published benchmark (cited) | Batch/95% is stretch-only, `UNPROVEN` |
| Private CPU accuracy | 93.89% | Advisory control (historical) | Node CPU drop-in, **`whisper-tiny.en`** | Historical tiny.en advisory — **NOT** current shipping `whisper-base.en` MT-WASM accuracy |
| Private WebGPU accuracy | 93.00% | Advisory control | `tests/STT_BENCHMARKS.json` | |
| Private v4 accuracy | 88.89% | `UNPROVEN`, harness-limited | `tests/STT_BENCHMARKS.json` | Not a gate; v4 is off |
| Browser accuracy | none | `UNPROVEN` | — | Drop-in parity is the gate, not a number |
| Private v2 finalization (pre-MT budget) | ~90s planning budget | `UNPROVEN` (not a measured p95) | — | Earlier pre-multi-thread bound; route real p95 to #1037 |
| Private v2 finalization (observed MT-WASM) | ~39.1s total, RTF ≈ 0.128 | Observed performance (n=1, NOT a percentile) | `evidence/private_v2_mtwasm_human_2026-07-29.json` | 303.5s recording, 2026-07-29 human run; **no WER/accuracy claim** |

**No external SLA is published for any STT engine.** Publishing an STT SLA or a public accuracy claim requires prior Product-Owner approval and supporting measured evidence.

## Out of scope / routed elsewhere
- The STT evidence orchestrator that would produce two-lane (corpus vs browser-journey) decision-grade evidence is **#1037** (not built).
- Private v2 finalization-latency optimization is a separate performance issue.
- Any engine implementation change, activation, rollout-flag change, or default-engine change is out of scope for this contract and requires its own PO-approved gate.

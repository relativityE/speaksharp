**Status:** Authoritative (SSOT for STT runtime and data contracts, baselines, accuracy, and SLOs)
**Owner:** Engineering / Product Owner (relativityE)
**Last Reviewed:** 2026-08-13
**Last Verified:** 2026-08-13 — reconciled to the Product Owner-locked Private-only launch contract; release evidence remains separately gated.
**Applies To:** Customer Private STT, the internal deterministic E2E hook, and the inactive Private v4 candidate.
**Class:** Runtime and data contract.
**Authority:** STT audio route, lifecycle, attribution, failure behavior, metric validity, and evidence requirements.
**Not Authoritative For:** customer product copy (→ `PRODUCT_REQUIREMENTS.md`); commercial access mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); persistence and retention (→ `ARCHITECTURE.md`); deployed status (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier Browser/Cloud customer-engine maps, sample eligibility, and multi-engine selector requirements in this file.
**Evidence Sources:** `tests/STT_BENCHMARKS.json`; current `frontend/src/services/transcription/` implementation and tests; issue #1033 single-producer decision; #1044 v4 HOLD decision; qualification artifacts indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp STT Contract

SpeakSharp customer recordings use one transcription product: **Private STT**, running on the customer's device. Browser and Cloud are not customer engines or entitlements. Native is retained only as an isolated deterministic E2E hook. Private v4 is OFF unless separately promoted.

No numeric target in this document is a customer promise. Release claims require current, comparable, exact-head evidence.

---

## 1. Engine map

| Surface | Internal token | Product role | Customer availability |
|---|---|---|---|
| **Private** | `private`, persisted `private_v2[:model]` | On-device customer transcription | The only customer engine for active-trial and paid users |
| **Native test hook** | `native` | Deterministic isolated E2E fixture | Never a customer choice, entitlement, or production fallback |
| **Private v4** | `private_v4` | Internal WebGPU research candidate | OFF; never user-selectable |

Legacy Cloud/provider code and tokens confer no customer entitlement. Provider token endpoints must fail closed and must not call the provider for customer requests.

---

## 2. Single-producer recording invariant

One persisted recording and transcript has exactly one STT producer.

- The producer is latched at recording start and remains immutable through initialization, recording, stop, finalization, save, and evaluation.
- A recording never blends output from multiple engines.
- There is no mid-recording switch or silent fallback.
- A start or finalize failure is visible and honestly attributed.
- The saved session records sufficient producer/model provenance to reproduce or classify evidence.
- Only verified attribution may count as accuracy or release evidence.

The internal E2E hook may replace Private only inside explicitly isolated deterministic test configuration. Production policy cannot select it.

---

## 3. Private audio and data route

- Private transcription executes in the browser through the approved on-device worker/runtime.
- Recording audio is not uploaded for STT and is not persisted server-side.
- Model assets may be downloaded and cached through the browser. After setup, transcription must work without sending audio to a provider.
- The resulting transcript and derived session evidence may be saved under the persistence and access contract in `ARCHITECTURE.md`.
- Audio, transcripts, and raw model output must never enter analytics or error reporting.
- A later server feature that processes saved text must be disclosed separately; the Private STT claim does not imply that every downstream text operation is local.

---

## 4. Lifecycle acceptance

### Setup and start

- Setup exposes accurate download, initialization, ready, retry, and failure states.
- A recording cannot start before the Private engine is ready.
- Start failure creates no partial session authority and cannot fall through to another producer.

### During recording

- Live text is provisional and must be presented as such.
- Audio chunk ownership and transcript assembly remain bound to the latched recording identity.
- The 10-minute individual-recording technical cap is enforced independently of commercial access.
- No accumulated daily or monthly usage value may stop an active-trial or paid recording.

### Stop, finalize, and save

- Stop finalizes the same recording and producer that started.
- Final text replaces or reconciles provisional text without duplicate suffixes or invented content.
- A partial or failed finalization is surfaced honestly; recoverable text is not silently discarded.
- The saved/detail transcript is the durable transcript used by History, Progress, analysis, and export.
- Internal logs containing text are not proof that the customer journey saved correctly.

---

## 5. Failure behavior

- Model-download, cache, worker, decode, and finalization errors fail visibly.
- Private failure never routes audio to a browser vendor or cloud provider.
- Unsupported capabilities use only an approved on-device Private fallback; otherwise the product reports that Private cannot start on that device.
- A watchdog may convert a stalled lifecycle into an actionable failure, but it must not fabricate a transcript or mark an unsaved recording complete.
- Retry must remain bound to the original recording, producer, and idempotency identity.

---

## 6. Metric validity

- Live provisional and saved/detail transcripts are measured separately.
- Drop-in parity uses the same model, corpus, device, runtime, and audio route.
- Harness-limited or contaminated audio runs are diagnostic, not accuracy gates.
- WER is lower-is-better; `accuracy = 100% - WER` only for a valid scored corpus.
- Published vendor or historical model results are context, not evidence for the current shipping runtime.
- Every reported result records model file and quantization, runtime/version, browser, device, cache state, audio route, corpus, and exact source SHA.
- Journey proof and accuracy proof are separate: a transcript must appear, finalize, save, and reopen even when an accuracy score is good.

The internal quality target remains Private WER below 10% on controlled, comparable fixtures. It is not an external SLA and is not a universal environment claim.

---

## 7. Private v2 release evidence

Private v2 is the safe launch default until a separately authorized decision changes it.

Required evidence includes:

- cold and warm model setup;
- real-device start, first text, stop, finalization, save, History/detail, Progress, and export;
- opening and trailing-word preservation;
- silence and immediate-speech cases;
- duplicate-loop and hallucinated-prefix negatives;
- finalization duration and real-time factor for representative recording lengths up to the 10-minute cap;
- controlled accuracy/drop-in comparison; and
- sanitized error, memory, and recovery evidence on the supported device/browser matrix.

An observed run is not a percentile. A planning target is not a measured SLO. Current qualifying identities and results belong in `RELEASE_STATUS.md` and `EVIDENCE_INDEX.md`.

---

## 8. Private v4 disposition

Private v4 is OFF and research-only.

- The build kill switch remains authoritative over flags.
- No flag, allowlist, or deterministic override may expose v4 to a customer while it is OFF.
- Saved historical v4 evidence remains labeled with its exact producer and cannot be compared without matching corpus, device, and conditions.
- Promotion requires an explicit Product Owner decision after comparable v2/v4 setup, accuracy, opening/tail, finalization, memory, and failure evidence.
- Any future device-capability choice occurs before a new recording; it is never a mid-recording switch.

### Comparable benchmark protocol

For each candidate, collect one row per engine on the same corpus, devices, and conditions:

| Dimension | Required measurement |
|---|---|
| Setup | cold and warm model acquisition plus initialization time |
| Accuracy | WER/accuracy on the same content-safe fixtures |
| Opening/tail | first-token latency and trailing-word capture |
| Finalization | post-stop duration and real-time factor |
| Memory | peak/steady JS heap and GPU memory where exposed |
| Failure | startup/finalization failure rate and device coverage |

Until those proofs and approval exist, Private v2 remains the only customer producer.

---

## 9. Release gate

STT is release-qualified only when the integrated deployed merge SHA proves:

- the active-trial Private journey;
- the paid-continuation Private journey;
- no alternate customer entitlement or fallback;
- no audio/transcript leakage into telemetry;
- real-device coverage through #1258;
- sanitized SLO/canary evidence through #1259; and
- zero unresolved critical STT residue.

Mocks, an open provider socket, a token response, local unit tests, or green PR CI alone are not deployed STT qualification.

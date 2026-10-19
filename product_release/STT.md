**Status:** Authoritative (SSOT for STT runtime and data contracts, baselines, accuracy, and SLOs)
**Owner:** Engineering / Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-16 — candidate roles reconciled to the Product Owner decision: approved target is v4 customer primary on WebGPU-capable devices with v2 as the pre-Start fallback locked for the take, while Production remains v2-only until a separate evidenced promotion. Evidence validation rather than a three-model down-selection; Moonshine deferred until after RWT or MVP.
**Applies To:** Customer Private STT, the internal deterministic E2E hook, and the inactive Private v4 candidate.
**Class:** Runtime and data contract.
**Authority:** STT audio route, lifecycle, attribution, failure behavior, metric validity, and evidence requirements.
**Not Authoritative For:** customer product copy (→ `PRODUCT_REQUIREMENTS.md`); commercial access mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); persistence and retention (→ `ARCHITECTURE.md`); deployed status (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier Browser/Cloud customer-engine maps, sample eligibility, and multi-engine selector requirements in this file.
**Evidence Sources:** `tests/STT_BENCHMARKS.json`; permanent model-evaluation history at [`evidence/stt/README.md`](./evidence/stt/README.md); current `frontend/src/services/transcription/` implementation and tests; issue #1033 single-producer decision; #1044 v4 HOLD decision; qualification artifacts indexed by `EVIDENCE_INDEX.md`.

<!-- pm-currentization:2026-09-15 -->
> [!CAUTION]
> **Currentized 16 Sep 2026 — APPROVED TARGET and CURRENT STATE are different, and this file states both.**
>
> **Model evaluation and current release boundaries.** Private v2 may complete MVP. The current coordination record selects the near-term #1565 evaluator and #1304 model/fallback work; do not treat an older post-MVP label as permission to stop that assigned work. Reuse preserved #1567/#1568 source through the sole CLI integration lane. Evaluation is not promotion: v4 and any fallback configuration require comparable real evidence and explicit Product Owner selection. One producer remains locked for a take; full useful Open Mic/Focus and applicable device acceptance remain required for the selected customer configuration. This document grants no model acquisition, live execution or activation authority. A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.
>
> **Deferred target, requiring future qualification and explicit promotion.** The proposed direction remains v4 primary on qualified WebGPU-capable devices and v2 as a labelled **pre-Start fallback**. Any selected producer is attributed *before* Start and stays **locked for that whole take** — no mid-recording handoff and no v2 retranscription of a failed v4 take. The historical target is not a claim that v4 is qualified, selected for the current RWT, or activated.
>
> **Current state: Production remains v2-only for ordinary customers.** v4 is **not** the customer default today, and that is enforced in code rather than merely configured: `candidateSelection.ts` refuses a candidate that is not `activationReady`, and separately refuses `acknowledgeNotProductionReady` unless `VITE_INTERNAL_BUILD` is true. So the **configured-default path cannot select v4 in a public build**.
>
> **That is a statement about the default path only, and the distinction matters.** Canonical Production has a separate authorized comparison path: `installRuntimeCandidateSwitch()` installs when the build is internal **or** when a signed one-use model-comparison authorization is consumed, and `effectiveCandidate()` then returns the runtime override **without** the activation check — deliberately, because the comparison has to run candidates before one of them can be approved as a default. Precedence is remote-kill > runtime override > config, so the safety kill still outranks the switch. An authorized four-cell comparison therefore runs on canonical Production; it does not need an internal build, and it does not make v4 the customer default.
>
> `v4:distil:q4` is registered `activationReady: false`, and it is WebGPU-only by design (WASM real-time factor ~2.2 is unusable), which is why the target is device-conditional rather than universal. The separate normative requirement that Private v4 is OFF unless separately promoted through evidence and Product Owner approval therefore still holds and is **unchanged** by this decision.
>
> **What is already observable, and what is not.** Candidate identity is not unobservable. During an authorized comparison `__SS_ACTIVE_CANDIDATE__` reports `requested`, `observed`, `expected`, `matches` and `source` (`config` | `runtime_switch` | `remote_safety_kill`), and the server-owned `session_attribution_authority` row carries durable identity — `engine_class`, `engine`, `engine_version`, `model_id`, `provider`, `resolved_device`, `authority_version` — readable by the owning authenticated user. The real gaps are narrower: ordinary Canary does not yet consume that authoritative row, and no durable receipt yet distinguishes **requested primary** from **effective candidate**, nor records a **fallback cause**, proof that v2 was selected **before Start**, or proof the engine stayed **locked for the take**. #1488 owns authoritative Canary attribution; #1263 owns customer selection, fallback, locking and attribution as ordered subtasks in one PR home.
>
> **How the deferred model gap closes.** Reuse preserved #1567 evaluator and #1568 primary/fallback source through the selected current integration lane; the preserved branches are not shipped behavior. Comparable candidate/device evidence and a separate Product Owner promotion decision precede any transition. Any promoted configuration still needs full useful Open Mic and Focus Points journeys, applicable real-device proof, and requested / effective / observed / fallback-cause attribution. Current v2 MVP acceptance does not qualify a future v4 configuration or fallback. **This document does not implement the selector, and nothing here makes v4 live.** Current-model product/device qualification remains required without introducing a model-comparison prerequisite.
<!-- /pm-currentization:2026-09-15 -->

# SpeakSharp STT Contract

SpeakSharp customer recordings use one transcription product: **Private STT**, running on the customer's device. Browser and Cloud are not customer engines or entitlements. Native is retained only as an isolated deterministic E2E hook. Private v4 is OFF unless separately promoted.

No numeric target in this document is a customer promise. Release claims require current, comparable, exact-head evidence.

---

## 1. Engine map

| Surface | Internal token | Product role | Customer availability |
|---|---|---|---|
| **Private** | `private`, persisted `private_v2[:model]` | On-device customer transcription | The only customer engine for active-trial and paid users |
| **Native test hook** | `native` | Deterministic isolated E2E fixture | Never a customer choice, entitlement, Production comparison candidate, or fallback |
| **Private v4** | `private_v4` | Registered comparison candidate | Operator-selectable between settled Production test takes; never customer UI |
| **Moonshine** | registered candidate identity | Registered comparison candidate | Operator-selectable between settled Production test takes; never customer UI |

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

## 8. Operator-only comparison candidates

Private v2, Private v4, and Moonshine remain registered candidates. Evaluation follows the selected #1565/#1304 queue and preserved source, without creating a current v2 MVP comparison gate. Moonshine activation remains unqualified; its preserved source and failure evidence feed #1304. Candidate control is operator-only, applies between settled takes, and never creates a customer selector, entitlement or silent fallback.

- The selected candidate is latched before Start and requested/observed identities must match through finalize, save, review, and reopen.
- A setup, switch, decode, finalization, repetition, or tail-integrity failure is recorded against that candidate; it is never hidden by relabeling, fallback, or transcript cleanup.
- Moonshine cold acquisition uses progress-sensitive stall handling, and a failed switch may be retried, but those mechanics do not override the unresolved long-form repetition/tail/stability failure.
- Future promotion requires an explicit Product Owner decision after comparable **v2 and v4** setup, accuracy, filler preservation/completeness, opening/tail, finalization, memory, device, recovery, and failure evidence. Moonshine evidence is not required for that two-candidate decision and remains deferred.
- A future device-capability choice occurs before a new recording; it is never a mid-recording switch.

### Comparable benchmark protocol

For each candidate, collect one row per engine on the same corpus, devices, and conditions:

| Dimension | Required measurement |
|---|---|
| Setup | cold and warm model acquisition plus initialization time |
| Accuracy | WER/accuracy on the same content-safe fixtures |
| Filler integrity | annotated positive/negative preservation plus `complete | unobservable | no_speech` |
| Opening/tail | first-token latency and trailing-word capture |
| Stability | bounded live rewrites, repetition/loop detection, and long-form integrity |
| Finalization | post-stop duration and real-time factor |
| Memory | peak/steady JS heap and GPU memory where exposed |
| Failure | startup/finalization failure rate, truthful retry, and device coverage |

Until those proofs and approval exist, the checked-in default is not a measured winner.

---

## 9. Model-selection evidence history

Model selection is a reproducible decision record, not a winning WER copied from a log. The three evidence sets have different jobs and must never be renamed or blended:

| Evidence set | Exact identity | Permitted use |
|---|---|---|
| Harvard smoke | 10 clips / **85 normalized words** | Pipeline smoke and known-answer characterization only. Never selection evidence. |
| Preflight | 23 clips / **459 normalized words** | Unseen-corpus defect discovery and candidate triage. The planning target was 425 words; 459 is what the deterministic selection produced. Never selection evidence. |
| Frozen selection | **600 utterances / 10,894 normalized words** | Selection-grade accuracy, reliability and performance evidence when every gate below passes. This is not a “600-word test.” |

The 85-word set produced a ceiling effect: several distinct models differed by only one or two errors and some scored zero, so it could not support a ranking. The 459-word set then separated the candidates and exposed corpus/runtime defects before the expensive frozen run. Only the frozen 600-utterance set may drive the down-select, using the decision policy fixed before its results existed.

### Required matrix and artifacts

Every proposed model/configuration has one cell in every evidence set. A cell contains metrics or a named `not_run` / `invalid` / `rejected` reason; absence is never a pass. The matrix retains scored candidates, load failures, unsupported options, aliases, diagnostic duplicates, contaminated runs and hardware-unrepresentative runs. Aliases and diagnostics remain visible but cannot enter a ranking.

For each cell, retain:

- model id, revision, exact asset digests, dtype/quantization, runtime and version;
- lane, requested device, resolved/proven backend, and whether the hardware is representative;
- corpus id, utterance count, normalized reference-word count, normalizer version and Track A/B identity;
- pooled WER, substitutions, deletions, insertions, reference words, and all reliability counters;
- cold load, warm-decode p50/p95, RTF p50/p95, actual downloaded bytes, and peak memory or an explicit `unmeasured`;
- short- and long-form integrity, including truncation, preserved tail and repetition checks;
- contamination state, selection eligibility and the named reason for any exclusion; and
- per-utterance score/timing data sufficient to reproduce pooled totals and paired bootstrap intervals without decoding again.

The evidence has four durable layers:

1. immutable raw artifacts with per-utterance data and exact execution identity;
2. a versioned registry at `tests/STT_BENCHMARKS.json` containing every matrix cell;
3. a dated human-readable report indexed by `EVIDENCE_INDEX.md`; and
4. the current primary/fallback product contract in this document after Product Owner approval.

The dated report must distinguish the product baseline, measurement execution tree and selection-policy tree. It must explain the 85-word ceiling, the defects and requalifications found at 459 words, the complete 600-utterance results, and how paired bootstrap intervals produced a winner or a statistical tie. It reports three separate conclusions: **technical winner**, **MVP activation readiness**, and **failure-diverse fallback**. Integration convenience cannot change the technical ranking.

SwiftShader proves WebGPU compatibility only; it is not hardware performance evidence. Rows from different corpora, normalizers, runtime versions or evidence classes cannot be ranked together. A contaminated timing is `unmeasured`, not slow or fast. The quiet reruns for contaminated `v2:tiny.en` and `v2:base.en` may replace performance fields only after every per-utterance score profile reconciles; any accuracy difference invalidates the replacement.

Historical results are append-only. When a harness, model asset or inference runtime is later found defective, preserve the old row, mark it invalid with the reason and link the requalification. Never delete the evidence that explains why an earlier decision changed.

---

## 10. Release gate

STT is release-qualified only when the integrated deployed merge SHA proves:

- the active-trial Private journey;
- the paid-continuation Private journey;
- no alternate customer entitlement or fallback;
- no audio/transcript leakage into telemetry;
- real-device coverage through #1258;
- sanitized SLO/canary evidence through #1259; and
- zero unresolved critical STT residue.

Mocks, an open provider socket, a token response, local unit tests, or green PR CI alone are not deployed STT qualification.

---

## #1367 reconciliation (2026-08-29)

- **On-device transcription confirmed.** Same-origin Transformers.js worker; no audio upload path on the Private
  route. The claim in this document holds.
- **Filler counting is competitive parity and product quality — not a differentiator and not a moat.** It is
  **currently unqualified on annotated disfluent human speech**: the #1304 corpus is read LibriSpeech and Track A
  removes fillers by construction, so no F1 against annotated disfluency exists.
- **Do not cite a fixed pin count.** Earlier documentation stated a total that is now stale; the pinned-asset
  structure spans `tests/fixtures/moonshine-asset-pins.json` and the ORT runtime binaries in
  `tests/evidence/certification/arms/runtimeAssets.ts`. Cite the fixtures, not a number that will rot.

Full dated audit: [`DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md`](./evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md) §10.1, §10.7, §10.8.

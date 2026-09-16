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
> **Approved target (Product Owner decision, for RWT and MVP).** **v4 is the customer primary on WebGPU-capable devices**, because it has the maintained model-release pipeline. **v2 is the pre-Start fallback**: when capability or initialization prevents v4 before recording, v2 is selected and attributed *before* Start and stays **locked for that whole take** — no mid-recording handoff and no v2 retranscription of a failed v4 take. Moonshine is deferred until after RWT or MVP and is excluded.
>
> **Current state: Production remains v2-only.** v4 is **not** the customer default today, and this is enforced in code, not merely configured. `candidateSelection.ts` refuses a candidate that is not `activationReady`, and separately refuses `acknowledgeNotProductionReady` unless `VITE_INTERNAL_BUILD` is true — so a **public build cannot run v4 by any configuration path**. `v4:distil:q4` is registered `activationReady: false`, and it is WebGPU-only by design (WASM real-time factor ~2.2 is unusable), which is why the target is device-conditional rather than universal. The separate normative requirement that Private v4 is OFF unless separately promoted through evidence and Product Owner approval therefore still holds and is **unchanged** by this decision.
>
> **How the gap closes.** The authorized four-cell v2/v4 comparison supplies the pre-promotion evidence; #1263 then implements the structural primary/fallback policy — capability detection, pre-Start fallback selection, take locking, and requested / effective / observed / fallback-cause attribution — and carries the normative document amendment with it. The final deployed RWT proves both a normal v4 journey and a bounded v2 fallback. **This document records the decision; it does not implement the selector, and nothing here makes v4 live.** The current work validates v4 over v2 on one evidence contract and is not a three-model down-selection.
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

Private v2, Private v4, and Moonshine are registered comparison candidates. The current RWT compares **v4 (the approved primary, not yet live) against v2 (the pre-Start fallback, and today's only customer default)** only; Moonshine stays registered but is deferred until after RWT or MVP and is not required for current qualification. Candidate control is operator-only, applies only between settled takes, and never creates a customer-visible selector, entitlement, or silent fallback.

- The selected candidate is latched before Start and requested/observed identities must match through finalize, save, review, and reopen.
- A setup, switch, decode, finalization, repetition, or tail-integrity failure is recorded against that candidate; it is never hidden by relabeling, fallback, or transcript cleanup.
- Moonshine cold acquisition uses progress-sensitive stall handling, and a failed switch may be retried, but those mechanics do not override the unresolved long-form repetition/tail/stability failure.
- Promotion requires an explicit Product Owner decision after comparable **v2 and v4** setup, accuracy, filler preservation/completeness, opening/tail, finalization, memory, device, recovery, and failure evidence. Moonshine evidence is not required for it, being deferred until after RWT or MVP.
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

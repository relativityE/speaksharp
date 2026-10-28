**Status:** Authoritative (SSOT for the index of dated proof artifacts — an index, not the proofs themselves)
**Owner:** Product-Ops / Quality (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-15 — the 66-file evidence tree and current issue-held decision evidence were reconciled; dated and retained artifacts remain immutable.
**Applies To:** All dated release-proof artifacts for the SpeakSharp beta — where each lives, when it was captured, and what it proved at that moment.
**Class:** Evidence index.
**Authority:** The source for **where** dated proof artifacts live and **what date/point-in-time** they represent. It is a map to evidence, not a verdict.
**Not Authoritative For:** current release/deployment status, go/no-go, blockers, run IDs, or signoff SHA (→ `RELEASE_STATUS.md`); quality targets and the evidence taxonomy (→ `QUALITY.md`); STT baselines/accuracy/latency (→ `STT.md`); tier/entitlement mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); open gaps and broad-launch gates (→ `ROADMAP.md`); tester copy (→ `TESTER_GUIDE.md`); tester run/audit procedures (→ `TESTER_OPERATIONS.md`).
**Supersedes:** the ad-hoc "current truth source" framing of `evidence/README.md`; dated closeout, public-launch and entitlement records are retained below as evidence, not current posture.
**Evidence Sources:** the `product_release/evidence/` tree itself; `evidence/retained/attribution-sanitation-crosswalk.md` for pre-2026-07-15 SHA provenance.

<!-- pm-currentization:2026-09-15 -->
> [!IMPORTANT]
> **Currentized 15 Sep 2026.** The evidence tree was inventoried without rewriting dated or retained artifacts. The partial RWT, #1468 managed-identity verification, and #1263 Moonshine long-form runs currently live as issue/PR decision evidence; they are not silently promoted into permanent files or model-selection rows. The Moonshine probe is a failure observation and the basis for deferring Moonshine until after RWT or MVP; it is not a comparison row and not a current RWT prerequisite. Current pass/fail and deployed identity remain in `RELEASE_STATUS.md`.
<!-- /pm-currentization:2026-09-15 -->

# SpeakSharp Evidence Index

## Strategy and documentation reconciliation

### Preserved RWT diagnostic package

| Evidence | What it establishes | Current authority |
|---|---|---|
| [`evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/`](./evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/README.md) (captured 2026-10-11) | Immutable historical **FAIL/HOLD** record of RWT Open Mic diagnostic run 38104864048, attempt 1, on release `cc8e30b4710bf271d765d4bc549a0e534dedf53c`: the original content-free receipt, readback verdicts, human worksheet and seven per-journey readback qualification logs from artifact 11689650770, with `SHA256SUMS`, `manifest.json` and a README linking the later findings. | #1258 + `RELEASE_STATUS.md` (current RWT status and interpretation) |

The 13 files are received unchanged from accepted #1588 source
`aa0b9c3090997f1e50bda6744114b045f776a8e7`. The original 51 PASS, 3 FAIL,
7 HOLD and two pending human observations remain historical outcomes; importing
them does not qualify the current release.

| Evidence | What it establishes | Current authority |
|---|---|---|
| [`evidence/CODEBASE_VS_STRATEGY_2026-08-29.md`](./evidence/CODEBASE_VS_STRATEGY_2026-08-29.md) | Historical reconciliation describing the then-current newest-two implementation. It does not authorize that superseded policy. | `PRODUCT_REQUIREMENTS.md` and `ARCHITECTURE.md` now require newest-one retention. |

Canonical **index** of the dated proof artifacts SpeakSharp has captured: quality digests, STT/UX reproof runs, beta-50 packets, launch-gate proofs, hardware logs, and entitlement audits. It records **where** each artifact lives and **when** it was captured, so a reviewer can find the original rather than trust a summary.

This is a **documentation** artifact. It changes no code, test, workflow, or product behavior, and it creates no evidence — it points at evidence that already exists.

**Precedence reminder (from `README.md` §1).** Dated evidence sits **below** runtime truth. Every artifact here is **Level-6 evidence, frozen at the date it was captured**. It is cited for rationale and provenance, **never** as current status. Where a dated artifact conflicts with current runtime behavior, current workflow results, or `RELEASE_STATUS.md`, the newer canonical source wins.

> **HISTORICAL EVIDENCE — read this first.** Every artifact indexed below reflects the moment it was captured and is **NOT current release posture**. Current go/no-go, baselines, run IDs, and the signoff SHA live only in `RELEASE_STATUS.md`. Commit SHAs recorded **before 2026-07-15** predate the attribution history sanitation — map old→new via `evidence/retained/attribution-sanitation-crosswalk.md`; historical PostHog `release_sha` values also retain the old SHAs by design. This index deliberately cites artifacts by **path + date**, not by SHA.

---

## 1. Scope & boundaries

This document owns **the index of dated artifacts**. It deliberately routes:

- Any current verdict, go/no-go, or changing baseline → `RELEASE_STATUS.md` (this index never states current status).
- The quality-evidence taxonomy, targets, and what closes a gate → `QUALITY.md`.
- STT accuracy/latency interpretation of the STT artifacts below → `STT.md`.
- Entitlement/tier/billing interpretation of the entitlement audit → `ENTITLEMENTS_AND_BILLING.md`.
- Open gaps and broad public-launch gates surfaced by any artifact → `ROADMAP.md`.

An artifact appears here as a **location + date + one-line "what it proved when captured"**. Interpretation of whether it still holds belongs to the canonical doc that owns the topic.

---

## 2. How to read this index

- **Rolling snapshots are not stable references.** `*.latest.json` / `*.latest.md` names are overwritten each run; they are stable proof only when copied to a dated artifact.
- **Older reports may contain superseded conclusions** — do not treat them as current policy without checking the owning canonical doc.
- **Invalid-evidence rule.** Any STT proof from mock auth, `localhost:5173`, bad fixtures, or the wrong CDP tab is invalid for release evidence unless explicitly labeled a mocked diagnostic.
- **Provenance/privacy.** Artifacts are retained as an audit trail; when adding any new artifact, redact secrets, tokens, auth/cookie headers, and private audio first (strip `Authorization`/`Cookie` from HARs). This index stores **paths, not payloads**.

---

## 3. Quality & service-level digests (CI-generated; rolling)

These are generated by CI, ignored locally to avoid noisy commits, and uploaded with the CI metrics artifacts so each run has evidence tied to a commit and run ID. They are described by `QUALITY.md` §3; interpret targets there.

| Artifact (rolling) | What it holds |
|---|---|
| `product_release/evidence/software-quality.latest.json` | Machine-readable quality evidence: test counts, coverage, Lighthouse, bundle/runtime metrics, GitHub run metadata. |
| `product_release/evidence/software-quality-summary.latest.md` | Human-readable summary of the same evidence. |
| `product_release/evidence/service-levels.latest.json` | Machine-readable SLO/SLC evidence. |
| `product_release/evidence/service-levels-summary.latest.md` | Target-vs-measured service-level summary. |

> Rolling snapshots — cite the dated CI run/artifact, not the `.latest.*` name, for a stable reference.

---

## 4. STT model evaluation and benchmark evidence

[`evidence/stt/README.md`](./evidence/stt/README.md) is the permanent sub-index for model evaluations, benchmark protocols, raw captures, rejected/invalid arms, and down-selection history. This material is retained outside `archive/` because the archive may be deleted. STT interpretation is owned by `STT.md`; these are dated captures, not current verdicts.

| Artifact | Date | What it captured |
|---|---|---|
| `product_release/evidence/stt/reports/stt_product_metrics_release_matrix_2026-06-02.json` / `.md` | 2026-06-02 | STT product-metrics release matrix (per-engine speed/accuracy snapshot). |
| `product_release/evidence/stt/raw/private_v2_human_bakeoff_2026-06-05.json` | 2026-06-05 | Private v2 human-speech bakeoff. |
| `product_release/evidence/stt/raw/private_v2_mtwasm_human_2026-07-29.json` | 2026-07-29 | Private v2 multithreaded-WASM human-speech reproof. |
| `product_release/evidence/rc_lh_reproof_2026-06-05.json` / `rc_lh_valid_reproof_2026-06-05.json` | 2026-06-05 | Lighthouse RC reproof (and validity-checked reproof). |
| `product_release/evidence/rc_sca_reproof_2026-06-05.json` | 2026-06-05 | SCA/dependency RC reproof. |
| `product_release/evidence/stt/raw/stt_p5_vad_b6159_reproof_2026-06-05.json` / `stt_p5_vad_c5f3_reproof_2026-06-05.json` / `stt_p5_vad_current_main_reproof_2026-06-05.json` | 2026-06-05 | Phase-5 VAD reproof set (two pinned variants + current-main). |
| `product_release/evidence/stt/raw/stt_p6_base_default_70746410_reproof_2026-06-05.json` | 2026-06-05 | Phase-6 base-default reproof. |
| `product_release/evidence/stt/raw/stt_p6_conv02_edge_bakeoff_2026-06-05.json` | 2026-06-05 | Phase-6 conv-02 edge bakeoff. |
| `product_release/evidence/stt/raw/stt_p6_enriched_base_rc_2026-06-05.json` | 2026-06-05 | Phase-6 enriched-base RC reproof. |
| `product_release/evidence/stt/raw/stt_p6_human_bd94_base_selector_2026-06-05.json` / `stt_p6_human_rc_base_selector_2026-06-05.json` | 2026-06-05 | Phase-6 human base-selector reproofs. |
| `product_release/evidence/stt/raw/stt_v4r_exact_contract_probe_2026-06-05.json` | 2026-06-05 | v4 exact-contract probe (v4 hard-off exploration). |
| `product_release/evidence/stt/raw/stt_v4r_fp32_lifecycle_2026-06-05.json` | 2026-06-05 | v4 fp32 lifecycle probe. |
| `product_release/evidence/stt/raw/stt_v4r_realbrowser_devprobe_2026-06-05.json` | 2026-06-05 | v4 real-browser dev probe. |
| `product_release/evidence/stt/raw/stt_v4r_stable_wasm_reproof_2026-06-05.json` | 2026-06-05 | v4 stable-WASM reproof. |
| `product_release/evidence/ux_private_hard_nav_recovery_reproof_2026-06-05.json` | 2026-06-05 | UX: Private hard-navigation recovery reproof. |
| `product_release/evidence/ux_private_rapid_start_stop_reproof_2026-06-05.json` | 2026-06-05 | UX: Private rapid start/stop reproof. |
| `product_release/evidence/ux_release_proof_sweep_2026-06-05.json` | 2026-06-05 | UX release-proof sweep. |

### #1037 STT evidence producers and closure-proof boundaries

The #1037 evidence program deliberately keeps its contract, controlled corpus, Browser journey, and production-worker runtime observations separate. These rows index the producer/protocol locations and the permitted interpretation; they do not retain generated payloads or assert current pass/fail status.

| Indexed source | Evidence class | Permitted claim | Mandatory limitation |
|---|---|---|---|
| `tests/evidence/**` + `scripts/validate-stt-evidence.mjs` (PR #1112) | Evidence contract | Fail-closed schema, cohort, attribution, and admissibility rules | A contract is not a runtime observation. |
| `.github/workflows/stt-corpus-lane.yml` + `scripts/stt-corpus-lane.ts` (PR #1119) | `corpus_fixture` | Controlled Private-v2 Node/model-equivalent quality corpus and immutable model-byte provenance | Not the production browser worker; no cross-route latency or ranking claim. |
| `scripts/browser-webspeech-evidence.mts` + `tests/evidence/browserJourney.ts` (PR #1124) | `browser_journey` | Release-proof-eligible system-Chrome journey where recognition starts, the timer advances, and transcript/session production completes with forbidden-engine tripwires | Attribution remains exactly `unverified`; `audio_route_proven=false`; no recognizer-input, provider/model, WER, on-device, or ranking claim. |
| `.github/workflows/stt-runtime-evidence.yml` + `scripts/private-v2-worker-evidence.mts` (PR #1127) | Private-v2 production-worker runtime | Emitted production worker/WASM, self-hosted immutable model/config equality, coherent PCM boundary, one thread requested/configured under non-isolated WASM, and zero external/application writes for the fixed fixture | The effective worker thread count is unreported (`workerReportedThreads=null`). This is not a microphone journey, p95, minimum-device study, or broad accuracy result; requested, configured, and worker-reported thread counts remain distinct; the sanitized diagnostic artifact is retained for one day. |

Browser, corpus, and production-worker evidence are separate comparability classes and support **no cross-lane ranking or winner**. Generated JSON, audio, screenshots, archives, local-machine paths, and other raw run payloads do not enter Git. Current pass/fail, deployed SHA, run IDs, and #1037 closure status belong only in `RELEASE_STATUS.md`, not this index.

---

## 5. Beta-50 packets & audits (dated)

| Artifact | Date | What it captured |
|---|---|---|
| `product_release/evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md` | 2026-07-09 | Beta-50 release-evidence packet (v0.9.0-rc0 line). |
| `product_release/evidence/beta50_2026-07-09/README.md` | 2026-07-09 | Beta-50 QA artifact drop-zone spec (expected run screenshots / console / network exports). |
| `product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` | 2026-07-10 | Historical Option-D functional-QA sell-off (then-current engine paths; provenance only, never current policy or GO evidence). |
| `product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md` | 2026-07-10 | Private-path deployed validation (owner-accepted PASS; download-progress branch noted as non-reproducible on the default served model). |
| `product_release/evidence/beta50_private_2026-07-10/desktop-private-cached-return.jpg` / `mobile-private-recording.jpg` | 2026-07-10 | Private-path desktop/mobile screenshots. |
| `product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md` | 2026-06-17 | Private-selection product audit. |

---

## 6. Historical STT release reports (`evidence/stt/reports/`)

Root-cause archaeology only; not authoritative after newer proof exists (per the archive rules absorbed into §2).

| Artifact | Date | What it captured |
|---|---|---|
| `product_release/evidence/stt/reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md` | 2026-06-02 (updated 2026-06-04) | Private v2 local/browser STT: setup consent, accuracy, trust UI, save/history/detail. |
| `product_release/evidence/stt/reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md` | 2026-06-02 | Cloud STT release evidence. |
| `product_release/evidence/stt/reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md` | 2026-06-02 | Native (Browser) STT release evidence. |
| `product_release/evidence/stt/reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md` | 2026-06-02 | STT speed/accuracy market-survival review. |

---

## 7. Retained evidence indexed from other sources

These dated proofs are retained under `evidence/retained/`. The current interpretation is owned by the canonical document named.

| Retained-evidence destination | Captured content | Interpretation owned by |
|---|---|---|
| `evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md` | Complete pre-consolidation classification of the then-97-file non-archive Markdown surface plus the claim-by-claim code audit. Paths are historical after canonical closeout. | `README.md` (current 14-document authority) + owning canonical document for each product claim |
| `evidence/retained/PUBLIC_LAUNCH_LEDGER.md` | Dated broad-launch gate proofs PL-001…PL-011: public signup, first Free session, test-mode Stripe checkout→entitlement journey, webhook/billing-lifecycle local proofs, trial lifecycle and historical provider-path evidence. | `ROADMAP.md` (open gates) + `RELEASE_STATUS.md` (current) |
| `evidence/retained/2026-08-30-stt-selection-inventory.md` | Point-in-time mechanical inventory of the nine fragmented Private-STT model-selection mechanisms present on `main@024b574f` (URL parameters, localStorage keys, PostHog flags, build veto, default constants), plus the `getMetadata` default-variant defect. Carries an appended 2026-09-01 CORRECTION: several line numbers were attributed to the wrong file and the source/test split was wrong. All listed mechanisms are retired as of #1263. | `ROADMAP.md` (open gates) + the config plane in `services/transcription/candidateSelection.ts` |
| `evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | Dated entitlement audit: former Pro cap reconciliation, AI-quota verification and fail-closed guard checks. | `ENTITLEMENTS_AND_BILLING.md` (requirement) + `ROADMAP.md` (open ops) |
| [`archive/superseded-docs-2026-08-29/SCA_EXCEPTIONS.md`](./archive/superseded-docs-2026-08-29/SCA_EXCEPTIONS.md) — pinned-audit execution result (2026-07-15) | Historical SCA pinned-audit result and advisory rationale; not a fresh vulnerability scan or current green verdict. | `OPERATIONS_AND_SECURITY.md` §8 owns current exception rationale. |
| `evidence/retained/RELEASE_CLOSEOUT_LEDGER.md` — dated proof rows (§B doc-gap closures, §E DB-hygiene closeout) | Dated documentation-gap and DB-hygiene closeout records. | `ROADMAP.md` (open) + this index (dated) |
| Manual hardware evidence logs (captured per the `TESTER_OPERATIONS.md` run; e.g. dated Chrome physical-mic proof) | Real-device Native/Private hardware run logs (browser/version, spoken sentence, stop/save/history/analytics). | `QUALITY.md` (protocol) + `TESTER_OPERATIONS.md` (run) |

---

## 8. Exploratory reference (`v4_work/`)

`product_release/v4_work/**` holds historical v4 exploration material. It is **EVIDENCE_ONLY / retained reference**, not a current release path or activation authority. Future model administration is described in [`TESTER_OPERATIONS.md` §6](./TESTER_OPERATIONS.md#6-private-v4-administration) and `STT.md`; current runtime posture belongs only in `RELEASE_STATUS.md`.

---

*Historical evidence index. It records where dated proofs live and when they were captured; it never states current release status — that lives only in `RELEASE_STATUS.md`.*

## Retained source and consumer inventory

The following records are retained byte-for-byte for dated evidence, reproducibility, rejected-experiment history, test-consumer or bounded receiving role. They are not current product/deployment/operational instructions. Current policy follows canonical roots and the #1674 receiving register; historical model queues do not select new work. This explicit index identifies their existing evidence consumer, but does not by itself justify permanent retention under the newer document-disposition contract. No historical result is rewritten or promoted. The 1314 context script remains bound to its frozen source; finance is unvalidated/separate; the merged 1665 handoff is provenance, not a current assignment. Proposed consolidation/removal needs a content and inbound-consumer review and separate approval; this task deletes nothing.

- [evidence-runs/README.md](../evidence-runs/README.md) — retained dated source; evidence/provenance, not release authority.
- [evidence-runs/frozen-600-contamination.md](../evidence-runs/frozen-600-contamination.md) — retained dated source; evidence/provenance, not release authority.
- [local-packets/1593-case7-received-failure/ACTIVE_HANDOFF.md](../local-packets/1593-case7-received-failure/ACTIVE_HANDOFF.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md](evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/CODEBASE_VS_STRATEGY_2026-08-29.md](evidence/CODEBASE_VS_STRATEGY_2026-08-29.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md](evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md](evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md](evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/README.md](evidence/README.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/beta50_2026-07-09/README.md](evidence/beta50_2026-07-09/README.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md](evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md](evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/2026-08-30-moonshine-engine-runtime/README.md](evidence/retained/2026-08-30-moonshine-engine-runtime/README.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/2026-08-30-stt-selection-inventory.md](evidence/retained/2026-08-30-stt-selection-inventory.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/2026-09-11-test-estate-catalog.md](evidence/retained/2026-09-11-test-estate-catalog.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md](evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md](evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/PUBLIC_LAUNCH_LEDGER.md](evidence/retained/PUBLIC_LAUNCH_LEDGER.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/RELEASE_CLOSEOUT_LEDGER.md](evidence/retained/RELEASE_CLOSEOUT_LEDGER.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/SECRETS_ATTACK_SURFACE_AUDIT.md](evidence/retained/SECRETS_ATTACK_SURFACE_AUDIT.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/attribution-sanitation-crosswalk.md](evidence/retained/attribution-sanitation-crosswalk.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/retained/moonshine-windowed-ef.MANIFEST.md](evidence/retained/moonshine-windowed-ef.MANIFEST.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/README.md](evidence/stt/README.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/GATE_B_IDENTITY_FAILURE_ANALYSIS.md](evidence/stt/historical-browser/GATE_B_IDENTITY_FAILURE_ANALYSIS.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/NATIVE_BROWSER_SECOND_OPINION_PACKET_2026-05-25.md](evidence/stt/historical-browser/NATIVE_BROWSER_SECOND_OPINION_PACKET_2026-05-25.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/NATIVE_BROWSER_STT_SECOND_OPINION_REPORT_2026-05-26.md](evidence/stt/historical-browser/NATIVE_BROWSER_STT_SECOND_OPINION_REPORT_2026-05-26.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/STT_BROWSER_EVIDENCE_2026-05-25.md](evidence/stt/historical-browser/STT_BROWSER_EVIDENCE_2026-05-25.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/STT_BROWSER_TRACE_REVIEW_BRIEF.md](evidence/stt/historical-browser/STT_BROWSER_TRACE_REVIEW_BRIEF.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/historical-browser/STT_CONSTANTS_AUDIT.md](evidence/stt/historical-browser/STT_CONSTANTS_AUDIT.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md](evidence/stt/reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/reports/stt_product_metrics_release_matrix_2026-06-02.md](evidence/stt/reports/stt_product_metrics_release_matrix_2026-06-02.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/retained-contracts/PRIVATE_STT_ACCURACY_LEVERS.md](evidence/stt/retained-contracts/PRIVATE_STT_ACCURACY_LEVERS.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/retained-contracts/STT_BASELINE_CONTRACTS.operational.md](evidence/stt/retained-contracts/STT_BASELINE_CONTRACTS.operational.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/evidence/stt/retained-contracts/stt-perf-proof-protocol.md](evidence/stt/retained-contracts/stt-perf-proof-protocol.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/v4_work/V4_APP_PATH_PROOF_RUNBOOK.md](v4_work/V4_APP_PATH_PROOF_RUNBOOK.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/v4_work/V4_COMPLETE_TEST_RUNBOOK.md](v4_work/V4_COMPLETE_TEST_RUNBOOK.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md](v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/v4_work/V4_POSTHOG_READINESS_PROOF.md](v4_work/V4_POSTHOG_READINESS_PROOF.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/v4_work/V4_RECOVERY.md](v4_work/V4_RECOVERY.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/work_items/1314-atomic-rpc-evidence-packet.md](work_items/1314-atomic-rpc-evidence-packet.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/work_items/1314-correction-design.md](work_items/1314-correction-design.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/work_items/1314-migration-apply-packet.md](work_items/1314-migration-apply-packet.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/work_items/P0_PRIVATE_STT_FINDINGS.md](work_items/P0_PRIVATE_STT_FINDINGS.md) — retained dated source; evidence/provenance, not release authority.
- [product_release/work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-09-05.md](work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-09-05.md) — retained dated source; evidence/provenance, not release authority.

<!-- clause-closeout:2026-10-28 -->
## Consolidated predecessor controls and interpretation

### Clause receiving record and evidence limits

The documentation clause receiving artifact is an attributed record of what predecessor documents said, not an executed test ledger. Each record binds exact source text and hash to the retained meaning, exact canonical interpretation and superseding authority. Original reported PASS/FAIL/HOLD, metrics, rejected candidates and missing /private/tmp receipts remain distinguishable. Documentary quotation preserves provenance; it does not independently verify an execution or establish a baseline regression. R5/r14 and the distinction between campaign R4 and true campaign 3-R4C require the correctly bound originals and independent review; overlay labels cannot establish a regression. The original source documents remain undeleted until the separate removal decision.

### Historical browser trace interpretation

The 23 May trace brief used synthetic macOS speech through local preview/CDP. Native duplication improved but provider-final content remained wrong; successful save and a polished score did not establish transcript quality. Private first visible text was reported at 10.527 seconds, with missed opening fillers and noise/tail hallucinations despite earlier chunks reaching inference. Cloud remained disabled under a PRO badge, so that run measured an admission/UI mismatch, not provider quality. Preserve those separate findings, the input and artifact identities; none is a current customer-engine verdict. Current customer transcription is Private-only, and the surviving onset, tail, timing, save and evidence-validity controls are in STT and QUALITY.

### Private STT experiment interpretation

Keep the June STT-P1/P1D/P5/P6/P7/P8 histories separate. P5's equal 87.5% result fell back to RMS and did not test Silero; WASM MIME/HTML failures were setup failures. P6 first failed on HTML assets, then on unsupported model type, before v2-compatible models ran. Base improved h1_6 to 100%, while small was rejected after 87.5% with 46,728ms finalization; the later enriched base proof still lost the leading filler and reported 123,159ms Washington finalization versus 12,614ms tiny with equal 99.48% accuracy. These are different runs, not one winning baseline. Human requests for base that actually recorded tiny remain tiny evidence. P8's box/linear comparisons showed timing changes but no accuracy lift, and easy perfect guard rows did not test the original casualty. Decode-parameter A/B worsened 25% WER to 100% and was rejected.

### Private lifecycle and filler evidence interpretation

P1D's filler-count improvement did not close repeated or order-wrong saved speech: the later partial proof still lost/moved opening Um and retained extra trailing words, despite a loose browser test passing. P7 controller grace did not fix the separate service frozen warning; the subsequent injected smoke passed but omitted the heartbeat trace, and human proof remained distinct. The original Private CI proof reported 51.72% WER after successful save, while v4 produced an empty candidate; neither was an authentication-only failure. Preserve the earlier human 56.36% accuracy / 66.67% filler recall and empty-detail observation separately from later injected save/detail passes. Hard-navigation loss and rapid-churn render-loop FAILs remain original outcomes, not silently closed by model improvements.

### Model, runtime and contamination interpretation

The earlier 93.89% clean-file tiny result bypassed the browser mic path and is not a universal model ceiling. Mic-DSP repeats gave raw 75% / 25% and browser-default 75% / 75%, so they did not justify a default change. Thread/WebGPU acceleration hypotheses did not measure a speedup. Preserve v4 q4/WASM data-location failures, successful Node isolates and later browser dtype/single-thread evidence as different runtime experiments; none alone proves product promotion. Preserve Moonshine run1/run2 FAILs, the missing run2 exit, and the later 5% tolerance interpretation without rewriting the original byte-instability result. One 12-second loader/zero-body-byte proof is neither model quality nor complete privacy. Frozen 600 timing contamination leaves performance unmeasured until score-identical quiet reruns; smoke 85, preflight 459 and frozen 10,894 reference words are distinct denominators.

### Historical release and audit interpretation

PL-001–011 and the June closeout contain dated entry, billing, trial, feedback/PDF, viewport and observability observations, not current launch clearance. Physical mobile/touch remained unproved; viewport images, PDF affordances and transport acknowledgements cannot replace device, parsed-export or persistence evidence. The old 35-account inventory and Dev-none-in-flight statement are not current state. Preserve original A1–A6 backlog decisions and requested evidence through the current receiver, without selecting old v4 targeting, broad branch deletion or account cleanup. The historical 615-file / 6,158-case catalog and 97-document ledger are snapshots, not current denominators. Source-built Progress, privacy boundaries or compliance collateral do not establish a moat, demand, willingness to pay, retention or a commercial advantage.

### Rejected design and integration receipts

The withdrawn first #1314 packet, later additive-RPC correction and original two-transcript design remain separate documentary stages. Preserve the ambiguity/partial-apply/rollback casualties; do not apply a superseded migration packet as current procedure. The case1/case7 handoffs preserve original red controls, known-interrupted versus unknown-stage behavior, received failure binding and cap negatives; later test totals are reported receipts, not fresh execution here. The paired-evaluator handoff requires an independently frozen manifest×trial population and rejects shared missing/duplicate/substituted rows; completeness does not approve its statistics, corpus or model. The attribution sanitation crosswalk remains a distinct lookup for old/new identities and signature limitations; it does not settle the separately missing historical tag chronology.

### Native and Cloud historical qualification limits

The May 25 synthetic browser run reported Private first text 9.783s, Native 8.655s with only a weak partial, and Cloud 9.670s after correcting account entitlement. Clean console/network counts did not establish useful text or meet the then-defined Private <6s target. The May 25 Native reviewer packet described non-continuous recognition as RC-red; the May 26 second opinion reported a later human continuous-recognition journey, explicitly withheld Edge equivalence and rejected fake-device WER without proof that the fixture reached Web Speech. These are different observations, not one corrected PASS. The June Native report still had empty detail despite a 55-word saved transcript and 853ms formatter; reported 35/35 frontend and 73/73 Edge steps, then 68/68 and 31/31 subsets, did not close human detail/truecasing. The June Cloud report recorded ~91.86% corrected target versus ~91.53% app corpus, 44/44 local contracts and one 46.2s deployed smoke; full tail/readability/WER proof remained open. Pre-fix trust-label contamination must not be attributed to a later head without reproof. These legacy provider paths, localhost-only gates, pricing and launch priorities do not override the current Private-only product or canonical deployment binding.

### Historical identity diagnosis and manual-unblock limit

Gate B records five distinct fixes: identity invocation, initialization order, ingested-event materialization, an ineffective flush attempt and immediate capture. Its initial bot-filter explanation was an inference without the exact harness UA/driver readback; the later human-login resolution and targeted/negative stacked proof are separate evidence. A queryable received identity event is stronger than a local identify call or a flags request. The reported targeted v4 WER 0.1099 and RTF 0.0760 versus default-v2 WER 0.0890, with save/detail/post-stop integrity, describe that stacked test build. They do not establish a durable automated identity harness, a production model promotion or current PostHog selection authority. Preserve the API lesson: confirm an SDK method in its declared public contract; a guarded nonexistent flush call is not transport proof. Old targeting/UA-masking/admin-repair procedures confer no current authority.

### v4 runtime chronology and surviving experiment controls

The June recovery matrices reported q8 session creation failing on a missing decoder scale and q4 failing with invalid data location. Node isolates decoded successfully, but single-thread/no-proxy browser repeats still failed, falsifying that proposed browser fix; later exact-contract failures had blank runtime version fields. Preserve those FAILs alongside the later reported WASM decode in run 27305398130 and the separate detail/403 issue and claimed #85 resolution. They cannot be collapsed into a universal WASM failure, an authentication-only failure or a fully qualified browser success. A runtime experiment must first produce nonempty text and observed version/dtype/device/model-file identity, then test app save/detail equality and the intended hardware. Strict override failures, one-shot AUTO fallback success and actual candidate success are separate outcomes. The old three-gate flag readiness, 93.89% threshold, PostHog selector, branch commands and GPU dispatches are superseded operational instructions, not selected work. Preserve the controlled model/device/dtype/main-thread-versus-worker hypothesis matrix as experiment design only; do not enact its proposed fixes without a matching casualty and approved experiment.

### Moonshine loader and window receipts

The engine-runtime proof found and corrected a ModelArch token/member mismatch that fake-transcriber tests could not detect. Both arches reportedly produced different component requests and genuine live-window versus final output on one 12.23-second clip; seven pinned assets per arch and zero request bodies bound that observation. runtimeVersion and assetIdentity were null in the loaded transcriber, so attribution came from intercepted asset URLs/digests, not the session record. The separate windowed E/F runs used seven verified warm-cache components with no network fallback, a clean 38-word reference rather than the filler fixture, and retained original FAIL verdicts. E2 differed across runs and E3 failed both; the final word varied while earlier words agreed. The later 1/38 (2.63%) drift interpretation under a 5% rule does not rewrite the exact-equality failure or prove corpus/device quality. Preserve the corrected pin-source citation, the uncaptured second exit code and the original payloads/digests; exact reproducibility and broader promotion are separate.

### Beta-50 QA scope and artifact limits

The July 9 Beta-50 directory was an expected-artifact checklist, explicitly empty pending QA; named screenshots/PDF/DB files were not proof they existed. July 10 Option D later reported functional QA-GO on 899161b2, distinct from the owner’s overall invite/release decision. Private cached return and mobile-viewport start were observed; physical mobile proof was not established by the 390×844 viewport. PDF proof stopped at an affordance and reachability without generating a file. Preserve the old issue-report row fields and false/null content opt-ins as historical schema evidence, not current feedback fields. The uncached remote-model percentage-progress branch was unit-covered but not reproduced on the served default, and cache clearing did not prove that branch ran. Browser filler/readability caveats and the proposed forced-download follow-up remain dated limits; no old model selector or provider path is reopened.

### Interrupted-repeat and answered-failure integration limits

Case 1 removed only the generic practice_loop requirement when every declared stage is known, an interrupted stage is present and no declared stage independently requires that loop. Missing identity/attribution/lifecycle, foreign end, stale rendering, duplicate/wrong-attempt delivery and mixed full-review/unknown declarations retain their original HOLD/FAIL controls. Its baseline 4 FAIL/24 PASS, then 122 PASS, returned J2 1 FAIL/32 PASS and corrected 160 PASS are distinct reported runs. Case 7 allows independently received answered-failure assurance without promoting unsuccessful coaching; unanswered network failures cannot invent a model. Preserve raw failure versus normalized outcome mapping and the producer cap of 1–3 attempts, with 4/large-integer negatives. Its 27 FAIL/6 PASS baseline, 24 FAIL/92 PASS integration attempt, 274/428 subsequent checks, cap-red 1 FAIL/38 PASS and 281 corrected checks remain separate. Prior quality runs and later packaging/normalization do not establish fresh exact-head quality. Historical publication/ownership directions are not current leases. Both packets retain raw/normalized digest provenance and leave product coaching, saved-pair completeness, human observations and release acceptance open.

### Paired-evidence completeness remains distinct from statistics

The #1565 primitive requires runtime arrays and exactly one row per independently frozen manifest × trial key in both arms, matching reference hash/count and cluster; shared omission, duplicates, substitution and delimiter aliasing reject. Repeated trials retain reference/cluster identity. Empty-reference silence and execution-failure rows stay in the population without invented scores. The reported 52/52 controls do not establish runner integration: the expected population must be built independently of observed output and tested with a shared observed omission. The legacy bootstrap intersection is not a completeness gate. Repeated-trial aggregation, paired-speaker resampling, sparse clusters, ratio-of-counts and confidence-bound policy remain separately open; the unavailable Research API export and source-byte verification are not waived by the primitive.

### Public-launch gate receipts and surviving controls

Keep PL-001 public signup/re-entry separate from PL-002’s synthetic first-use Native journey. PL-003–005 record accepted test-mode checkout, persisted entitlement, unsigned-webhook rejection and local cancellation/failure/replay/RPC controls; their later activation correction supersedes earlier demands for mandatory real-money proof. PL-006’s trial/sample-era classifications conflict across dated rows and do not define today’s immutable 30-day grant. PL-007 distinguishes physical-mic Cloud evidence from provider-only fallback proof; neither restores Cloud entitlement. PL-008’s HTTP 200 coaching pair does not establish human usefulness. PL-009 parsed an exported PDF, unlike a mere download-button proof, but unknown model metadata cannot establish attribution. PL-010 explicitly leaves physical touch pending despite viewport PASS. PL-011 records independent provider API readback, with Sentry issue search used because Events API returned 403; a successful send alone would not reproduce that receipt. Keep all eleven IDs and original outcomes; use current QUALITY for journey/export/device assertions and ENTITLEMENTS_AND_BILLING for today’s commercial boundary. Old prices, tiers, account identities and operational commands stay historical.

### Release-closeout residual register

The June closeout’s A1 v4 lifecycle, A2 real RMS meter, A3 principled repetition prevention, A4 cross-utterance tuning, A5 mock/boot consolidation and A6 stale-branch cleanup remain identifiable dated backlog decisions, not newly selected fixes. A2’s decorative indicator was accepted then; no new measured meter is implied. The saved repetition collapse was subsequently superseded by non-mutating risk metadata while display-only treatment remained separate. Earlier sample/entitlement invariants are superseded by the current commercial contract. The SLO sequence retains its latency-only failure and subsequent recovered backend timings with browser-endurance setup blocked by max_concurrent_sessions_reached; neither proves the fixture-versus-product cause. The 1,445-to-35 account cleanup, protected live account, zero drift and reused-fixture claims are dated receipts, never a current inventory or deletion authorization. Keep raw proof links/digests, source-versus-live distinction for quota/customer persistence and content-free recovery limits. The old none-in-flight statement cannot establish Jensen’s availability.
<!-- /clause-closeout:2026-10-28 -->

### Selection-inventory correction

The 024b574f selection inventory incorrectly attributed several readers to privateModelFlag, called URL parameters localStorage keys, and omitted the provider-default authority. Its appended correction must travel with the original assertions. Retired URL/window/storage and experiment selectors are not current product authority; use the checked-in configuration, governed pre-Start fallback/locking and observed attribution contract. This preserves the correction without maintaining a duplicate current selector map.

The [clause receiving artifact](./evidence/retained/documentation-clause-receiving-2026-10-28.json)
contains exact attributed documentary statements, source hashes and clause locations,
and the canonical interpretation bound to each. It is a documentation-audit input for
receiving and removal review, not a replacement for missing executed ledgers. Original
content-bearing speech excerpts remain only in their unchanged source, with hash/line
binding rather than another transcript copy. The source documents remain intact.

### Consolidated interpretation routing

Sources below remain undeleted pending a separate removal decision. Current interpretation is drafted at the linked destination; exact documentary clauses and source hashes are bound in the receiving artifact. A historical evidence link does not itself justify keeping duplicate operational prose.

| Original documentary source | Current interpretation and retained controls |
|---|---|
| [.github/runbooks/PAID_CANARY_CUTOVER.md](../.github/runbooks/PAID_CANARY_CUTOVER.md) | [Genuine paid-fixture acceptance boundary](ENTITLEMENTS_AND_BILLING.md#genuine-paid-fixture-acceptance-boundary) |
| [.github/runbooks/RWT_FEEDBACK_DIAGNOSTIC_ACCEPTANCE.md](../.github/runbooks/RWT_FEEDBACK_DIAGNOSTIC_ACCEPTANCE.md) | [Open Mic and returning-user acceptance controls](QUALITY.md#open-mic-and-returning-user-acceptance-controls); [Focus Points acceptance controls](QUALITY.md#focus-points-acceptance-controls); [Feedback storage and request-binding controls](QUALITY.md#feedback-storage-and-request-binding-controls); [Independent coaching diagnostic binding](QUALITY.md#independent-coaching-diagnostic-binding); [Human evidence and coaching-copy boundaries](QUALITY.md#human-evidence-and-coaching-copy-boundaries); [Journey execution and cleanup boundaries](TESTER_OPERATIONS.md#journey-execution-and-cleanup-boundaries) |
| [.github/runbooks/flawless-launch-contract-audit.md](../.github/runbooks/flawless-launch-contract-audit.md) | [Inherited commercial-remediation acceptance matrix](ENTITLEMENTS_AND_BILLING.md#inherited-commercial-remediation-acceptance-matrix) |
| [backend/supabase/howto-remote-supabase-deploy.md](../backend/supabase/howto-remote-supabase-deploy.md) | [5.1 Default-off integration and served-release binding](RELEASE_PROCESS.md#51-default-off-integration-and-served-release-binding) |
| [evidence-runs/README.md](../evidence-runs/README.md) | [9. Model-selection evidence history](STT.md#9-model-selection-evidence-history) |
| [evidence-runs/frozen-600-contamination.md](../evidence-runs/frozen-600-contamination.md) | [Model, runtime and contamination interpretation](EVIDENCE_INDEX.md#model-runtime-and-contamination-interpretation) |
| [local-packets/1593-case1-interrupted-gate/ACTIVE_HANDOFF.md](../local-packets/1593-case1-interrupted-gate/ACTIVE_HANDOFF.md) | [Interrupted-repeat and answered-failure integration limits](EVIDENCE_INDEX.md#interrupted-repeat-and-answered-failure-integration-limits) |
| [local-packets/1593-case7-received-failure/ACTIVE_HANDOFF.md](../local-packets/1593-case7-received-failure/ACTIVE_HANDOFF.md) | [Interrupted-repeat and answered-failure integration limits](EVIDENCE_INDEX.md#interrupted-repeat-and-answered-failure-integration-limits) |
| [local-packets/evaluator-1565-paired-evidence/README.md](../local-packets/evaluator-1565-paired-evidence/README.md) | [Paired-evidence completeness remains distinct from statistics](EVIDENCE_INDEX.md#paired-evidence-completeness-remains-distinct-from-statistics) |
| [product_release/evidence/CODEBASE_VS_STRATEGY_2026-08-29.md](evidence/CODEBASE_VS_STRATEGY_2026-08-29.md) | [Strategy evidence and execution order](ROADMAP.md#strategy-evidence-and-execution-order) |
| [product_release/evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md](evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md) | [5a. Metric definition matrix (#1265)](PROGRESS_AND_NEXT_ACTION.md#5a-metric-definition-matrix-1265) |
| [product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md](evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md) | [Selection-harness evidence boundary](STT.md#selection-harness-evidence-boundary) |
| [product_release/evidence/beta50_2026-07-09/README.md](evidence/beta50_2026-07-09/README.md) | [Beta-50 QA scope and artifact limits](EVIDENCE_INDEX.md#beta-50-qa-scope-and-artifact-limits) |
| [product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md](evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md) | [Beta-50 QA scope and artifact limits](EVIDENCE_INDEX.md#beta-50-qa-scope-and-artifact-limits) |
| [product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md](evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md) | [Beta-50 QA scope and artifact limits](EVIDENCE_INDEX.md#beta-50-qa-scope-and-artifact-limits) |
| [product_release/evidence/retained/2026-08-30-moonshine-engine-runtime/README.md](evidence/retained/2026-08-30-moonshine-engine-runtime/README.md) | [Moonshine loader and window receipts](EVIDENCE_INDEX.md#moonshine-loader-and-window-receipts) |
| [product_release/evidence/retained/2026-08-30-stt-selection-inventory.md](evidence/retained/2026-08-30-stt-selection-inventory.md) | [Selection-inventory correction](EVIDENCE_INDEX.md#selection-inventory-correction) |
| [product_release/evidence/retained/2026-09-11-test-estate-catalog.md](evidence/retained/2026-09-11-test-estate-catalog.md) | [Historical release and audit interpretation](EVIDENCE_INDEX.md#historical-release-and-audit-interpretation) |
| [product_release/evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md](evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md) | [Historical entitlement-drift interpretation](ENTITLEMENTS_AND_BILLING.md#historical-entitlement-drift-interpretation) |
| [product_release/evidence/retained/PUBLIC_LAUNCH_LEDGER.md](evidence/retained/PUBLIC_LAUNCH_LEDGER.md) | [Inherited public-entry and commercial controls](ENTITLEMENTS_AND_BILLING.md#inherited-public-entry-and-commercial-controls); [Public-launch gate receipts and surviving controls](EVIDENCE_INDEX.md#public-launch-gate-receipts-and-surviving-controls); [Human evidence and coaching-copy boundaries](QUALITY.md#human-evidence-and-coaching-copy-boundaries) |
| [product_release/evidence/retained/RELEASE_CLOSEOUT_LEDGER.md](evidence/retained/RELEASE_CLOSEOUT_LEDGER.md) | [Inherited public-entry and commercial controls](ENTITLEMENTS_AND_BILLING.md#inherited-public-entry-and-commercial-controls); [Release-closeout residual register](EVIDENCE_INDEX.md#release-closeout-residual-register) |
| [product_release/evidence/retained/SECRETS_ATTACK_SURFACE_AUDIT.md](evidence/retained/SECRETS_ATTACK_SURFACE_AUDIT.md) | [Historical inventory does not authorize secret deletion](OPERATIONS_AND_SECURITY.md#historical-inventory-does-not-authorize-secret-deletion) |
| [product_release/evidence/retained/moonshine-windowed-ef.MANIFEST.md](evidence/retained/moonshine-windowed-ef.MANIFEST.md) | [Moonshine loader and window receipts](EVIDENCE_INDEX.md#moonshine-loader-and-window-receipts) |
| [product_release/evidence/stt/historical-browser/GATE_B_IDENTITY_FAILURE_ANALYSIS.md](evidence/stt/historical-browser/GATE_B_IDENTITY_FAILURE_ANALYSIS.md) | [Historical identity diagnosis and manual-unblock limit](EVIDENCE_INDEX.md#historical-identity-diagnosis-and-manual-unblock-limit) |
| [product_release/evidence/stt/historical-browser/NATIVE_BROWSER_SECOND_OPINION_PACKET_2026-05-25.md](evidence/stt/historical-browser/NATIVE_BROWSER_SECOND_OPINION_PACKET_2026-05-25.md) | [Native and Cloud historical qualification limits](EVIDENCE_INDEX.md#native-and-cloud-historical-qualification-limits) |
| [product_release/evidence/stt/historical-browser/NATIVE_BROWSER_STT_SECOND_OPINION_REPORT_2026-05-26.md](evidence/stt/historical-browser/NATIVE_BROWSER_STT_SECOND_OPINION_REPORT_2026-05-26.md) | [Native and Cloud historical qualification limits](EVIDENCE_INDEX.md#native-and-cloud-historical-qualification-limits) |
| [product_release/evidence/stt/historical-browser/STT_BROWSER_EVIDENCE_2026-05-25.md](evidence/stt/historical-browser/STT_BROWSER_EVIDENCE_2026-05-25.md) | [Native and Cloud historical qualification limits](EVIDENCE_INDEX.md#native-and-cloud-historical-qualification-limits) |
| [product_release/evidence/stt/historical-browser/STT_BROWSER_TRACE_REVIEW_BRIEF.md](evidence/stt/historical-browser/STT_BROWSER_TRACE_REVIEW_BRIEF.md) | [Historical browser trace interpretation](EVIDENCE_INDEX.md#historical-browser-trace-interpretation); [Capture and lifecycle counterexamples](STT.md#capture-and-lifecycle-counterexamples); [Watchdog and final-text integrity controls](STT.md#watchdog-and-final-text-integrity-controls) |
| [product_release/evidence/stt/historical-browser/STT_CONSTANTS_AUDIT.md](evidence/stt/historical-browser/STT_CONSTANTS_AUDIT.md) | [Constants and realistic audio-cadence controls](STT.md#constants-and-realistic-audio-cadence-controls) |
| [product_release/evidence/stt/reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md) | [Native and Cloud historical qualification limits](EVIDENCE_INDEX.md#native-and-cloud-historical-qualification-limits) |
| [product_release/evidence/stt/reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md) | [Native and Cloud historical qualification limits](EVIDENCE_INDEX.md#native-and-cloud-historical-qualification-limits) |
| [product_release/evidence/stt/reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md](evidence/stt/reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md) | [Private STT experiment interpretation](EVIDENCE_INDEX.md#private-stt-experiment-interpretation); [Private lifecycle and filler evidence interpretation](EVIDENCE_INDEX.md#private-lifecycle-and-filler-evidence-interpretation); [Inherited thresholds and promotion boundaries](STT.md#inherited-thresholds-and-promotion-boundaries); [Complete product-quality measurement boundary](STT.md#complete-product-quality-measurement-boundary) |
| [product_release/evidence/stt/reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md](evidence/stt/reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md) | [Complete product-quality measurement boundary](STT.md#complete-product-quality-measurement-boundary) |
| [product_release/evidence/stt/reports/stt_product_metrics_release_matrix_2026-06-02.md](evidence/stt/reports/stt_product_metrics_release_matrix_2026-06-02.md) | [Complete product-quality measurement boundary](STT.md#complete-product-quality-measurement-boundary) |
| [product_release/evidence/stt/retained-contracts/PRIVATE_STT_ACCURACY_LEVERS.md](evidence/stt/retained-contracts/PRIVATE_STT_ACCURACY_LEVERS.md) | [Model, runtime and contamination interpretation](EVIDENCE_INDEX.md#model-runtime-and-contamination-interpretation); [Attributing a performance or accuracy gap](STT.md#attributing-a-performance-or-accuracy-gap); [Inherited thresholds and promotion boundaries](STT.md#inherited-thresholds-and-promotion-boundaries) |
| [product_release/evidence/stt/retained-contracts/STT_BASELINE_CONTRACTS.operational.md](evidence/stt/retained-contracts/STT_BASELINE_CONTRACTS.operational.md) | [Attributing a performance or accuracy gap](STT.md#attributing-a-performance-or-accuracy-gap); [Inherited thresholds and promotion boundaries](STT.md#inherited-thresholds-and-promotion-boundaries); [Lifecycle trace completeness and historical baseline limits](STT.md#lifecycle-trace-completeness-and-historical-baseline-limits) |
| [product_release/evidence/stt/retained-contracts/stt-perf-proof-protocol.md](evidence/stt/retained-contracts/stt-perf-proof-protocol.md) | [Measurement layers and controlled comparisons](STT.md#measurement-layers-and-controlled-comparisons); [Attributing a performance or accuracy gap](STT.md#attributing-a-performance-or-accuracy-gap); [Inherited thresholds and promotion boundaries](STT.md#inherited-thresholds-and-promotion-boundaries) |
| [product_release/v4_work/V4_APP_PATH_PROOF_RUNBOOK.md](v4_work/V4_APP_PATH_PROOF_RUNBOOK.md) | [v4 runtime chronology and surviving experiment controls](EVIDENCE_INDEX.md#v4-runtime-chronology-and-surviving-experiment-controls) |
| [product_release/v4_work/V4_COMPLETE_TEST_RUNBOOK.md](v4_work/V4_COMPLETE_TEST_RUNBOOK.md) | [v4 runtime chronology and surviving experiment controls](EVIDENCE_INDEX.md#v4-runtime-chronology-and-surviving-experiment-controls) |
| [product_release/v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md](v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md) | [v4 runtime chronology and surviving experiment controls](EVIDENCE_INDEX.md#v4-runtime-chronology-and-surviving-experiment-controls) |
| [product_release/v4_work/V4_POSTHOG_READINESS_PROOF.md](v4_work/V4_POSTHOG_READINESS_PROOF.md) | [v4 runtime chronology and surviving experiment controls](EVIDENCE_INDEX.md#v4-runtime-chronology-and-surviving-experiment-controls) |
| [product_release/v4_work/V4_RECOVERY.md](v4_work/V4_RECOVERY.md) | [v4 runtime chronology and surviving experiment controls](EVIDENCE_INDEX.md#v4-runtime-chronology-and-surviving-experiment-controls) |
| [product_release/work_items/1314-atomic-rpc-evidence-packet.md](work_items/1314-atomic-rpc-evidence-packet.md) | [Completion and retention failure boundaries](ARCHITECTURE.md#completion-and-retention-failure-boundaries); [Database proof and rollback interpretation](ARCHITECTURE.md#database-proof-and-rollback-interpretation) |
| [product_release/work_items/1314-correction-design.md](work_items/1314-correction-design.md) | [Completion and retention failure boundaries](ARCHITECTURE.md#completion-and-retention-failure-boundaries); [Database proof and rollback interpretation](ARCHITECTURE.md#database-proof-and-rollback-interpretation) |
| [product_release/work_items/P0_PRIVATE_STT_FINDINGS.md](work_items/P0_PRIVATE_STT_FINDINGS.md) | [Completion and retention failure boundaries](ARCHITECTURE.md#completion-and-retention-failure-boundaries); [Stale-bundle and account-exit receiving controls](ARCHITECTURE.md#stale-bundle-and-account-exit-receiving-controls); [Historical inventory does not authorize secret deletion](OPERATIONS_AND_SECURITY.md#historical-inventory-does-not-authorize-secret-deletion) |
| [scripts/FILLER_KNOWN_SCRIPT_RUNBOOK.md](../scripts/FILLER_KNOWN_SCRIPT_RUNBOOK.md) | [Known-speech filler diagnostics](TESTER_OPERATIONS.md#known-speech-filler-diagnostics) |
| [tests/CODEBASE_FIX_APPROACH.md](../tests/CODEBASE_FIX_APPROACH.md) | [Boundary debugging and test execution reference](QUALITY.md#boundary-debugging-and-test-execution-reference) |
| [tests/TESTING.md](../tests/TESTING.md) | [Boundary debugging and test execution reference](QUALITY.md#boundary-debugging-and-test-execution-reference) |
| [tests/TEST_PLAYBOOK.md](../tests/TEST_PLAYBOOK.md) | [Boundary debugging and test execution reference](QUALITY.md#boundary-debugging-and-test-execution-reference) |
| [video-production/README.md](../video-production/README.md) | [Predecessor decisions and remaining receiving ownership](ROADMAP.md#predecessor-decisions-and-remaining-receiving-ownership) |

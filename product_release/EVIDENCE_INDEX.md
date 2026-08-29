**Status:** Authoritative (SSOT for the index of dated proof artifacts — an index, not the proofs themselves)
**Owner:** Product-Ops / Quality (relativityE)
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-08-29 — artifact locations enumerated after consolidation; retained root-level ledgers/audits moved under `evidence/retained/`. This file indexes historical evidence; it carries no current release posture.
**Applies To:** All dated release-proof artifacts for the SpeakSharp beta — where each lives, when it was captured, and what it proved at that moment.
**Class:** Evidence index.
**Authority:** The source for **where** dated proof artifacts live and **what date/point-in-time** they represent. It is a map to evidence, not a verdict.
**Not Authoritative For:** current release/deployment status, go/no-go, blockers, run IDs, or signoff SHA (→ `RELEASE_STATUS.md`); quality targets and the evidence taxonomy (→ `QUALITY.md`); STT baselines/accuracy/latency (→ `STT.md`); tier/entitlement mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); open gaps and broad-launch gates (→ `ROADMAP.md`); tester copy (→ `TESTER_GUIDE.md`); tester run/audit procedures (→ `TESTER_OPERATIONS.md`).
**Supersedes:** the ad-hoc "current truth source" framing of `evidence/README.md`; dated closeout, public-launch and entitlement records are retained below as evidence, not current posture.
**Evidence Sources:** the `product_release/evidence/` tree itself; `evidence/retained/attribution-sanitation-crosswalk.md` for pre-2026-07-15 SHA provenance.

# SpeakSharp Evidence Index

## Strategy and documentation reconciliation

| Evidence | What it establishes | Current authority |
|---|---|---|
| [`evidence/CODEBASE_VS_STRATEGY_2026-08-29.md`](./evidence/CODEBASE_VS_STRATEGY_2026-08-29.md) | Code-verified reconciliation of the two SpeakSharp strategy drafts: privacy boundary, newest-two transcript retention, Progress/attempt/outcome implementation, score-retirement residue, Focus Points, waitlist reachability, competitive advantage and moat evidence. | `PRODUCT_REQUIREMENTS.md`, `PROGRESS_AND_NEXT_ACTION.md`, `ARCHITECTURE.md`, `STT.md` |

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
| `evidence/retained/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | Dated entitlement audit: former Pro cap reconciliation, AI-quota verification and fail-closed guard checks. | `ENTITLEMENTS_AND_BILLING.md` (requirement) + `ROADMAP.md` (open ops) |
| `product_release/SCA_EXCEPTIONS.md` — pinned-audit execution result (2026-07-15) | Dated SCA pinned-audit result + the single ignored advisory rationale. | `OPERATIONS_AND_SECURITY.md` |
| `evidence/retained/RELEASE_CLOSEOUT_LEDGER.md` — dated proof rows (§B doc-gap closures, §E DB-hygiene closeout) | Dated documentation-gap and DB-hygiene closeout records. | `ROADMAP.md` (open) + this index (dated) |
| Manual hardware evidence logs (captured per the `TESTER_OPERATIONS.md` run; e.g. dated Chrome physical-mic proof) | Real-device Native/Private hardware run logs (browser/version, spoken sentence, stop/save/history/analytics). | `QUALITY.md` (protocol) + `TESTER_OPERATIONS.md` (run) |

---

## 8. Exploratory reference (`v4_work/`)

`product_release/v4_work/**` holds v4 hard-off exploration material. It is **EVIDENCE_ONLY / retained reference**, not a release path — v4 remains OFF (see `TESTER_OPERATIONS.md` §7 and `STT.md`). Indexed here as reference, never as current posture.

---

*Historical evidence index. It records where dated proofs live and when they were captured; it never states current release status — that lives only in `RELEASE_STATUS.md`.*

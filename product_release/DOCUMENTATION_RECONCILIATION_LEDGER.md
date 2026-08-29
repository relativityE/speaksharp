**Status:** Authoritative (SSOT for documentation classification and routing) — **not** a canonical document
**Owner:** Product Owner (relativityE); per-zone accountable role in each section header
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-08-29 (file set enumerated from `git ls-files '*.md'` at this commit; code claims verified by read-only grep against the working tree)
**Applies To:** Every tracked Markdown file in the repository outside `archive/` trees.
**Class:** Procedure (reconciliation record).
**Authority:** Classification, staleness exposure, correction status, and canonical routing for each non-archive Markdown file.
**Not Authoritative For:** current product policy, release posture, or GO/HOLD gates — those remain with the canonical set and `RELEASE_STATUS.md`.
**Supersedes:** — (complements `DOC_MIGRATION_LEDGER.md`, which is historical and covers only the `product_release/` consolidation)
**Evidence Sources:** `git ls-files`, each file's own declared metadata block, and the code paths cited in §10.

# Documentation Reconciliation Ledger (#1367)

Complete, non-sampling reconciliation of the repository's Markdown surface. Every tracked `*.md` file outside an
`archive/` tree appears exactly once below (97 = the 96 files present before this reconciliation, plus this ledger). The ledger exists because a documentation set this large drifts silently:
a file with no declared owner and no banner reads as current no matter how old it is.

> **This ledger does not create a fifteenth canonical document.** It is a procedure record, like
> `DOC_MIGRATION_LEDGER.md`. Canonical authority stays with the set enumerated in
> [`README.md`](./README.md) §2 and the precedence hierarchy in [`PRECEDENCE.md`](./PRECEDENCE.md).
>
> **Historical documents are not rewritten to look current.** Where a file's content is a frozen snapshot, the
> correction is a banner plus a pointer to current authority — never an edit that silently updates its findings.

---

## 1. Scope and count reconciliation

| Measure | Count | Command |
|---|---:|---|
| Tracked `*.md`, whole repository | 123 | `git ls-files '*.md' \| wc -l` |
| Of those, inside an `archive/` tree (out of scope) | 26 | `git ls-files '*.md' \| grep -iE '(^\|/)(archive\|archived\|_archive)/' \| wc -l` |
| **In scope — tracked, non-archive** | **97** | `git ls-files '*.md' \| grep -viE '(^\|/)(archive\|archived\|_archive)/' \| wc -l` |
| Rows in this ledger (§3–§9) | **97** | see `tests/config/documentationLedger.test.ts` |
| **Unclassified** | **0** | asserted structurally, not by inspection |

The ledger row count and the repository scan are asserted equal by
[`tests/config/documentationLedger.test.ts`](../tests/config/documentationLedger.test.ts). A new Markdown file that
is not added here fails that test. This is the only mechanism that keeps the count honest — a hand-maintained list
silently drifts on the first unlisted file.

**In-scope distribution:** `product_release/` 70 · `docs/` 6 · `tests/` 5 · repository root 4 · `.agent/` 4 ·
`.github/` 2 · `backend/` 2 · `ops-health/`, `research/`, `scripts/`, `video-production/` 1 each.

---

## 2. Legend

**Class** — what the file *is*:

| Code | Meaning |
|---|---|
| `CANON` | One of the 14 Product Owner-approved canonical documents (`README.md` §2). |
| `PROC` | Procedure / runbook. Operationally live; not a canonical contract. |
| `STAGING` | `*.operational.md` — a pre-consolidation staging copy, superseded by a canonical target. |
| `EVIDENCE` | Frozen evidence snapshot. True as of its date; never updated in place. |
| `WORKITEM` | Transient per-issue working document; archived at issue closeout. |
| `AGENT` | Agent/CI protocol consumed by automation or by an agent at session start. |
| `DEVREF` | Developer reference for a subsystem; owned by the code it describes. |
| `LEGACY` | Superseded duplicate retained for provenance only. |

**Correction status** — what this reconciliation did:

| Code | Meaning |
|---|---|
| `CURRENT` | Verified current at this commit; no change required. |
| `BANNERED` | Carries a status banner + pointer to current authority (added by #1367 D2 or earlier). |
| `NEEDS-OWNER` | Content is live but declares no owner; owner assignment is an open action. |
| `ROUTED` | Superseded; a pointer to current authority is present. |
| `GAP` | A declared obligation this file cannot satisfy; recorded in §11. |

**Stale-prone facts** — the classes of claim that rot. Measured, not estimated: `sha` = short-SHA-shaped tokens,
`wer` = WER/accuracy claims, `gate` = GO/HOLD or blocker language, `run` = CI run references, `$` = price claims,
`priv` = privacy-boundary claims. A dash means none of these classes appear.

---

## 3. Zone A — the canonical set (`product_release/`)

**Accountable:** Product Owner. These carry the full ten-field metadata block enforced by
`tests/config/documentationContract.test.ts`.

| File | Authority / Owner | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|---|
| `product_release/README.md` | Documentation portal · PO | CANON 1 | sha·gate | CURRENT — portal now links this ledger | self (portal) |
| `product_release/PRODUCT_REQUIREMENTS.md` | User-visible product contract · PO | CANON 2 | priv·$ | CURRENT — strategy table + privacy-boundary split added by #1367 | self |
| `product_release/ARCHITECTURE.md` | System invariants · Engineering | CANON 4 | priv·run | CURRENT — audio-boundary claim verified against code (§10.1) | self |
| `product_release/STT.md` | STT runtime/data contract · Eng + PO | CANON 5 | wer·priv | CURRENT | self |
| `product_release/PROGRESS_AND_NEXT_ACTION.md` | Personal-progress semantics · PO | CANON 6 | wer·run | CURRENT — Personal Progress confirmed shipped (§10.2) | self |
| `product_release/ENTITLEMENTS_AND_BILLING.md` | Entitlement/billing policy · PO | CANON 7 | $·gate | CURRENT — four billing states separated (§10.9) | self |
| `product_release/QUALITY.md` | Quality SLOs · Eng/Quality | CANON 8 | wer·gate·run | CURRENT | self |
| `product_release/RELEASE_PROCESS.md` | Release procedure · Eng/Quality | CANON 9 | gate·run·$ | CURRENT | self |
| `product_release/RELEASE_STATUS.md` | Release posture SSOT · PO | CANON 10 | sha·gate·run | CURRENT — the only file permitted to carry changing SHAs/run IDs | self |
| `product_release/OPERATIONS_AND_SECURITY.md` | Env/secret/ops procedure · Ops/Sec | CANON 11 | gate·run·$ | CURRENT | self |
| `product_release/TESTER_GUIDE.md` | External tester copy · PO | CANON 12 | gate·$ | CURRENT | self |
| `product_release/TESTER_OPERATIONS.md` | Internal tester procedure · Prod-Ops/Quality | CANON 13 | $ | CURRENT | self |
| `product_release/EVIDENCE_INDEX.md` | Evidence index · Prod-Ops/Quality | CANON 14 | wer·gate·run | CURRENT | self |

**Canonical #3 `ROADMAP.md` does not exist.** See §11 GAP-1. Thirteen of the fourteen declared canonical
documents are present.

---

## 4. Zone B — `product_release/` operational, staging and superseded

**Accountable:** per-file owner where declared; `NEEDS-OWNER` marks the files that declare none.

| File | Authority / Owner | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|---|
| `product_release/DOCUMENTATION_RECONCILIATION_LEDGER.md` | This file · PO | PROC | — | CURRENT | self |
| `product_release/ACTIVE_COORDINATION.md` | Live coordination · PO (relativityE) | PROC | sha(14)·gate | CURRENT — currentized to `main@0e2fffd1` | → `RELEASE_STATUS.md` for posture |
| `product_release/PRECEDENCE.md` | Precedence hierarchy | PROC | gate | NEEDS-OWNER — owner `[unassigned]`, reviewed 2026-05-26 | self (contract, not status) |
| `product_release/DOC_MIGRATION_LEDGER.md` | Migration record · PO | PROC | sha(12)·wer·gate | BANNERED — "Historical — superseded" | → `README.md` §2, this ledger |
| `product_release/CODEBASE_MAP.md` | Repo orientation | PROC | sha·gate | BANNERED | → `ARCHITECTURE.md` |
| `product_release/BACKLOG.md` | Deferred work | PROC | wer·$ | BANNERED — see §10 for items wrongly listed unbuilt | → open GitHub issues |
| `product_release/RC_GATES.md` | RC gate definitions | PROC | wer·gate(17) | BANNERED | → `rc-gates.yml` on main; `RELEASE_STATUS.md` |
| `product_release/RC_TEST_INVENTORY.md` | RC test inventory | PROC | wer(11)·gate(136) | BANNERED | → `QUALITY.md`, `EVIDENCE_INDEX.md` |
| `product_release/QUALITY_METRICS.md` | Metric definitions | PROC | gate | BANNERED | → `QUALITY.md` |
| `product_release/RELEASE_CLOSEOUT_LEDGER.md` | Closeout record | EVIDENCE | sha(23)·gate | BANNERED | → `RELEASE_STATUS.md` |
| `product_release/PUBLIC_LAUNCH_LEDGER.md` | Launch evidence | EVIDENCE | sha(15)·gate·$ | BANNERED | → `EVIDENCE_INDEX.md` |
| `product_release/RELEASE_RECOVERY.md` | Recovery runbook · relativityE | PROC | ver·gate | CURRENT | → `RELEASE_PROCESS.md` |
| `product_release/LAUNCH_ENV_CHECKLIST.md` | Env checklist · relativityE | PROC | gate·$·run | BANNERED | → `OPERATIONS_AND_SECURITY.md` |
| `product_release/ENV_INVENTORY.md` | Env variable inventory · relativityE | PROC | sha·wer·gate | CURRENT | → `OPERATIONS_AND_SECURITY.md` |
| `product_release/SECRET_ROTATION_RUNBOOK.md` | Secret rotation | PROC | wer | NEEDS-OWNER | → `OPERATIONS_AND_SECURITY.md` |
| `product_release/SECRETS_ATTACK_SURFACE_AUDIT.md` | Secret attack surface | EVIDENCE | wer·run | NEEDS-OWNER | → `OPERATIONS_AND_SECURITY.md` |
| `product_release/PAID_OPS_HARDENING_RUNBOOK.md` | Paid activation runbook | PROC | — | NEEDS-OWNER | → `ENTITLEMENTS_AND_BILLING.md` |
| `product_release/SCA_EXCEPTIONS.md` | Dependency exceptions · relativityE | PROC | sha | CURRENT | → `QUALITY.md` |
| `product_release/OPS_HEALTH_DASHBOARD.md` | Ops dashboard | PROC | wer·run | NEEDS-OWNER | → `OPERATIONS_AND_SECURITY.md` |
| `product_release/INTERNAL_TEST_PROTOCOL.md` | Internal test protocol | PROC | run·gate·priv | BANNERED | → `TESTER_OPERATIONS.md` |
| `product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | Tester-facing copy | PROC | wer·gate | BANNERED | → `TESTER_GUIDE.md` |
| `product_release/MANUAL_HARDWARE_VALIDATION.md` | Device validation | PROC | ver·gate·run | BANNERED | → `TESTER_OPERATIONS.md` |
| `product_release/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | Pro-limit evidence | EVIDENCE | wer·gate | BANNERED | → `ENTITLEMENTS_AND_BILLING.md` |
| `product_release/PRIVATE_STT_ACCURACY_LEVERS.md` | Accuracy proposals | PROC (proposal) | sha·wer·gate | NEEDS-OWNER — status "proposed"; hypotheses, not results | → `STT.md`, #1304 |
| `product_release/stt-perf-proof-protocol.md` | Perf proof protocol | PROC | wer(11) | NEEDS-OWNER | → `STT.md`, #1304 harness |
| `product_release/attribution-sanitation-crosswalk.md` | Attribution crosswalk | PROC | sha·wer·ver(15) | NEEDS-OWNER | → `STT.md` |
| `product_release/content_list.md` | Content inventory | PROC | sha·gate·run | NEEDS-OWNER | → `README.md` |
| `product_release/ARCHITECTURE.operational.md` | Pre-consolidation copy | STAGING | wer·gate·run | ROUTED | → `ARCHITECTURE.md` |
| `product_release/PRD.operational.md` | Pre-consolidation copy | STAGING | wer·ver·gate | ROUTED | → `PRODUCT_REQUIREMENTS.md` |
| `product_release/ROADMAP.operational.md` | Pre-consolidation copy | STAGING | wer·gate·$ | **STALE ROUTING** — points to #1272, which closed without producing `ROADMAP.md` | → GAP-1; live successor #1257 |
| `product_release/PRODUCT_FEATURES.operational.md` | Pre-consolidation copy | STAGING | wer(9)·priv(4) | ROUTED — feature statuses re-verified in §10 | → `PRODUCT_REQUIREMENTS.md` |
| `product_release/SPEAKSHARP_SESSION_PROGRESS.operational.md` | Session-progress copy | STAGING | wer(11) | ROUTED | → `PROGRESS_AND_NEXT_ACTION.md` |
| `product_release/STT_BASELINE_CONTRACTS.operational.md` | STT baselines | STAGING | wer(65)·ver | ROUTED — highest WER-claim density in the tree; superseded by #1304 | → `STT.md`, #1304 |
| `product_release/SOFTWARE_QUALITY.operational.md` | Quality copy | STAGING | wer·gate·run | ROUTED | → `QUALITY.md` |
| `product_release/SERVICE_LEVELS.operational.md` | SLO copy | STAGING | wer·ver·run | ROUTED | → `QUALITY.md` |

---

## 5. Zone C — `product_release/evidence/` (frozen snapshots)

**Accountable:** Product-Ops/Quality. **Rule:** original measurements are never rewritten. Each file carries a
banner naming its date and current authority; the numbers below it stay exactly as measured.

| File | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|
| `product_release/evidence/README.md` | EVIDENCE (index) | wer·gate | BANNERED | → `EVIDENCE_INDEX.md` |
| `product_release/evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md` | EVIDENCE | sha(13)·ver(7)·gate(10) | BANNERED (#1367 D2) | → `RELEASE_STATUS.md` |
| `product_release/evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md` | EVIDENCE | — | CURRENT | → `PROGRESS_AND_NEXT_ACTION.md` |
| `product_release/evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md` | EVIDENCE | sha·wer·gate | BANNERED (#1367 D2) | → `RELEASE_STATUS.md` |
| `product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md` | EVIDENCE | gate | BANNERED (#1367 D2) | → `STT.md`, #1304 |
| `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md` | EVIDENCE | sha·wer·gate·priv | BANNERED (#1367 D2) | → #1304 certified harness |
| `product_release/evidence/beta50_2026-07-09/README.md` | EVIDENCE | ver·gate | BANNERED (#1367 D2) | → `EVIDENCE_INDEX.md` |
| `product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` | EVIDENCE | sha·gate | BANNERED (#1367 D2) | → `RELEASE_STATUS.md` |
| `product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md` | EVIDENCE | sha | BANNERED (#1367 D2) | → `STT.md` |
| `product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md` | EVIDENCE | sha(57)·wer(37)·gate | BANNERED (#1367 D2) — superseded by the #1304 certified harness | → #1304 |
| `product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md` | EVIDENCE | sha·wer·gate | BANNERED (#1367 D2) | → #1304 |
| `product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md` | EVIDENCE | sha(7) | BANNERED (#1367 D2) — "Native" is a retired engine name | → `STT.md` |
| `product_release/evidence/test_reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md` | EVIDENCE | wer·gate | BANNERED (#1367 D2) | → #1304 |

---

## 6. Zone D — work items and v4 investigation

**Accountable:** Engineering. Transient by construction; archived at issue closeout.

| File | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|
| `product_release/work_items/P0_PRIVATE_STT_FINDINGS.md` | WORKITEM | wer | NEEDS-OWNER | → #1304 |
| `product_release/work_items/1314-atomic-rpc-evidence-packet.md` | WORKITEM | — | BANNERED | → #1314 |
| `product_release/work_items/1314-correction-design.md` | WORKITEM | wer | BANNERED | → #1314 |
| `product_release/work_items/1314-migration-apply-packet.md` | WORKITEM | sha·wer·run | NEEDS-OWNER | → #1314, `OPERATIONS_AND_SECURITY.md` |
| `product_release/v4_work/V4_RECOVERY.md` | WORKITEM | sha(9)·wer | BANNERED | → `STT.md` |
| `product_release/v4_work/V4_APP_PATH_PROOF_RUNBOOK.md` | WORKITEM | wer | NEEDS-OWNER | → `STT.md` |
| `product_release/v4_work/V4_COMPLETE_TEST_RUNBOOK.md` | WORKITEM | sha·wer·gate(11) | NEEDS-OWNER | → `STT.md` |
| `product_release/v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md` | WORKITEM | wer | NEEDS-OWNER | → #1304 |
| `product_release/v4_work/V4_POSTHOG_READINESS_PROOF.md` | WORKITEM | wer·gate | NEEDS-OWNER | → `STT.md` |

---

## 7. Zone E — repository root and agent/CI protocol

**Accountable:** Engineering (agent protocol), Product Owner (user-facing copy).

| File | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|
| `README.md` | DEVREF | wer·ver(5)·gate·$ | NEEDS-OWNER — reviewed 2026-05-06, the oldest review date on a live root file | → `product_release/README.md` |
| `AGENTS.md` | AGENT | wer·gate·run | CURRENT — agent-starting SSOT, currentized by #1367 | self |
| `USER_GUIDE.md` | Product copy (external) | wer·priv·$ | CURRENT — privacy wording verified against code (§10.1) | → `TESTER_GUIDE.md` |
| `EXECUTIVE_SUMMARY.md` | Product copy | — | NEEDS-OWNER | → `PRODUCT_REQUIREMENTS.md` |
| `.agent/workflows/canary-tests.md` | AGENT | run | CURRENT | → `RELEASE_PROCESS.md` |
| `.agent/workflows/coding-standards.md` | AGENT | wer·priv | CURRENT | → `QUALITY.md` |
| `.agent/workflows/pr-merge-workflow.md` | AGENT | wer·gate·run | CURRENT | → `RELEASE_PROCESS.md` |
| `.agent/workflows/skills/code-review/SKILL.md` | AGENT | — | CURRENT | → `QUALITY.md` |
| `.github/runbooks/PAID_CANARY_CUTOVER.md` | PROC | $ | NEEDS-OWNER | → `ENTITLEMENTS_AND_BILLING.md` |
| `.github/runbooks/flawless-launch-contract-audit.md` | PROC | $(8) | NEEDS-OWNER | → `RELEASE_PROCESS.md` |

---

## 8. Zone F — `docs/` legacy tree

**Accountable:** Engineering. Superseded duplicates of canonical names, all last touched 2026-05-26. Retained for
provenance; they must never be cited as current.

| File | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|
| `docs/README.md` | LEGACY | — | ROUTED | → `product_release/README.md` |
| `docs/ARCHITECTURE.md` | LEGACY | — | BANNERED | → `product_release/ARCHITECTURE.md` |
| `docs/PRD.md` | LEGACY | — | BANNERED | → `product_release/PRODUCT_REQUIREMENTS.md` |
| `docs/ROADMAP.md` | LEGACY | — | BANNERED | → GAP-1 (no canonical successor yet) |
| `docs/CHANGELOG.md` | LEGACY | — | BANNERED | → git history, `RELEASE_STATUS.md` |
| `docs/OUTLINE.md` | LEGACY | wer·gate·run | NEEDS-OWNER — no banner despite 2026-05-26 review | → `ARCHITECTURE.md` |

---

## 9. Zone G — subsystem reference

**Accountable:** the owning subsystem. These describe code and are corrected by changing the code they describe.

| File | Class | Stale-prone facts | Correction status | Canonical routing |
|---|---|---|---|---|
| `tests/README.md` | DEVREF | — | CURRENT | → `QUALITY.md` |
| `tests/TESTING.md` | DEVREF | — | CURRENT | → `QUALITY.md` |
| `tests/TEST_PLAYBOOK.md` | DEVREF | wer·run·priv | CURRENT | → `QUALITY.md` |
| `tests/CODEBASE_FIX_APPROACH.md` | DEVREF | — | NEEDS-OWNER | → `QUALITY.md` |
| `tests/soak/README.md` | DEVREF | — | CURRENT | → `QUALITY.md` |
| `backend/supabase/edge-functions.md` | DEVREF | — | CURRENT | → `ARCHITECTURE.md` |
| `backend/supabase/howto-remote-supabase-deploy.md` | DEVREF | run·priv | NEEDS-OWNER | → `OPERATIONS_AND_SECURITY.md` |
| `scripts/FILLER_KNOWN_SCRIPT_RUNBOOK.md` | DEVREF | wer | NEEDS-OWNER | → `STT.md` |
| `ops-health/ops-health.md` | DEVREF | — | NEEDS-OWNER | → `OPERATIONS_AND_SECURITY.md` |
| `research/pricing_analysis.md` | EVIDENCE (research) | wer·$(70) | NEEDS-OWNER — competitor prices undated; see §10.9 | → `ENTITLEMENTS_AND_BILLING.md` |
| `video-production/README.md` | DEVREF | priv | NEEDS-OWNER | → `PRODUCT_REQUIREMENTS.md` |

---

## 10. Claim-by-claim product-evaluation audit

Two prior evaluations (a Consultant version, **v1**, and a Product Manager version, **v2**) reached different
conclusions about what SpeakSharp has built and what defends it. This section audits both against the code on
`main` at this commit. **Neither evaluation is source material to copy** — each claim is re-derived.

**Verdict vocabulary:** `confirmed` · `partially true` · `refuted` · `stale`.

> **Provenance limit.** The v1 and v2 documents are not tracked in this repository and their verbatim text is not
> recoverable here. Positions are quoted below **only where the #1367 return quotes them verbatim**; every other
> cell is marked *not recoverable verbatim* rather than paraphrased into a position neither author took.

> **Evidence standard.** A file's existence, a passing test, or an unused import is **not** proof that a capability
> ships. Each verdict below names the production entry point, the render/call chain, the flag/entitlement state,
> the persistence and network boundary, and user reachability.

### 10.1 Privacy boundary

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Audio transcription occurs locally — `confirmed`.** | *not recoverable verbatim* | *not recoverable verbatim* |
| **Transcript text is transmitted for server-side suggestions — `confirmed`.** | *not recoverable verbatim* | *not recoverable verbatim* |
| **Transcript text is persisted server-side — `confirmed`, bounded.** | *not recoverable verbatim* | *not recoverable verbatim* |
| **Derived metrics are persisted — `confirmed`.** | *not recoverable verbatim* | *not recoverable verbatim* |

These are four separate claims and the documentation must never collapse them. **"Transcript never reaches a
server" and "transcript is never stored" are different claims, and both are false as written.**

- **Entry point / chain:** `/session` (`App.tsx:399`, protected) → `SessionPage.tsx` → `SpeechRuntimeController`.
  Transcription runs in a same-origin Transformers.js worker
  (`services/transcription/engines/transformers-js.worker.ts`).
- **Audio boundary:** raw audio is not uploaded. `ARCHITECTURE.md:65,135` states this and the code supports it —
  no upload path for audio exists on the Private route.
- **Transcript boundary — write:** `lib/storage.ts:455` calls `complete_session_v2` with
  `p_final_transcript: transcriptArg`. `storage.ts:449` normalizes it: a `failed`/discarded session sends `null`;
  a `completed` session sends the text. **Transcript text therefore leaves the device on save.**
- **Transcript boundary — persistence:** `sessions.transcript TEXT`
  (`20251219000000_sync_contract.sql:3`) with `transcript_state`
  (`20260801000000_sessions_transcript_state.sql:30`). Retention is bounded to the two newest saved sessions
  (`20260819120000_complete_session_v2_atomic_retention_1314.sql`), not indefinite.
- **Transcript boundary — third party:** `backend/supabase/functions/get-ai-suggestions/index.ts:117` selects
  `transcript` from the saved row and `:224` embeds it in a prompt POSTed to
  `generativelanguage.googleapis.com` (`:5`, Gemini). **Transcript text reaches Google.**
- **Reachability / gating:** user-initiated only — `AISuggestions.tsx:132` `onClick`, disabled without a
  transcript and session id; the function refuses unless `transcript_state === 'available'` (`index.ts:140`).
  It is not a background call.
- **Canonical documentation:** already correct and unusually careful. `PRODUCT_REQUIREMENTS.md:116` requires copy
  to "distinguish on-device transcription from any later server processing over saved text"; `USER_GUIDE.md:37`
  says audio "is not sent to a transcription provider" — precise, because the *transcript* is.
- **Correction required:** none to the canonical wording. The four-way split above is added to
  `PRODUCT_REQUIREMENTS.md` so the distinction cannot be lost. Any future copy asserting a blanket
  "nothing leaves your device" is **refuted** by the two boundary crossings above.

### 10.2 Personal Progress

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Built, wired and user-reachable — `confirmed`.** | *not recoverable verbatim* | *not recoverable verbatim* |
| **Constitutes a moat — `refuted` (not established).** | *not recoverable verbatim* | "Do not call it a moat merely because it exists" |

- **Entry point / chain:** `/session` → `SessionPage.tsx:13,353` → `SessionOverhaulView` →
  `SessionBeforeState.tsx:44`, `SessionDuringState.tsx:125`, `SessionAfterState.tsx:73`, each rendering
  `<ProgressVsBaseline …>` in **slot C**. Values come from `utils/progressVsBaseline.ts`
  (`computeProgressVsBaseline`), whose comparability floor is re-exported from `utils/aggregateProgress.ts`.
- **Eligibility gates:** a session counts toward the baseline only when
  `durationSeconds >= MIN_COMPARABLE_SECONDS` (30s) **and** `compositeQuality(s) != null`
  (`aggregateProgress.ts:24,111`). Short or unscoreable sessions are excluded — so a new user sees the
  insufficient-evidence state, not a fabricated trend.
- **Flag/entitlement state:** no feature flag and no entitlement gate on the render path; it is present for any
  authenticated user reaching `/session`.
- **Persistence boundary:** derived from persisted per-session metrics, not from transcripts.
- **Correction required:** **every backlog or "unbuilt" assertion about Personal Progress must be removed.**
  It ships. Separately, the moat claim is not established: switching costs and retention effects are
  **unproven** — no repository evidence of either.

### 10.3 Universal score retirement

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Retired from the rendered UI — `confirmed` (0 live consumers).** | "approximately 70% retired" | denominator required |
| **Fully removed from the codebase — `refuted` (3 live telemetry consumers).** | *not recoverable verbatim* | *not recoverable verbatim* |

**"Approximately 70% retired" is refuted for want of a denominator.** The denominator is the set of non-test
importers of `utils/speakingScore.ts`, which is **6**:

| Consumer | Category | Live in production? |
|---|---|---|
| `components/session/LiveCoachingScoreCard.tsx` | **Dead component** | **No** — no non-test file renders it |
| `components/session/SpeakingTipsCard.tsx` | **Dead component** | **No** — no non-test file renders it |
| `services/telemetry/processors/ScoreProcessor.ts` | **Shadow telemetry** | **Yes** — registered at `shadowMetricsEngine.ts:63` |
| `services/telemetry/fillerDivergence.ts` | **Shadow telemetry** | Yes |
| `services/telemetry/metricsParity.ts` | **Shadow telemetry** | Yes |
| `services/sessionCoachingExperiment.ts` | Type-only import | N/A (no value import) |
| `services/telemetry/contracts.ts` | Type-only import | N/A (no value import) |

- **Live UI consumers: 0.** The universal score is **fully retired from the user-visible surface** — a stronger
  result than "approximately 70%".
- **Shadow telemetry consumers: 3**, unconditional — `ScoreProcessor` is constructed directly in the processor
  array at `shadowMetricsEngine.ts:63` with no flag guard found on that path. The score is still **computed**.
- **Verified dead, not merely unimported.** Neither component is re-exported through a barrel (there is no
  `components/session/index.ts`) and neither is dynamically imported. The single remaining mention of
  `LiveCoachingScoreCard` outside its own file and its tests is a **comment** in `ScoreProcessor.ts:9`, which
  still describes it as "the live LiveCoachingScoreCard" — a stale comment that would tell the next reader the
  card renders. `SpeakingTipsCard` has no reference at all.
- **The 0–100 Clarity Score is a separate metric** (`clarity_score`, persisted, consumed by
  `AnalyticsDashboard.tsx` and `TrendChart.tsx`) and must not be conflated with the retired universal score.
- **Correction required:** replace any percentage with: *"retired from all rendered UI (0 live consumers);
  still computed in 3 shadow-telemetry paths; 2 dead components pending deletion."*

### 10.4 Advice → attempt → outcome

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Closing the loop is "one join away" — `refuted`.** | "one join away" | overstated; an instrumentation and attribution gap |

- **What exists:** `sessions.next_action_signal JSONB`
  (`20260816223606_metrics_only_additive_1306.sql:25`), written through `complete_session_v2`
  (`storage.ts:459` `p_next_action`), validated and rendered by `contracts/nextActionSignal.ts` and consumed at
  `AnalyticsDashboard.tsx:740`. **Prior-recommendation identity is therefore persisted** — that part of v1 holds.
- **What does not exist:** no attempt evidence (explicit or inferred), no comparable-session eligibility rule for
  outcome comparison, no target-specific outcome field, and no recorded attribution limits.
- **Why the join fails:** a query joining a stored recommendation to a later metric improvement establishes an
  **association only**. It cannot show the user saw the advice, attempted it, or that the advice caused the
  change. Session-to-session variation, regression to the mean, and self-selection are all unexcluded.
- **Correction required:** #1259 must be described as an **instrumentation and attribution gap** — requiring
  attempt capture, eligibility rules, target-specific outcomes and stated attribution limits — not as a database
  join. `next_action_signal` is a precondition, not the mechanism.

### 10.5 Executive Rehearsal

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Focus Point coverage ships — `confirmed`.** | *not recoverable verbatim* | neither "unwired" nor "fully shipped" is accurate |
| **A complete rehearsal experience ships — `refuted`.** | *not recoverable verbatim* | *not recoverable verbatim* |

- **Shipped:** `SessionOverhaulView.tsx:17` imports `FocusPointsRail`; the view derives live and final per-point
  coverage (`:105-106`), backed by `utils/focusCoverage.ts`, `components/session/CoverageRail.tsx` and
  `stores/useSessionStore.ts`. The after-state renders a coverage card and delivery strip (`:98`). Entry is
  `/session` with a points plan bound via `ObjectiveSetupDialog`.
- **Not shipped:** there is no assembled end-to-end "Executive Rehearsal" product experience above these parts.
- **Correction required:** document the shipped Focus Point coverage loop and the unshipped rehearsal
  experience as two distinct statuses. Both "unwired" and "fully shipped" are wrong.

### 10.6 Pro-interest capture

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **A reachable user-facing interest-capture journey — `refuted`.** | *not recoverable verbatim* | backend + migration + tests ≠ shipped |

- **Searched:** no `pro_interest` / `proInterest` object exists anywhere under `backend/`, and the only frontend
  match for "interest" outside tests is `content/faqSections.ts` (FAQ copy).
- **Nearest real capability:** the `guided-waitlist` edge function exists, but the only non-test frontend
  reference is a **comment** in `components/practice/ObjectiveSetupDialog.tsx:10`; the dialog's form calls
  `onReady` and routes into the session — no waitlist submission is issued from it.
- **Verdict:** **no reachable frontend action and no complete submission journey.** Any claim that Pro-interest
  capture ships is refuted.
- **Correction required:** record as unbuilt on the frontend; if a backend surface is intended, the gap is the
  reachable action and the submission journey.

### 10.7 Filler counting

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Competitive parity, unqualified on annotated disfluent human speech — `confirmed`.** | *not recoverable verbatim* | parity and product quality, not moat |

- Filler counting is a product-quality capability. The live count is canonical
  (`liveFillerDataAtStop`); the persistence boundary validates approved keys and fails closed
  (`storage.ts:440-447`).
- **It has not been qualified on annotated disfluent human speech.** The #1304 corpus is read LibriSpeech, and
  Track A removes fillers by construction; the seeded-filler check was a tiny-model diagnostic, not an F1
  measurement.
- **Correction required:** describe as parity and quality, explicitly unqualified on annotated disfluent speech.
  It is not part of any moat claim.

### 10.8 Compliance evidence

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Trust/sales collateral and demonstrated execution capability — `confirmed`.** | *not recoverable verbatim* | not, by itself, a durable moat |
| **"44 pins" — `stale`.** | "44 pins" | remove; the pin structure has expanded |

- The evidence discipline (pinned corpora, certified harness, counted backend evidence) is real and is a
  credible trust and sales asset. It is **not** a moat: it is reproducible by any competent team.
- **The "44 pins" figure is stale and must be removed, not re-stated as a new hand-counted number.** The current
  structure spans at least `tests/fixtures/moonshine-asset-pins.json` (14 asset pins) and the separately pinned
  ORT runtime binaries in `tests/evidence/certification/arms/runtimeAssets.ts`. Cite the fixtures; do not
  hard-code a total that will rot the same way.

### 10.9 Billing and pricing

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **Four distinct states, not one — `confirmed` as a required distinction.** | *not recoverable verbatim* | separate the four |

| State | Status |
|---|---|
| Contracted pricing | Defined in `ENTITLEMENTS_AND_BILLING.md` |
| Implemented Stripe components | Built; checkout→webhook→billing-portal journey proven in **test mode** |
| Activation qualification | **Not activated** — requires both payment switches on, aligned live configuration, and separate written owner authorization |
| Actual revenue | **None** — a standing billing freeze forbids live charges in testing |

- **Competitor pricing must be dated and reverified.** `research/pricing_analysis.md` carries ~70 price tokens
  with no visible as-of date and no authoritative source citation; it is marked `NEEDS-OWNER` in §9 and must not
  be quoted as current without reverification.

### 10.10 User validation

| Capability and current-code verdict | v1 position | v2 position |
|---|---|---|
| **No demonstrated willingness to pay, conversion, retention, or CAC advantage — `confirmed`.** | *not recoverable verbatim* | preserve this limitation prominently |

There is **no user research in this repository**: no willingness-to-pay study, no conversion or retention
comparison, no CAC measurement, and no cohort analysis. With zero revenue (§10.9) none of these could have been
measured. Every economic advantage in the strategy table is therefore a **hypothesis**, and this limitation is
carried prominently into `PRODUCT_REQUIREMENTS.md` rather than buried here.

---

## 11. Gaps

**GAP-1 — canonical #3 `ROADMAP.md` does not exist, and the deferral that was supposed to create it has
already closed.** `README.md` §2 and `tests/config/documentationContract.test.ts:35` both declare a
fourteen-document canonical set, but `product_release/ROADMAP.md` is absent; only the superseded
`ROADMAP.operational.md` and the legacy `docs/ROADMAP.md` exist.

`ROADMAP.operational.md` routes the canonical roadmap to **#1272** — but **#1272 is CLOSED** and no
`ROADMAP.md` was produced. The deferral lapsed without anyone noticing, which is precisely the failure this
ledger exists to make impossible: nothing enforced the declared set, and no test asserted that it matched the
files present. The live successor is **#1257** (open — "rebuild the canonical ledger, requirements, roadmap, and
backlog from current main"), with **#1318** as the final currentization. **13 of 14 canonical documents exist.**

This ledger does **not** invent a canonical roadmap to close the gap: doing so would create a canonical document
outside the #1257 decision. `tests/config/documentationLedger.test.ts` now asserts the canonical set is present
**with GAP-1 as the single registered exception**, so the deferral is explicit and any *further* drift fails.
Propagation content that would have gone to `ROADMAP.md` is routed to `PROGRESS_AND_NEXT_ACTION.md` and
`RELEASE_STATUS.md` until #1257 lands.

**GAP-2 — 26 live files declare no owner.** Every `NEEDS-OWNER` row above. Owner assignment is a Product Owner
action; this ledger records the exposure rather than assigning owners unilaterally.

---

## 12. Strategic conclusion

Recorded here and propagated to `PRODUCT_REQUIREMENTS.md`. Nothing below reorders the PO-approved MVP sequence —
**strategic importance and current release order are separate decisions.**

| Dimension | Assessment | Basis |
|---|---|---|
| **Differentiator** | Precise on-device transcription and a focused private-practice loop. | On-device transcription verified (§10.1); the practice loop — Focus Point coverage + Personal Progress — verified shipped and reachable (§10.2, §10.5). |
| **Value proposition** | Clear, but **not validated with users**. | No user research exists (§10.10). |
| **Competitive advantage** | Plausible trust and serving-cost advantages; **not demonstrated economics**. | Trust follows from the audio boundary (§10.1); serving cost is lower, not zero — server-side coaching calls a paid model per request (§10.1). No unit economics measured (§10.9, §10.10). |
| **Moat** | **None proven today.** Longitudinal, consented coaching-outcome evidence is the strongest path. | Personal Progress exists but switching costs and retention are unproven (§10.2); the advice→outcome loop is an attribution gap, not a join (§10.4); compliance evidence is reproducible (§10.8); filler counting is parity (§10.7). |
| **Alpha** | Not applicable in the public-market sense; the underlying market thesis remains **untested**. | No market or user validation in-repo (§10.10). |

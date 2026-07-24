**Owner:** Prod Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Class:** Procedure (migration record)
**Authority:** Source-by-source inventory and disposition for the documentation-canonicalization effort. Companion to [`README.md`](./README.md).

# Documentation Migration Ledger

This ledger inventories **every** documentation source in `product_release/` (plus the pinned historical `docs/*` sources) and records, for each: its **classification**, its **target** canonical document, its **disposition**, and its **owner**. Taxonomies are defined in [`README.md`](./README.md) §3–§4.

> **This PR performs no consolidation.** Every row's disposition describes the *planned* migration, executed by later single-topic reconciliation PRs (one at a time). This PR only adds the portal, this ledger, and pinned historical copies — it deletes/moves/rewrites nothing active and changes no code.

**Current baseline (from `RELEASE_STATUS.md`, SSOT):** deployed `main` HEAD `05643fbd` (2026-07-24); last product-behavior change `c25b2178` (#1024) atop `a37a6ba1` (#1027 stale-chunk P0) and `c99208b9` (#1022 `/practice` default). Commits #1028–#1030 are read-only audit tooling. The frozen `v0.9.0-rc4` tag (`df909805`) is historical, not the baseline.

---

## 1. Active root documents (33)

| Source (`product_release/`) | Class | Target canonical | Disposition | Owner |
|---|---|---|---|---|
| `RELEASE_STATUS.md` | Runtime fact | (2) RELEASE_STATUS | EXTRACTED — remains the SSOT verbatim | Prod Owner |
| `PRECEDENCE.md` | Procedure | (3) PRECEDENCE | EXTRACTED — remains canonical | Prod Owner |
| `content_list.md` | Procedure | (1) README (portal) | SUPERSEDED — replaced by this portal | Prod Owner |
| `PRD.operational.md` | Product requirement | (4) PRD | EXTRACTED → PRD v1 (currently ⚠️ STALE, banner-marked; v0.6.19-rc0) | Prod Owner |
| `PRODUCT_FEATURES.operational.md` | Product requirement | (4) PRD | EXTRACTED — capability inventory folds into PRD v1 | Prod Owner |
| `SPEAKSHARP_SESSION_PROGRESS.operational.md` | Product requirement | (4) PRD | EXTRACTED — Session Progress contract (Part A direction / Part B legacy score) folds into PRD v1 | Prod Owner |
| `ARCHITECTURE.operational.md` | Architecture invariant | (5) ARCHITECTURE | EXTRACTED — becomes canonical ARCHITECTURE + ADRs | Prod Owner |
| `CODEBASE_MAP.md` | Architecture invariant | (6) CODEBASE_MAP | EXTRACTED — remains canonical breadcrumb | Prod Owner |
| `STT_BASELINE_CONTRACTS.operational.md` | Acceptance criterion / SLO | (7) STT_CONTRACTS | EXTRACTED — core of canonical STT contracts | Prod Owner |
| `PRIVATE_STT_ACCURACY_LEVERS.md` | Acceptance criterion / SLO | (7) STT_CONTRACTS | EXTRACTED — accuracy-levers reference folds in | Prod Owner |
| `stt-perf-proof-protocol.md` | Acceptance criterion / SLO | (7) STT_CONTRACTS | EXTRACTED — perf-proof protocol folds in | Prod Owner |
| `SERVICE_LEVELS.operational.md` | Acceptance criterion / SLO | (8) SERVICE_LEVELS | EXTRACTED — remains canonical SLO doc | Prod Owner |
| `SOFTWARE_QUALITY.operational.md` | Procedure / evidence | (9) SOFTWARE_QUALITY | EXTRACTED — quality-evidence policy | Prod Owner |
| `QUALITY_METRICS.md` | Evidence | (9) SOFTWARE_QUALITY | EXTRACTED — digest folds into SOFTWARE_QUALITY | Prod Owner |
| `RC_GATES.md` | Acceptance criterion | (10) RC_GATES | EXTRACTED — remains canonical gates doc | Prod Owner |
| `RC_TEST_INVENTORY.md` | Acceptance criterion | (10) RC_GATES | EXTRACTED — counted tests/workflows fold into RC_GATES | Prod Owner |
| `INTERNAL_TEST_PROTOCOL.md` | Procedure | (11) TEST_PROTOCOL | EXTRACTED — operator/dev acceptance protocol | Prod Owner |
| `MANUAL_HARDWARE_VALIDATION.md` | Procedure | (11) TEST_PROTOCOL | EXTRACTED — manual hardware/browser protocols fold in | Prod Owner |
| `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | Procedure | (12) TESTER_INSTRUCTIONS | EXTRACTED — tester-facing copy | Prod Owner |
| `LAUNCH_ENV_CHECKLIST.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — env checklist section | Prod Owner |
| `ENV_INVENTORY.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — env/secrets inventory section | Prod Owner |
| `SECRET_ROTATION_RUNBOOK.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — rotation section | Prod Owner |
| `PAID_OPS_HARDENING_RUNBOOK.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — paid-ops hardening section | Prod Owner |
| `RELEASE_RECOVERY.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — recovery section | Prod Owner |
| `OPS_HEALTH_DASHBOARD.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — vendor/tool health scope section | Prod Owner |
| `SCA_EXCEPTIONS.md` | Procedure | (13) OPS_RUNBOOK | EXTRACTED — dependency-scanner exceptions section | Prod Owner |
| `BACKLOG.md` | Open gap / risk | (14) BACKLOG | EXTRACTED — remains canonical backlog | Prod Owner |
| `ACTIVE_COORDINATION.md` | Open gap / risk | (14) BACKLOG | EXTRACTED — working-board subset folds into BACKLOG | Prod Owner |
| `ROADMAP.operational.md` | Superseded history | (14) BACKLOG | SUPERSEDED — ⚠️ STALE (v0.6.19-rc0, "12-hour launch window"); durable risks move to BACKLOG | Prod Owner |
| `RELEASE_CLOSEOUT_LEDGER.md` | Superseded history | (14) BACKLOG | SUPERSEDED — older closeout tracker; open items move to BACKLOG, rest archived | Prod Owner |
| `PUBLIC_LAUNCH_LEDGER.md` | Evidence | `evidence/` (retained) | EVIDENCE_ONLY — broad-launch evidence ledger; cite for rationale, not status | Prod Owner |
| `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | Evidence | `evidence/` (retained) | EVIDENCE_ONLY — has an open ops-verification item overlapping BACKLOG P1.3 (route the open item to BACKLOG) | Prod Owner |
| `attribution-sanitation-crosswalk.md` | Superseded history | `archive/` (retained) | SUPERSEDED — old→new SHA crosswalk (2026-07-15); immutable historical reference | Prod Owner |

---

## 2. Evidence corpus (`evidence/`, 14 markdown)

**Disposition: EVIDENCE_ONLY across the board.** Dated proof — cite for rationale, never for current status. Retained in place under `evidence/`; not promoted to any contract.

| Source | Note |
|---|---|
| `evidence/README.md` | Evidence-tree index |
| `evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md` | Beta-50 release evidence packet |
| `evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md` | Private-selection product audit |
| `evidence/beta50_2026-07-09/README.md` | Beta-50 packet index |
| `evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` | Option-D QA sell-off |
| `evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md` | Private-path validation |
| `evidence/manual-test-observations.latest.md` | Generated manual-test digest |
| `evidence/service-levels-summary.latest.md` | Generated SLO digest (feeds SERVICE_LEVELS) |
| `evidence/software-quality-summary.latest.md` | Generated quality digest (feeds SOFTWARE_QUALITY) |
| `evidence/stt_product_metrics_release_matrix_2026-06-02.md` | STT product-metrics matrix |
| `evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md` | Cloud STT evidence |
| `evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md` | Native/Browser STT evidence |
| `evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md` | Private STT evidence |
| `evidence/test_reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md` | STT speed/accuracy survival review |

---

## 3. Exploratory: Private v4 (`v4_work/`, 5)

**Disposition: EVIDENCE_ONLY (deferred).** Private v4 (WebGPU) is experimental and **hard-disabled** (`VITE_PRIVATE_STT_V4_DISABLED`; PostHog flags default off) — not a production path. Retained as reference for the deferred v4-disposition decision (BACKLOG). Not among the 14 canonical documents.

`V4_APP_PATH_PROOF_RUNBOOK.md` · `V4_COMPLETE_TEST_RUNBOOK.md` · `V4_DECODE_ROOT_CAUSE_EXPERIMENT.md` · `V4_POSTHOG_READINESS_PROOF.md` · `V4_RECOVERY.md`

---

## 4. Already-archived material (`archive/`)

**Disposition: SUPERSEDED (already dispositioned).** Historical evidence and superseded packets (audits, recovery, rehearsals, release-status, STT, workflows). Non-authoritative; retained for provenance. Indexed by [`archive/README.md`](./archive/README.md). No further action — kept as-is.

---

## 5. Pinned historical `docs/*` sources (`archive/legacy-docs/`)

**Disposition: SUPERSEDED (materialized read-only in this PR).** Pinned copies of the pre-consolidation `docs/*.md` corpus at their exact source commit, each with a non-authoritative banner. Materialized so the historical corpus is browsable without Git archaeology. **Not** current product truth; superseded by the canonical operational docs.

| Materialized path | Source | Source commit (date) | Lines |
|---|---|---|---|
| `d31102a8/ARCHITECTURE.md` | `docs/ARCHITECTURE.md` | `d31102a8` (2026-05-17) | 3386 |
| `d31102a8/PRD.md` | `docs/PRD.md` | `d31102a8` (2026-05-17) | 725 |
| `d31102a8/ROADMAP.md` | `docs/ROADMAP.md` | `d31102a8` (2026-05-17) | 978 |
| `d31102a8/CHANGELOG.md` | `docs/CHANGELOG.md` | `d31102a8` (2026-05-17) | 2196 |
| `d31102a8/OUTLINE.md` | `docs/OUTLINE.md` | `d31102a8` (2026-05-17) | 85 |
| `a21e1e52/USER_GUIDE.md` | `docs/USER_GUIDE.md` | `a21e1e52` (2026-03-13; parent of retirement commit `1526b33f`) | 87 |
| `a21e1e52/research/pricing_analysis.md` | `docs/research/pricing_analysis.md` | `a21e1e52` (2026-03-13; parent of `1526b33f`) | 91 |
| `a247f62c/Backend/edge-functions.md` | `docs/Backend/edge-functions.md` | `a247f62c` (2026-03-07; parent of retirement commit `d24f69a3`) | 59 |

> `docs/PRD.md` still exists on `main` as a **retirement stub** pointing to current sources; it is not re-homed here. The live `docs/ARCHITECTURE.md` on `main` (the large architecture reference) is a separate current file and is **out of scope** for this PR — its consolidation into canonical ARCHITECTURE is a later reconciliation PR.

---

## 6. Current-state corrections folded from PR #1031 (superseded)

PR [#1031](https://github.com/relativityE/speaksharp/pull/1031) (`docs/source-of-truth-reset`) was a narrow stale-fact correction. Its valid corrections are **recorded here** and it is **closed as superseded** by this reconciliation effort — not merged. The corrections (to be applied by the relevant later single-topic PR, sourced from `RELEASE_STATUS.md` as SSOT):

- **Baselines:** stale `65e58a62` / `__BUILD_ID__` references → current `main` HEAD `05643fbd`; last product-behavior change `c25b2178` (#1024) atop `a37a6ba1` (#1027) and `c99208b9` (#1022). Affected files: `RELEASE_STATUS.md`, `content_list.md`, `ACTIVE_COORDINATION.md`, `CODEBASE_MAP.md`.
- **Release mechanism:** the `__BUILD_ID__` JS `define` was **removed in #1027** (it rotated chunk hashes every deploy → stale-chunk crashes). Release SHA is now an inline `window.__APP_RELEASE__ = <VERCEL_GIT_COMMIT_SHA>` in `index.html`, surfaced at runtime as `window.__APP_RUNTIME_CONFIG__.release`; Sentry release is set at runtime (`release.inject:false`). SHA-equality is verified by reading `window.__APP_RELEASE__` from the deployed `index.html`.
- **STT posture (README):** "Triple-Engine / WebGPU-first" → **Private v2 (`whisper-base.en`) default** on-device Whisper via Transformers.js (CPU/WASM); **Private v4 (WebGPU) experimental and hard-disabled**; **Cloud** = explicit Pro choice (audio sent to AssemblyAI); **Native/Browser** = Web Speech, **not universally offline** (Chrome sends audio to Google) and **never an automatic fallback**. The app never silently switches processing mode.
- **Billing (README):** the "automatic one-hour Pro trial" flow is **retired**; current model is **invite-only, billing fail-closed** — paid checkout stays closed unless BOTH `VITE_PAYMENTS_ENABLED` (frontend) and `PAYMENTS_ENABLED` (backend) are true; Pro/Cloud QA uses a **comped DB entitlement**, not a live subscription.
- **Stale-contract banners:** `PRD.operational.md` and `ROADMAP.operational.md` (both stamped v0.6.19-rc0, last reviewed 2026-05-26) are **banner-marked ⚠️ STALE — UNDER REVISION**; PRD v1 is the authoritative replacement (tracked here as target #4).
- **docs/PRD.md:** retirement stub updated to point at the current operational PRD + `RELEASE_STATUS.md` + `ARCHITECTURE.operational.md`.
- **README header:** `v0.6.18 (2026-05-06)` → private-first beta pointer to `RELEASE_STATUS.md`.

---

## 7. The "Quick Preview (Browser)" naming decision

**Decision (approved):** the user-facing label for the Web Speech engine is **"Quick Preview (Browser)"**, replacing the user-facing "Native" wording.

- **Scope:** display label + truthful copy **only**. The internal engine token, telemetry event values, and DB `engine`/`mode` values remain **`native`** — unchanged.
- **Approved copy:** *"Uses your browser's speech recognition for a fast preview. Availability, processing, and accuracy vary by browser. Chrome recommended."*
- **Truthfulness guardrails:** never claim this mode is **local, offline, on-device, Private-equivalent, or cross-browser-consistent**. Chrome routes audio to Google. It is a convenience preview, not a benchmarked STT path, and is never an automatic fallback.
- **Not in this PR:** the display-label change is a **later product-copy PR** (reviewer roadmap step 4). This ledger only records the decision so the canonicalized docs use consistent, truthful wording.

---

## 8. Known gaps & open decisions

1. **Canonical set is proposed.** The 14-document target (`README.md` §2) awaits Product Owner confirmation. Naming of the *new* consolidated files (`STT_CONTRACTS.md`, `OPS_RUNBOOK.md`, `TEST_PROTOCOL.md`, `TESTER_INSTRUCTIONS.md`, canonical `PRD.md`/`ARCHITECTURE.md`/`SERVICE_LEVELS.md`/`SOFTWARE_QUALITY.md`) is not final.
2. **PRD v1 not yet written.** Target #4 is a rewrite (reviewer roadmap step 2). Until it lands, `PRD.operational.md` (banner-marked stale) + `RELEASE_STATUS.md` + `ARCHITECTURE.operational.md` are authoritative where they conflict.
3. **Architecture + STT ADRs pending.** Reviewer roadmap step 3 formalizes ADRs; the live `docs/ARCHITECTURE.md` (large reference) consolidation into canonical ARCHITECTURE is a separate later PR.
4. **Entitlement-policy divergence (acknowledged, deferred).** `buildPolicyForUser` is fed by multiple writers with divergent entitlement inputs. Documentation cannot resolve this — routed to BACKLOG / reviewer roadmap step 6 (central entitlement selector).
5. **Private v2 ≈90s finalize is a documented accepted limitation, not a measured p95.** STT_CONTRACTS must state it as an accepted RC limitation with honest "Finalizing…" UX, not a proven percentile SLO.
6. **Stale durable engine-attribution bug (product code, not docs).** After a manual Private→Native switch, `resolvedPrivateEngineVersion` is not reset, leaving a stale `private_v2:<model>` `engine_version`. Tracked for reviewer roadmap step 5 (attribution reset PR) — **out of scope here**; recorded so STT_CONTRACTS doesn't overclaim attribution reliability.
7. **`ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` open item** overlaps BACKLOG P1.3 — route the open ops-verification item to BACKLOG during consolidation.
8. **Sequencing constraint.** Only one reconciliation PR is active at a time; each is based on the previous merged result (reviewer roadmap). This foundation PR is step 1.

---

*This ledger is a migration record. It carries no changing release status; that lives only in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md).*

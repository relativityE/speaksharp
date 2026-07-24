**Owner:** Prod Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Class:** Procedure (migration record — **temporary**)
**Authority:** Section-level source→target inventory for the documentation-canonicalization effort. Companion to [`README.md`](./README.md). **Not** a canonical document — archived at migration closeout.

# Documentation Migration Ledger

Section-level inventory of every substantive documentation source in `product_release/` (and the pinned historical `docs/*` sources), mapping each to its target among the **14 Product Owner-approved canonical documents** ([`README.md`](./README.md) §2). Taxonomies in `README.md` §3–§4.

> **No current-state facts here.** This ledger contains **no changing SHAs, deployment baselines, or run IDs** — those live only in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md) (SSOT). The ledger **links** to `RELEASE_STATUS.md`; it never duplicates it. (Historical version tags inside pinned `archive/legacy-docs/` copies are frozen provenance, not current baselines.)
>
> **No consolidation happens in this PR.** Dispositions describe the *planned* migration executed by later single-topic PRs (2–6). This PR adds only the portal, this ledger, and pinned history.

**Legend — Class:** PR = product requirement/decision · RF = runtime fact · AI = architecture invariant/ADR · AC = acceptance criterion/SLO · PROC = procedure · EV = evidence · GAP = open gap/risk · HIST = superseded history · HYP = unverified hypothesis.
**Legend — Disposition:** EXTRACTED · EVIDENCE_ONLY · SUPERSEDED · OPEN_GAP · NO_DURABLE_CONTENT.
**Verify** = must this claim be re-verified against code/runtime before it is lifted into a canonical doc? (Y/N)
**Owner** for every row below: Prod Owner (relativityE), unless a canonical doc later assigns a section owner.

---

## 1. Canonical target map

| # | Canonical | # | Canonical | # | Canonical | # | Canonical |
|---|---|---|---|---|---|---|---|
| 1 | README.md | 5 | STT.md | 9 | RELEASE_PROCESS.md | 13 | TESTER_OPERATIONS.md |
| 2 | PRODUCT_REQUIREMENTS.md | 6 | COACHING_SCORE.md | 10 | RELEASE_STATUS.md | 14 | EVIDENCE_INDEX.md |
| 3 | ROADMAP.md | 7 | ENTITLEMENTS_AND_BILLING.md | 11 | OPERATIONS_AND_SECURITY.md | | |
| 4 | ARCHITECTURE.md | 8 | QUALITY.md | 12 | TESTER_GUIDE.md | | |

---

## 2. File-level disposition summary (33 active root docs)

| Source (`product_release/`) | → Canonical target | Disposition |
|---|---|---|
| `RELEASE_STATUS.md` | (10) RELEASE_STATUS | EXTRACTED — remains SSOT verbatim |
| `PRECEDENCE.md` | (1) README §1 | SUPERSEDED — precedence model absorbed into portal |
| `content_list.md` | (1) README | SUPERSEDED — replaced by portal |
| `PRD.operational.md` | (2) PRODUCT_REQUIREMENTS (+ (7) entitlement rows) | EXTRACTED |
| `PRODUCT_FEATURES.operational.md` | (2) PRODUCT_REQUIREMENTS | EXTRACTED |
| `SPEAKSHARP_SESSION_PROGRESS.operational.md` | (6) COACHING_SCORE | EXTRACTED |
| `ARCHITECTURE.operational.md` | (4) ARCHITECTURE | EXTRACTED |
| `CODEBASE_MAP.md` | (4) ARCHITECTURE | EXTRACTED — folded, not standalone |
| `STT_BASELINE_CONTRACTS.operational.md` | (5) STT | EXTRACTED |
| `PRIVATE_STT_ACCURACY_LEVERS.md` | (5) STT | EXTRACTED |
| `stt-perf-proof-protocol.md` | (5) STT | EXTRACTED |
| `SERVICE_LEVELS.operational.md` | (8) QUALITY (general SLOs) + (5) STT (STT SLOs) | EXTRACTED — split |
| `SOFTWARE_QUALITY.operational.md` | (8) QUALITY | EXTRACTED |
| `QUALITY_METRICS.md` | (8) QUALITY | EXTRACTED |
| `RC_GATES.md` | (9) RELEASE_PROCESS (+ (8) QUALITY acceptance detail) | EXTRACTED — split |
| `RC_TEST_INVENTORY.md` | (8) QUALITY | EXTRACTED |
| `INTERNAL_TEST_PROTOCOL.md` | (8) QUALITY (engineering) + (13) TESTER_OPERATIONS (tester-ops) | EXTRACTED — split |
| `MANUAL_HARDWARE_VALIDATION.md` | (8) QUALITY (protocol) + (13) TESTER_OPERATIONS (procedures) | EXTRACTED — split |
| `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | (12) TESTER_GUIDE | EXTRACTED |
| `LAUNCH_ENV_CHECKLIST.md` | (11) OPERATIONS_AND_SECURITY | EXTRACTED |
| `ENV_INVENTORY.md` | (11) OPERATIONS_AND_SECURITY | EXTRACTED |
| `SECRET_ROTATION_RUNBOOK.md` | (11) OPERATIONS_AND_SECURITY | EXTRACTED |
| `PAID_OPS_HARDENING_RUNBOOK.md` | (11) OPERATIONS_AND_SECURITY (+ (7) billing gating) | EXTRACTED |
| `RELEASE_RECOVERY.md` | (9) RELEASE_PROCESS | EXTRACTED |
| `OPS_HEALTH_DASHBOARD.md` | (11) OPERATIONS_AND_SECURITY | EXTRACTED |
| `SCA_EXCEPTIONS.md` | (11) OPERATIONS_AND_SECURITY | EXTRACTED |
| `BACKLOG.md` | (3) ROADMAP | EXTRACTED — Now/Next/Later/Declined |
| `ACTIVE_COORDINATION.md` | (3) ROADMAP | EXTRACTED — current board folds into Now |
| `ROADMAP.operational.md` | (3) ROADMAP | SUPERSEDED — ⚠️ STALE; durable risks fold in |
| `RELEASE_CLOSEOUT_LEDGER.md` | (3) ROADMAP + (14) EVIDENCE_INDEX | SUPERSEDED — open items → ROADMAP, dated proof → evidence |
| `PUBLIC_LAUNCH_LEDGER.md` | (14) EVIDENCE_INDEX → `evidence/` | EVIDENCE_ONLY |
| `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | (14) EVIDENCE_INDEX; requirements → (7) ENTITLEMENTS_AND_BILLING | EVIDENCE_ONLY (+ requirement extraction) |
| `attribution-sanitation-crosswalk.md` | `archive/` | SUPERSEDED — immutable historical crosswalk |

**Subtrees:** `evidence/**` (14 md) → (14) EVIDENCE_INDEX, **EVIDENCE_ONLY**. `v4_work/**` (5 md) → reference for deferred v4 disposition, **EVIDENCE_ONLY**. `archive/**` → already **SUPERSEDED**. `archive/legacy-docs/**` → pinned history, **SUPERSEDED** (see §3.A).

---

## 3. Section-level extraction coverage

Each substantive source is inventoried at heading level so no valuable content can be silently dropped. **Source path + commit** and **owner** are stated per subsection header; table columns give the remaining fields.

### 3.A Historical `docs/*` (pinned, read-only) — all SUPERSEDED

These are frozen provenance. Nothing is authoritative; extraction means *durable ideas may be re-stated (and re-verified) in a canonical doc*, never copied as current truth.

#### `archive/legacy-docs/d31102a8/ARCHITECTURE.md` — commit `d31102a8` (3386 lines)

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| 1. Project Directory Structure | Repo layout (drifted since May) | AI | Y | ARCHITECTURE → Layout | SUPERSEDED |
| 2. System Overview | High-level component model | AI | Y | ARCHITECTURE → Overview | SUPERSEDED |
| 2. Technology Stack | Stack list (partly stale) | AI | Y | ARCHITECTURE → Stack | SUPERSEDED |
| 3. Code Quality Standards | Lint/type/test standards | PROC | Y | QUALITY → Standards | SUPERSEDED |
| Testing and CI/CD | Historical CI topology | PROC | Y | QUALITY / RELEASE_PROCESS | SUPERSEDED |
| 8. Workflow Architecture & Automation | Agent/automation model (dated) | AI | Y | ARCHITECTURE → Automation | SUPERSEDED |
| 3. Frontend Architecture | React/store/provider structure | AI | Y | ARCHITECTURE → Frontend | SUPERSEDED |
| 4. Backend Architecture | Supabase/edge-function structure | AI | Y | ARCHITECTURE → Backend | SUPERSEDED |
| 5. Feature Architecture | Feature-module model | AI | Y | ARCHITECTURE → Features | SUPERSEDED |
| 6. User Roles and Tiers | Tier model (see current entitlements) | PR | Y | ENTITLEMENTS_AND_BILLING | SUPERSEDED |
| 5.5 Domain Services Layer | `domainServices.ts` role | AI | Y | ARCHITECTURE → Services | SUPERSEDED |
| 6. Transcription Service | STT service architecture | AI | Y | ARCHITECTURE + STT | SUPERSEDED |
| 7. Configuration Management | Config/env approach (drifted) | AI | Y | ARCHITECTURE / OPERATIONS_AND_SECURITY | SUPERSEDED |
| 9. UI/UX Implementation Standards | UI standards | PROC | Y | ARCHITECTURE → UI | SUPERSEDED |
| 10. Performance Optimizations | O(1) analytics, rolling WPM | AI | Y | ARCHITECTURE / STT | SUPERSEDED |
| 15. Resilience Patterns (v5.4) | Watchdog/heartbeat patterns | AI | Y | ARCHITECTURE → Resilience | SUPERSEDED |
| 17. Technical Debt & Known Issues (Feb 2026) | Historical debt list | GAP | Y | ROADMAP (if still open) | SUPERSEDED |
| 18. Hardening Patterns & CI Stability | CI stability patterns | PROC | Y | QUALITY | SUPERSEDED |
| 4. Testing & Deterministic Logic | Deterministic-test approach | PROC | Y | QUALITY | SUPERSEDED |

#### `archive/legacy-docs/d31102a8/PRD.md` — commit `d31102a8` (725 lines)

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| 1. Executive Summary | Product one-liner | PR | Y | PRODUCT_REQUIREMENTS → Summary | SUPERSEDED |
| 2. Vision & Positioning | Private-first positioning | PR | Y | PRODUCT_REQUIREMENTS → Positioning | SUPERSEDED |
| 3. UX Standards & Product Guardrails | UX guardrails | PR | Y | PRODUCT_REQUIREMENTS → UX | SUPERSEDED |
| 4. User Experience & Feedback | Feedback flows | PR | Y | PRODUCT_REQUIREMENTS | SUPERSEDED |
| 5. Testing & Quality Assurance | QA intent | PROC | Y | QUALITY | SUPERSEDED |
| 5. Known Issues & Risks | Historical risks | GAP | Y | ROADMAP | SUPERSEDED |
| 6. Development Roadmap | Old roadmap | GAP | Y | ROADMAP | SUPERSEDED |
| 6. Software Quality Metrics | Old quality targets | AC | Y | QUALITY | SUPERSEDED |
| 8. Metrics and Success Criteria | Conversion/retention/WER targets | PR/AC | Y | PRODUCT_REQUIREMENTS + STT | SUPERSEDED |
| 9. Future Enhancements / Opportunities | Idea backlog | GAP | Y | ROADMAP → Later | SUPERSEDED |
| 10. Strategic Review & Analysis | Market analysis | HYP | Y | (evidence/archive) | SUPERSEDED |
| 11. Deployment (Alpha Release) | Old deploy notes | HIST | N | archive | SUPERSEDED |

#### `archive/legacy-docs/d31102a8/ROADMAP.md` — commit `d31102a8` (978 lines)

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| "✅ COMPLETE" phase sections (CI stability, Live-UI/STT, Frontend verification, Security hardening, Phase 3/4/4/5/6, Nightly CI, v0.5.4.5, System-integrity) | Completed-work narrative | HIST | N | archive (git history is truth) | SUPERSEDED |
| Quality & Reliability Sprint (Q1 2026, 🟡) | Then-open reliability items | GAP | Y | ROADMAP (if still open) | SUPERSEDED |
| Marketing & Growth | Growth ideas | GAP | Y | ROADMAP → Later | SUPERSEDED |
| Phase 1: Stabilize & Harden MVP | MVP hardening items | GAP | Y | ROADMAP | SUPERSEDED |
| Phase 2 / 2.5: User Validation & UI Polish | Validation/polish items | GAP | Y | ROADMAP | SUPERSEDED |
| Required for any Supabase migration PR | Migration checklist | PROC | Y | RELEASE_PROCESS / OPERATIONS_AND_SECURITY | SUPERSEDED |
| Forensic Telemetry & Provisioning FSM (Apr 2026, 🟡) | Then-in-progress FSM work | GAP | Y | ROADMAP | SUPERSEDED |

#### `archive/legacy-docs/d31102a8/CHANGELOG.md` — commit `d31102a8` (2196 lines)

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| All `[x.y.z] - date` version entries (0.1.0 → 0.6.19, incl. 1.4.0/3.5.4 legacy) | Per-release change narrative | HIST | N | archive (git history + `RELEASE_STATUS.md` are truth) | SUPERSEDED — NO_DURABLE_CONTENT beyond provenance |

> `archive/legacy-docs/d31102a8/OUTLINE.md`, `a21e1e52/USER_GUIDE.md`, `a21e1e52/research/pricing_analysis.md`, `a247f62c/Backend/edge-functions.md`: **SUPERSEDED**. USER_GUIDE content → TESTER_GUIDE (verify Y); edge-functions → ARCHITECTURE → Backend (verify Y); pricing_analysis → evidence/ (EVIDENCE_ONLY); OUTLINE → NO_DURABLE_CONTENT.

### 3.B Current product/requirement docs

#### `PRD.operational.md` — commit: current `main` (see `RELEASE_STATUS.md`); ⚠️ banner-marked STALE

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| 0. Product Feature Inventory | Pointer to feature doc | PR | N | PRODUCT_REQUIREMENTS → Features | EXTRACTED |
| 1. User-Visible Guarantees | Persistence, quotas, privacy (audio never leaves browser), no-silent-switch, private-first hierarchy, cloud-chunk contract | PR | Y | PRODUCT_REQUIREMENTS → Guarantees; billing rows → ENTITLEMENTS_AND_BILLING | EXTRACTED |
| 2. Failure Behavior | Fail-closed quota, model-download failure, webhook-delay, watchdog, cloud-chunk violation | PR | Y | PRODUCT_REQUIREMENTS → Failure | EXTRACTED |
| 3. Explicit Non-Goals | Bluetooth handoff, Safari offline, multi-tab | PR | N | PRODUCT_REQUIREMENTS → Non-goals | EXTRACTED |
| 4. Service-Level Expectations | Product-level SL intent | AC | Y | SERVICE→ QUALITY / STT | EXTRACTED |
| 5. Metrics & Success Criteria | WER<10% Private / <8% Cloud, conversion, retention, Native benchmark boundary | AC | Y | PRODUCT_REQUIREMENTS + STT | EXTRACTED |
| 6. Software Quality Evidence | Evidence pointer | EV | N | QUALITY | EXTRACTED |

#### `PRODUCT_FEATURES.operational.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Personal Progress & Executive Rehearsal Contract | Canonical progress/rehearsal direction | PR | Y | COACHING_SCORE + PRODUCT_REQUIREMENTS | EXTRACTED |
| Feature Group Taxonomy | Feature grouping | PR | N | PRODUCT_REQUIREMENTS | EXTRACTED |
| Vetted Product Claim Register | Approved marketable claims | PR | Y | PRODUCT_REQUIREMENTS → Claims | EXTRACTED |
| Product Surface Summary | Surfaces inventory | PR | N | PRODUCT_REQUIREMENTS | EXTRACTED |
| Accepted Feature Candidates & Timing | Roadmap-ish candidates | GAP | Y | ROADMAP | EXTRACTED |
| Detailed Feature Inventory | Full feature list | PR | N | PRODUCT_REQUIREMENTS | EXTRACTED |
| Product Positioning / Claims Boundary | Positioning + claim limits (Native not corpus-WER) | PR | Y | PRODUCT_REQUIREMENTS + STT | EXTRACTED |

#### `SPEAKSHARP_SESSION_PROGRESS.operational.md` — current `main` (27 sections)

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| A.0–A.9 (Personal Progress direction) | Score-retirement rationale, baseline-not-grade, source priority, two-view calc, transparency rules, worked examples, comparable-session contract, outcome/agenda coverage, completion≠performance | PR | Y | COACHING_SCORE → Part A | EXTRACTED |
| Reviewer Context / Source Of Truth / Signed-Off Architecture Boundary | Decision provenance + boundary | PR | N | COACHING_SCORE → Provenance | EXTRACTED |
| Implementation Design / What The Score Means / Score Weights / Formula / Calibration / Score Labels / Confidence Levels / UX Rules | Legacy 0–10 score model (staged retirement) | PR/AI | Y | COACHING_SCORE → Part B (legacy) | EXTRACTED |
| Research Anchors | Cited research basis | EV | Y | COACHING_SCORE → Research / evidence | EXTRACTED |

#### `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Release closeout summary | Entitlement audit closeout | EV | N | EVIDENCE_INDEX | EVIDENCE_ONLY |
| Finding 1: Pro daily/monthly limit (policy const vs DB) | Requirement + open ops item | PR/GAP | Y | ENTITLEMENTS_AND_BILLING (requirement); ROADMAP (open item) | EVIDENCE_ONLY + extraction |
| Finding 2: overlapping usage functions | Divergent usage fns | GAP | Y | ROADMAP | EVIDENCE_ONLY |
| Verified OK / Open needs-ops | Verified facts + open ops | EV/GAP | Y | EVIDENCE_INDEX + ROADMAP | EVIDENCE_ONLY |

### 3.C Architecture (current)

#### `ARCHITECTURE.operational.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| 🏛️ Authoritative Sources of Truth | Which artifact is truth for what | AI | Y | ARCHITECTURE → Sources of Truth | EXTRACTED |
| 🛡️ Structural Invariants | No-silent-fallback, singleton controller, mutex, fail-closed, etc. | AI | Y | ARCHITECTURE → Invariants | EXTRACTED |
| 🏗️ Operational Components | Component responsibilities | AI | Y | ARCHITECTURE → Components | EXTRACTED |

#### `CODEBASE_MAP.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Product direction + intent→code→test→doc rows | Breadcrumb map (promise → path → protecting test → doc) | AI | Y | ARCHITECTURE → Code Map | EXTRACTED — folded (not standalone) |

### 3.D STT (current)

#### `STT_BASELINE_CONTRACTS.operational.md` — current `main` (14 sections)

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Current Execution Addendum / Test Environment / "Drop-In" meaning | Test-env + drop-in definition | AC | Y | STT → Environment | EXTRACTED |
| Stored Benchmark Targets / Published Performance Objectives / Acceptance Targets | Per-engine WER/latency targets | AC | Y | STT → Targets | EXTRACTED |
| Shared Cross-Engine Contract / Baseline Matrix / Full Harvard Corpus Comparison | Cross-engine contract + corpus matrix | AC | Y | STT → Contract/Matrix | EXTRACTED |
| Gate Status Language / Evidence Table Required / Deterministic Evidence Collected / Review Rule | Gate vocabulary + required evidence | AC | Y | STT → Evidence; QUALITY (gate lang) | EXTRACTED |
| SpeakSharp Score Eligibility | Which engines are benchmarkable (Native = browser behavior only) | PR/AC | Y | STT + PRODUCT_REQUIREMENTS | EXTRACTED |

#### `PRIVATE_STT_ACCURACY_LEVERS.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Reference baselines | What each number proves | AC/EV | Y | STT → Levers | EXTRACTED |
| Lever 1 Mic-constraint / Lever 2 COI→multithread / Lever 3 WebGPU / Lever 4 model upgrade | Accuracy/latency levers + ordering | AC | Y | STT → Levers | EXTRACTED |
| Recommended sequence | Ordered improvement plan | GAP | Y | STT → Levers / ROADMAP | EXTRACTED |

#### `stt-perf-proof-protocol.md` — current `main`

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Tiered ladder / Layered measurement / Cold-warm-hot / Controls / Minimum matrix / Report fields / Slowdown classification / Decision thresholds | STT perf-proof measurement protocol + thresholds | AC/PROC | Y | STT → Perf Proof | EXTRACTED |

### 3.E Quality & service levels (current)

#### `SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md`, `SERVICE_LEVELS.operational.md` — current `main`

| Source · Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| SOFTWARE_QUALITY · 1–6 (Evidence Chain, Sources, Generated Files, Targets, Interpretation, Related) | Quality-evidence taxonomy + targets + interpretation rules | PROC/AC | Y | QUALITY | EXTRACTED |
| QUALITY_METRICS · Evidence Files / Release Targets / Target-vs-Measured Digest / Closure Rule | Quality digest + closure rule | AC/EV | Y | QUALITY (targets) + EVIDENCE_INDEX (digest) | EXTRACTED |
| SERVICE_LEVELS · 1 Definitions / 3 Industry Check / 5 Release-Gate Fit / 6 Artifact Expectations | General SLO/SLC/SLA terms + gate fit | AC | Y | QUALITY | EXTRACTED |
| SERVICE_LEVELS · 2 Soft-Release Targets / 4 Evidence Mapping (STT-specific SLOs) | STT-specific latency/WER SLOs | AC | Y | STT → SLOs | EXTRACTED (split) |

#### `RC_TEST_INVENTORY.md` — current `main` (17 sections)

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Executive Summary / Per-File Triage / RC Gate Structure / How Tests → Gates / Gate Coverage Map | Counted tests mapped to gates | AC | Y | QUALITY → Test Inventory | EXTRACTED |
| STT Corpus Gate Layers / Contract Source Requirement / RC-Counted ledgers | STT + unit/browser counted ledgers | AC | Y | QUALITY (+ STT corpus) | EXTRACTED |
| Where Workflows Fit / GitHub Workflows / Script Inventory | Workflow/script inventory | PROC | Y | QUALITY / RELEASE_PROCESS | EXTRACTED |
| Current Gaps / Redundancy Candidates | Coverage gaps + waste | GAP | Y | ROADMAP | OPEN_GAP |
| Tests Added/Tightened latest push / Recommended RC Reporting | Recent additions + report format | AC/PROC | N | QUALITY | EXTRACTED |

#### `INTERNAL_TEST_PROTOCOL.md`, `MANUAL_HARDWARE_VALIDATION.md` — current `main`

| Source · Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| INTERNAL_TEST · Release posture / Entitlement rules / Acceptance criteria / Session UI truth / Data provenance / Browser wording / v4 posture | Engineering acceptance protocol | PROC | Y | QUALITY | EXTRACTED |
| INTERNAL_TEST · Pre-invite operator checklist / Automated first-time-tester proof | Tester-ops procedures | PROC | Y | TESTER_OPERATIONS | EXTRACTED (split) |
| MANUAL_HARDWARE · Desktop Chrome/Safari/Firefox/iPhone/Bluetooth/Stress + Evidence Logs | Manual hardware/browser matrix | PROC/EV | Y | QUALITY (protocol) + TESTER_OPERATIONS (run) + EVIDENCE_INDEX (logs) | EXTRACTED (split) |

### 3.F Release process, status, roadmap (current)

#### `RC_GATES.md` — current `main` (10 sections)

| Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| Evidence Rules / Gate Summary / Gate 1–5 (Product Truth, SAST, DAST, SCA, UX Smoke) | Gate definitions + evidence requirements | AC | Y | RELEASE_PROCESS → Gates; acceptance detail → QUALITY | EXTRACTED (split) |
| Observability API Readback / Evidence Freshness Contract / Named STT Gate Artifacts | Freshness contract + named artifacts | AC | Y | RELEASE_PROCESS + STT (STT artifacts) | EXTRACTED |

#### `RELEASE_RECOVERY.md`, `RELEASE_CLOSEOUT_LEDGER.md`, `RELEASE_STATUS.md` — current `main`

| Source · Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| RELEASE_RECOVERY · Doctrine / Triage / Rollback criteria / Supabase patching / Data integrity / Comms / Deploy facts | Recovery + rollback procedure | PROC | Y | RELEASE_PROCESS → Recovery | EXTRACTED |
| RELEASE_CLOSEOUT · Target state / Live lane / A–E closeout sections / Dev posture | Older closeout tracker (has dated proof + open items) | GAP/EV | Y | ROADMAP (open) + EVIDENCE_INDEX (proof) | SUPERSEDED |
| RELEASE_STATUS · all sections | Current posture (**SSOT**) | RF | N | RELEASE_STATUS (unchanged) | EXTRACTED |

#### `BACKLOG.md`, `ACTIVE_COORDINATION.md`, `ROADMAP.operational.md` — current `main`

| Source · Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| BACKLOG · 1 Product Positioning Contract | Positioning invariants | PR | Y | PRODUCT_REQUIREMENTS (contract) + ROADMAP | EXTRACTED |
| BACKLOG · 2 Remaining P0 / 3 Remaining P1 / 4 Deferred P2-P3 | All open work by priority | GAP | Y | ROADMAP → Now/Next/Later | EXTRACTED |
| BACKLOG · 5 Triage Rules | How work is prioritized | PROC | N | ROADMAP → Triage | EXTRACTED |
| ACTIVE_COORDINATION · Current baseline / Current work | Working board (references `RELEASE_STATUS.md` for baseline) | GAP | N | ROADMAP → Now | EXTRACTED |
| ROADMAP.operational · Risk Matrix / Pre-Launch Hardening / Launch Boundary | STALE risk matrix + 12-hr-sprint framing + declined boundary | GAP/HIST | Y | ROADMAP → Now/Declined (durable risks only) | SUPERSEDED |

### 3.G Operations & security (current)

#### `LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md` — current `main`

| Source · Heading group | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| LAUNCH_ENV_CHECKLIST · 1–8 + Verification Protocol | Pre-launch env/billing/observability/STT-flag checklist | PROC | Y | OPERATIONS_AND_SECURITY → Env Checklist | EXTRACTED |
| ENV_INVENTORY · Storage homes / `.env` map / VITE_* / secrets / GH Actions / Vercel / add-new / flag sync / #1006 draft / open decisions / audit-workflow inventory | Full env/secrets/flag inventory (names + scope only) | PROC | Y | OPERATIONS_AND_SECURITY → Env Inventory | EXTRACTED |
| SECRET_ROTATION_RUNBOOK · What-to-rotate / Automation / Sequence / Verify / Ownership | Rotation runbook | PROC | Y | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |
| PAID_OPS_HARDENING · Gating architecture / verifiable-now / live-var checklist / activation verification / scope note / guardrails | Paid-path gating + activation contract | PROC/PR | Y | OPERATIONS_AND_SECURITY → Paid Ops; billing gating → ENTITLEMENTS_AND_BILLING | EXTRACTED |
| OPS_HEALTH_DASHBOARD · Status / rows / GitHub-API semantics / vocabulary / security rules / usage / WIP / future | Ops-health scope + status vocabulary | PROC | Y | OPERATIONS_AND_SECURITY → Ops Health | EXTRACTED |
| SCA_EXCEPTIONS · GHSA-5xrq / Pinned-audit result | Single ignored advisory + rationale | PROC/EV | Y | OPERATIONS_AND_SECURITY → SCA | EXTRACTED |

### 3.H Tester copy (current)

#### `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` — current `main`

| Heading | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| What is SpeakSharp? / Beta invitation copy / Simple walkthrough / What feedback helps most | Plain-language external tester guide + send-ready invite copy | PROC | Y | TESTER_GUIDE | EXTRACTED |

### 3.I Evidence & exploratory (file-level)

| Source | Atomic content / claim | Class | Verify | Target → § | Disp. |
|---|---|---|---|---|---|
| `evidence/**` (14 md: beta50, private-path validation, STT release reports, metrics matrix, generated digests) | Dated proof packets | EV | N | EVIDENCE_INDEX | EVIDENCE_ONLY |
| `PUBLIC_LAUNCH_LEDGER.md` (PL-002…PL-011 gate evidence) | Broad-launch gate evidence | EV | N | EVIDENCE_INDEX | EVIDENCE_ONLY |
| `v4_work/**` (5 md: app-path proof, complete test, decode root-cause, posthog readiness, recovery) | v4 exploration (hard-off engine) | EV/HYP | N | reference for deferred v4 disposition (ROADMAP → Later) | EVIDENCE_ONLY |
| `attribution-sanitation-crosswalk.md` | Old→new SHA crosswalk (2026-07-15) | HIST | N | archive | SUPERSEDED |

---

## 4. Current-state corrections (from superseded PR #1031)

PR [#1031](https://github.com/relativityE/speaksharp/pull/1031) was a narrow stale-fact correction, **closed as superseded** (not merged). Its corrections apply to **`RELEASE_STATUS.md` (SSOT)** and the canonical docs, executed by the relevant later PR. **This ledger records only the *kinds* of correction — not the changing values** (per the no-competing-source rule; read the values from `RELEASE_STATUS.md`):

- **Baseline references** in `RELEASE_STATUS.md`, `content_list.md`, `ACTIVE_COORDINATION.md`, `CODEBASE_MAP.md` must track the current `main` HEAD and last product-behavior baseline **as recorded in `RELEASE_STATUS.md`** (an earlier stale `main` SHA and the old build-id define were corrected — read the current values from `RELEASE_STATUS.md`, not here).
- **Release mechanism:** the `__BUILD_ID__` JS `define` was removed; release SHA is an inline `window.__APP_RELEASE__` in `index.html` (from `VERCEL_GIT_COMMIT_SHA`), surfaced at `window.__APP_RUNTIME_CONFIG__.release`; Sentry `release.inject:false`. → ARCHITECTURE (mechanism) + `RELEASE_STATUS.md` (how to verify SHA-equality).
- **STT posture:** Private v2 (`whisper-base.en`) default; Private v4 (WebGPU) experimental + hard-disabled; Cloud explicit-choice; Native/Browser = Web Speech, not universally offline (Chrome→Google), never automatic fallback; app never silently switches. → PRODUCT_REQUIREMENTS + STT.
- **Billing:** invite-only, fail-closed; checkout closed unless BOTH `VITE_PAYMENTS_ENABLED` and `PAYMENTS_ENABLED`; Pro/Cloud QA = comped DB entitlement; one-hour Pro trial retired. → ENTITLEMENTS_AND_BILLING.
- **Stale banners:** `PRD.operational.md`, `ROADMAP.operational.md` (v0.6.19-rc0, reviewed 2026-05-26) banner-marked ⚠️ STALE; PRODUCT_REQUIREMENTS (PRD v1) is the authoritative replacement.
- **`docs/PRD.md`** retirement stub points at current sources.

---

## 5. The "Quick Preview (Browser)" naming decision

**Decision (approved):** the user-facing label for the Web Speech engine is **"Quick Preview (Browser)"**, replacing user-facing "Native".

- **Scope:** display label + truthful copy **only**. Internal engine token, telemetry values, and DB `engine`/`mode` values remain **`native`** — unchanged.
- **Approved copy:** *"Uses your browser's speech recognition for a fast preview. Availability, processing, and accuracy vary by browser. Chrome recommended."*
- **Guardrails:** never claim **local, offline, on-device, Private-equivalent, or cross-browser-consistent** (Chrome routes audio to Google). Convenience preview, not a benchmarked STT path, never an automatic fallback.
- **Not in this PR:** the display-label change is a later product-copy PR. Canonical docs (PRODUCT_REQUIREMENTS, STT, TESTER_GUIDE) must use this truthful wording.

---

## 6. Known gaps & open decisions

1. **Canonical set is Product Owner-approved** (`README.md` §2, 14 docs). New-file names are fixed by that approval.
2. **PRODUCT_REQUIREMENTS (PRD v1) not yet written** — the interim `PRD.operational.md` is banner-marked stale; `RELEASE_STATUS.md` + `ARCHITECTURE.operational.md` are authoritative where they conflict.
3. **ARCHITECTURE + STT ADRs pending** — durable design decisions consolidate into ARCHITECTURE; the live `docs/ARCHITECTURE.md` reference consolidation is a later PR.
4. **Entitlement-policy divergence (deferred)** — routed to ROADMAP; documentation cannot resolve it.
5. **Private v2 ≈90s finalize** = accepted RC limitation with honest "Finalizing…" UX, **not** a measured p95 — STT.md must state it as such.
6. **Stale durable engine-attribution** (product code) fixed under PR #1033 — recorded so STT.md does not overclaim attribution reliability.
7. **`ENTITLEMENT_PRO_LIMIT_EVIDENCE` open item** overlaps BACKLOG P1.3 — route the open ops item to ROADMAP.
8. **Sequencing** — one reconciliation PR at a time, each based on the previous merged result; final PR archives superseded files → exactly 14 canonical + this ledger archived.

---

*This ledger is a temporary migration record, archived at closeout. It carries no changing release status; that lives only in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md).*

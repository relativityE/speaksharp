**Status:** Draft (temporary migration record)
**Owner:** Prod Owner (final approver); per-row accountable role in each subsection header
**Last Reviewed:** 2026-07-24
**Last Verified:** 2026-07-24 (headings enumerated from the live sources / pinned commits; current-state facts verified via `RELEASE_STATUS.md`)
**Applies To:** The documentation-canonicalization migration (33 active root sources + subtrees + pinned history → 14 canonical docs).
**Class:** Procedure (migration record — **temporary**)
**Authority:** Section-level source→target inventory for the documentation-canonicalization effort.
**Not Authoritative For:** current release status (→ [`RELEASE_STATUS.md`](./RELEASE_STATUS.md)); this ledger contains no changing SHAs/run IDs.
**Supersedes:** —
**Evidence Sources:** the enumerated source files + their commits, cited per row.

# Documentation Migration Ledger

Section-level inventory of every substantive documentation source in `product_release/` (and the pinned historical `docs/*` sources), mapping each to its target among the **14 Product Owner-approved canonical documents** ([`README.md`](./README.md) §2). **Temporary** — archived at migration closeout; not a canonical document.

> **No current-state facts here.** No changing SHAs, deployment baselines, or run IDs — those live only in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md). (Historical version tags inside `archive/legacy-docs/` are frozen provenance, not current baselines.)
>
> **No consolidation in this PR.** Dispositions describe the *planned* migration executed by later PRs (2–6). This PR adds the portal, this ledger, the pinned history, and the `RELEASE_STATUS.md` SSOT repair.

**Two separate axes per row (do not conflate):**
- **Content disposition** — what happens to the *content*: `EXTRACTED` · `EVIDENCE_ONLY` · `OPEN_GAP` · `NO_DURABLE_CONTENT`.
- **Source-file state** — what happens to the *file*: `ACTIVE` (stays) · `RETAINED_EVIDENCE` (kept under `evidence/`) · `ARCHIVE_AT_CLOSEOUT` (moved to `archive/` after its content is proven-incorporated) · `ALREADY_ARCHIVED`.
- A historical file with durable material is therefore **content=EXTRACTED, file-state=ARCHIVE_AT_CLOSEOUT** — `SUPERSEDED` alone is never permission to archive without proving incorporation.

**Legend — Class:** PR product-requirement/decision · RF runtime-fact · AI architecture-invariant/ADR · AC acceptance-criterion/SLO · PROC procedure · EV evidence · GAP open-gap/risk · HIST superseded-history · HYP unverified-hypothesis.
**Legend — Role:** PO Product Owner · ENG Engineering · EQ Engineering/Quality · OPS Operations/Security · POQ Product-Ops/Quality. (PO is final approver on all.)
**Verification method** = how the atomic claim will be checked before it is lifted (grep/read code path, run named test, read runtime value, cross-check `RELEASE_STATUS.md`, PostHog query, or N/A for pure provenance).

---

## 1. Canonical target map

| # | Canonical | # | Canonical | # | Canonical | # | Canonical |
|---|---|---|---|---|---|---|---|
| 1 | README.md | 5 | STT.md | 9 | RELEASE_PROCESS.md | 13 | TESTER_OPERATIONS.md |
| 2 | PRODUCT_REQUIREMENTS.md | 6 | PROGRESS_AND_NEXT_ACTION.md | 10 | RELEASE_STATUS.md | 14 | EVIDENCE_INDEX.md |
| 3 | ROADMAP.md | 7 | ENTITLEMENTS_AND_BILLING.md | 11 | OPERATIONS_AND_SECURITY.md | | |
| 4 | ARCHITECTURE.md | 8 | QUALITY.md | 12 | TESTER_GUIDE.md | | |

---

## 2. File-level summary (33 active root docs)

| Source | → Target | Content disp. | Source-file state | Role |
|---|---|---|---|---|
| `RELEASE_STATUS.md` | (10) | EXTRACTED (repaired in this PR) | ACTIVE | PO |
| `PRECEDENCE.md` | (1) §1 | EXTRACTED (§3.0) | ARCHIVE_AT_CLOSEOUT | PO |
| `content_list.md` | (1) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `PRD.operational.md` | (2)(+7) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `PRODUCT_FEATURES.operational.md` | (2) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `SPEAKSHARP_SESSION_PROGRESS.operational.md` | (6) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `ARCHITECTURE.operational.md` | (4) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | ENG |
| `CODEBASE_MAP.md` | (4) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | ENG |
| `STT_BASELINE_CONTRACTS.operational.md` | (5) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | ENG |
| `PRIVATE_STT_ACCURACY_LEVERS.md` | (5) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | ENG |
| `stt-perf-proof-protocol.md` | (5) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | ENG |
| `SERVICE_LEVELS.operational.md` | (8)(+5) | EXTRACTED (split) | ARCHIVE_AT_CLOSEOUT | EQ |
| `SOFTWARE_QUALITY.operational.md` | (8) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | EQ |
| `QUALITY_METRICS.md` | (8) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | EQ |
| `RC_GATES.md` | (9)(+8) | EXTRACTED (split) | ARCHIVE_AT_CLOSEOUT | EQ |
| `RC_TEST_INVENTORY.md` | (8) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | EQ |
| `INTERNAL_TEST_PROTOCOL.md` | (8)(+13) | EXTRACTED (split) | ARCHIVE_AT_CLOSEOUT | EQ/POQ |
| `MANUAL_HARDWARE_VALIDATION.md` | (8)(+13) | EXTRACTED (split) | ARCHIVE_AT_CLOSEOUT | EQ/POQ |
| `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | (12) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `LAUNCH_ENV_CHECKLIST.md` | (11) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `ENV_INVENTORY.md` | (11) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `SECRET_ROTATION_RUNBOOK.md` | (11) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `PAID_OPS_HARDENING_RUNBOOK.md` | (11)(+7) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `RELEASE_RECOVERY.md` | (9) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS/EQ |
| `OPS_HEALTH_DASHBOARD.md` | (11) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `SCA_EXCEPTIONS.md` | (11) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | OPS |
| `BACKLOG.md` | (3) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `ACTIVE_COORDINATION.md` | (3) | EXTRACTED | ARCHIVE_AT_CLOSEOUT | PO |
| `ROADMAP.operational.md` | (3) | EXTRACTED (durable risks only) | ARCHIVE_AT_CLOSEOUT | PO |
| `RELEASE_CLOSEOUT_LEDGER.md` — open items | (3) ROADMAP | EXTRACTED | ARCHIVE_AT_CLOSEOUT → `archive/` | PO |
| `RELEASE_CLOSEOUT_LEDGER.md` — dated proof | (14) → `evidence/` | EVIDENCE_ONLY | ARCHIVE_AT_CLOSEOUT → `archive/` | POQ |
| `PUBLIC_LAUNCH_LEDGER.md` | (14) indexes `evidence/PUBLIC_LAUNCH_LEDGER.md` | EVIDENCE_ONLY | RETAINED_EVIDENCE → moves to `evidence/` | POQ |
| `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` — dated proof | (14) → `evidence/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | EVIDENCE_ONLY | RETAINED_EVIDENCE → moves to `evidence/` | POQ |
| `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` — Pro-limit requirement | (7) ENTITLEMENTS_AND_BILLING | EXTRACTED | RETAINED_EVIDENCE (shared file) | PO |
| `attribution-sanitation-crosswalk.md` | `archive/attribution-sanitation-crosswalk.md` | NO_DURABLE_CONTENT (provenance) | ARCHIVE_AT_CLOSEOUT → `archive/` | PO |

**Subtrees:** `evidence/**` → (14), EVIDENCE_ONLY, RETAINED_EVIDENCE, POQ (substantive ones enumerated in §3.I). `v4_work/**` → reference, EVIDENCE_ONLY, RETAINED_EVIDENCE, ENG. `archive/**` → NO_DURABLE_CONTENT/provenance, ALREADY_ARCHIVED. `archive/legacy-docs/**` → §3.A.

### 2.1 Closeout arithmetic — exactly 14 root files

At migration closeout the root of `product_release/` contains **exactly 14** canonical Markdown files (`README.md` §2). Every other current root Markdown has an explicit off-root destination:

- **Stay ACTIVE at root (2):** `README.md` (replaces `content_list.md`), `RELEASE_STATUS.md`.
- **Consolidated then moved to `archive/` (ARCHIVE_AT_CLOSEOUT):** `PRECEDENCE.md`, `content_list.md`, `PRD.operational.md`, `PRODUCT_FEATURES.operational.md`, `SPEAKSHARP_SESSION_PROGRESS.operational.md`, `ARCHITECTURE.operational.md`, `CODEBASE_MAP.md`, `STT_BASELINE_CONTRACTS.operational.md`, `PRIVATE_STT_ACCURACY_LEVERS.md`, `stt-perf-proof-protocol.md`, `SERVICE_LEVELS.operational.md`, `SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md`, `RC_GATES.md`, `RC_TEST_INVENTORY.md`, `INTERNAL_TEST_PROTOCOL.md`, `MANUAL_HARDWARE_VALIDATION.md`, `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`, `LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `RELEASE_RECOVERY.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md`, `BACKLOG.md`, `ACTIVE_COORDINATION.md`, `ROADMAP.operational.md`, `RELEASE_CLOSEOUT_LEDGER.md`, `attribution-sanitation-crosswalk.md`, `DOC_MIGRATION_LEDGER.md` (this file, archived last).
- **Moved to `evidence/` (RETAINED_EVIDENCE):** `PUBLIC_LAUNCH_LEDGER.md`, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`.
- **New canonical files created by consolidation (12):** `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `STT.md`, `PROGRESS_AND_NEXT_ACTION.md`, `ENTITLEMENTS_AND_BILLING.md`, `QUALITY.md`, `RELEASE_PROCESS.md`, `OPERATIONS_AND_SECURITY.md`, `TESTER_GUIDE.md`, `TESTER_OPERATIONS.md`, `EVIDENCE_INDEX.md`.

Root at closeout = 2 retained + 12 new = **14**. No evidence file remains at the root.

---

## 3. Section-level extraction coverage

Per-subsection header states **Source · Commit · Role**. Columns: `Heading` · `Atomic claim` · `Class` · `Verify method` · `Target → §` · `Content disp.` (file-state stated in the subsection header). Grouped rows enumerate every included heading and share one class/target/verify/disposition.

### 3.0 `PRECEDENCE.md` — Commit: current `main` · Role: PO · File-state: ARCHIVE_AT_CLOSEOUT

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Hierarchy of Truth | 8-level truth order (User-Trust > Runtime > Data-Integrity > Security > Survivability > Tests/CI > Arch-Intent > Roadmap) | AI/PR | cross-check README §1 table | README §1 | EXTRACTED |
| Canonical Release Artifact Rule | Status only from `RELEASE_STATUS.md`; older audits historical | PROC | cross-check README §1 + RELEASE_STATUS Update rule | README §1 | EXTRACTED |
| Strategic Rationale §1 (Integrity vs Survivability) | Silent corruption worse than outage; fail-closed even if outage | AI | cross-check README §1 rules | README §1; OPERATIONS_AND_SECURITY | EXTRACTED |
| Strategic Rationale §2 (Runtime Truth anchor) | System is what it does; doc-vs-code = Drift/Vulnerability | AI | cross-check README §1 rules | README §1; ARCHITECTURE | EXTRACTED |
| Strategic Rationale §3 (Separation of runtime/survivability) | Establish runtime state before recovery | PROC | cross-check RELEASE_PROCESS recovery | README §1; RELEASE_PROCESS | EXTRACTED |
| 🚦 Enforcement Protocol — Go/No-Go | L1/L3 violation = automatic NO-GO; L7 = polish unless cascading | AC | cross-check RELEASE_PROCESS gates | README §1; RELEASE_PROCESS | EXTRACTED |
| 🚦 Enforcement Protocol — P0 Incident Response | Recovery respects Data-Integrity; never bypass Security for Survivability | PROC | cross-check OPERATIONS_AND_SECURITY recovery | README §1; OPERATIONS_AND_SECURITY | EXTRACTED |
| Tests/CI evidence placement | Tests/CI (L6) are evidence below runtime truth | AC | cross-check QUALITY evidence chain | README §1; QUALITY | EXTRACTED |

### 3.A Historical `docs/*` (pinned, read-only) — File-state: ALREADY_ARCHIVED

Content is durable-idea-only (re-stated + re-verified in canonical docs, never copied as current truth).

#### `archive/legacy-docs/d31102a8/ARCHITECTURE.md` — Commit: `d31102a8` · Role: ENG

| Heading (H2) | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Project Directory Structure | Repo layout (drifted) | AI | grep current tree vs doc | ARCHITECTURE → Layout | EXTRACTED |
| 2. System Overview | Component model | AI | read src/ structure | ARCHITECTURE → Overview | EXTRACTED |
| 2. Technology Stack | Stack list (stale) | AI | read package.json | ARCHITECTURE → Stack | EXTRACTED |
| 3. Code Quality Standards | Lint/type/test standards | PROC | read eslint/tsconfig | QUALITY → Standards | EXTRACTED |
| Testing and CI/CD | CI topology (dated) | PROC | read .github/workflows | QUALITY / RELEASE_PROCESS | EXTRACTED |
| 8. Workflow Architecture & Automation | Automation model (dated) | AI | read workflows | ARCHITECTURE → Automation | EXTRACTED |
| 3. Frontend Architecture | React/store/provider structure | AI | read src/providers,stores | ARCHITECTURE → Frontend | EXTRACTED |
| 4. Backend Architecture | Supabase/edge structure | AI | read backend/supabase | ARCHITECTURE → Backend | EXTRACTED |
| 5. Feature Architecture | Feature-module model | AI | read src/components | ARCHITECTURE → Features | EXTRACTED |
| 6. User Roles and Tiers | Tier model | PR | cross-check ENTITLEMENTS_AND_BILLING | ENTITLEMENTS_AND_BILLING | EXTRACTED |
| 5.5 Domain Services Layer | `domainServices.ts` role | AI | grep domainServices.ts | ARCHITECTURE → Services | EXTRACTED |
| 6. Transcription Service | STT service architecture | AI | read services/transcription | ARCHITECTURE + STT | EXTRACTED |
| 7. Configuration Management | Config/env approach (drifted) | AI | read env config | ARCHITECTURE / OPERATIONS_AND_SECURITY | EXTRACTED |
| 9. UI/UX Implementation Standards | UI standards | PROC | read components | ARCHITECTURE → UI | EXTRACTED |
| 10. Performance Optimizations | O(1) analytics, rolling WPM | AI | grep observer/WPM code | ARCHITECTURE / STT | EXTRACTED |
| 15. Resilience Patterns (v5.4) | Watchdog/heartbeat | AI | grep watchdog/heartbeat | ARCHITECTURE → Resilience | EXTRACTED |
| 17. Technical Debt & Known Issues | Historical debt list | GAP | triage vs BACKLOG | ROADMAP (if open) | OPEN_GAP |
| 18. Hardening Patterns & CI Stability | CI stability patterns | PROC | read workflows | QUALITY | EXTRACTED |
| 4. Testing & Deterministic Logic | Deterministic-test approach | PROC | read test setup | QUALITY | EXTRACTED |

#### `archive/legacy-docs/d31102a8/PRD.md` — Commit: `d31102a8` · Role: PO

| Heading (H2) | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Executive Summary | Product one-liner | PR | cross-check PRODUCT_FEATURES | PRODUCT_REQUIREMENTS → Summary | EXTRACTED |
| 2. Vision & Positioning | Private-first positioning | PR | cross-check current positioning | PRODUCT_REQUIREMENTS → Positioning | EXTRACTED |
| 3. UX Standards & Product Guardrails | UX guardrails | PR | cross-check current UX | PRODUCT_REQUIREMENTS → UX | EXTRACTED |
| 4. User Experience & Feedback | Feedback flows | PR | cross-check issue-report code | PRODUCT_REQUIREMENTS | EXTRACTED |
| 5. Testing & Quality Assurance | QA intent | PROC | cross-check QUALITY | QUALITY | EXTRACTED |
| 5. Known Issues & Risks | Historical risks | GAP | triage vs BACKLOG | ROADMAP | OPEN_GAP |
| 6. Development Roadmap | Old roadmap | GAP | triage vs BACKLOG | ROADMAP | OPEN_GAP |
| 6. Software Quality Metrics | Old quality targets | AC | cross-check QUALITY targets | QUALITY | EXTRACTED |
| 8. Metrics and Success Criteria | Conversion/retention/WER targets | PR/AC | cross-check PRD.operational §5 | PRODUCT_REQUIREMENTS + STT | EXTRACTED |
| 9. Future Enhancements / Opportunities | Idea backlog | GAP | triage | ROADMAP → Later | OPEN_GAP |
| 10. Strategic Review & Analysis | Market analysis | HYP | flag unverified | EVIDENCE_INDEX (dated) | EVIDENCE_ONLY |
| 11. Deployment (Alpha Release) | Old deploy notes | HIST | N/A | archive | NO_DURABLE_CONTENT |

#### `archive/legacy-docs/d31102a8/ROADMAP.md` — Commit: `d31102a8` · Role: PO

| Heading(s) (H2) | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Grouped — completed phases: "CI Stability & Observability Hardening", "Live Recording UI & STT Stabilization ✅", "Frontend Verification & Defect Resolution ✅", "Security & Infrastructure Hardening ✅", "Phase 3 Stripe Webhook ✅", "Phase 4 PDF Parsing ✅", "Phase 4 Production Readiness ✅", "Phase 5 Zero-Debt ✅", "Nightly CI Harmonization ✅", "v0.5.4.5 Release Hardening ✅", "Phase 6 Perf & Architecture ✅", "System Integrity & Agent-Loop ✅" | Completed-work narrative (git history is truth) | HIST | N/A (provenance) | archive | NO_DURABLE_CONTENT |
| Quality & Reliability Sprint (Q1 2026 🟡) | Then-open reliability items | GAP | triage vs BACKLOG | ROADMAP | OPEN_GAP |
| Marketing & Growth | Growth ideas | GAP | triage | ROADMAP → Later | OPEN_GAP |
| Phase 1: Stabilize & Harden MVP | MVP hardening items | GAP | triage vs BACKLOG | ROADMAP | OPEN_GAP |
| Phase 2 / Phase 2.5 (User Validation & UI Polish) | Validation/polish items | GAP | triage | ROADMAP | OPEN_GAP |
| Required for any Supabase migration PR | Migration checklist | PROC | read migration convention | RELEASE_PROCESS / OPERATIONS_AND_SECURITY | EXTRACTED |
| Forensic Telemetry & Provisioning FSM (Apr 2026 🟡) | Then-in-progress FSM work | GAP | triage vs BACKLOG | ROADMAP | OPEN_GAP |

#### `archive/legacy-docs/d31102a8/CHANGELOG.md` — Commit: `d31102a8` · Role: PO

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Grouped — all `[x.y.z] - date` entries (0.1.0 → 0.6.19, incl. legacy 1.4.0 / 3.5.4) | Per-release change narrative (git history + `RELEASE_STATUS.md` are truth) | HIST | N/A (provenance) | archive | NO_DURABLE_CONTENT |

> `OUTLINE.md` (`d31102a8`): NO_DURABLE_CONTENT. `USER_GUIDE.md` (`a21e1e52`): EXTRACTED → TESTER_GUIDE (verify: cross-check current tester copy). `research/pricing_analysis.md` (`a21e1e52`): EVIDENCE_ONLY → EVIDENCE_INDEX. `Backend/edge-functions.md` (`a247f62c`): EXTRACTED → ARCHITECTURE → Backend (verify: read backend/supabase/functions). File-state = ALREADY_ARCHIVED.

### 3.B Product / requirements (current) — File-state: ARCHIVE_AT_CLOSEOUT

#### `PRD.operational.md` — Commit: current `main` (⚠️ STALE banner) · Role: PO

| Heading (H2) | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 0. Product Feature Inventory | Pointer to feature doc | PR | N/A | PRODUCT_REQUIREMENTS → Features | EXTRACTED |
| 1. User-Visible Guarantees | Persistence, quotas (1h Free/2h Pro), privacy (audio never leaves browser), no-silent-switch, private-first, cloud-chunk contract | PR | verify each vs code (grep quota, STT switch guard, chunk sizing) | PRODUCT_REQUIREMENTS → Guarantees; billing→ENTITLEMENTS_AND_BILLING | EXTRACTED |
| 2. Failure Behavior | Fail-closed quota, model-download failure, webhook-delay, watchdog 8s, cloud-chunk violation | PR | verify vs code (fail-closed paths) | PRODUCT_REQUIREMENTS → Failure | EXTRACTED |
| 3. Explicit Non-Goals | Bluetooth handoff, Safari offline, multi-tab mutex | PR | cross-check mutex code | PRODUCT_REQUIREMENTS → Non-goals | EXTRACTED |
| 4. Service-Level Expectations | Product-level SL intent | AC | cross-check SERVICE_LEVELS | QUALITY / STT | EXTRACTED |
| 5. Metrics & Success Criteria | WER<10% Private/<8% Cloud; conversion 2%; retention >30%; Native benchmark boundary | AC | verify targets vs STT evidence | PRODUCT_REQUIREMENTS + STT | EXTRACTED |
| 6. Software Quality Evidence | Evidence pointer | EV | N/A | QUALITY | EXTRACTED |

#### `PRODUCT_FEATURES.operational.md` — Commit: current `main` · Role: PO

| Heading (H2) | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Personal Progress & Executive Rehearsal Contract | Canonical progress direction (the Guided/Executive-Rehearsal half is owned by #1046, not by this contract) | PR | cross-check SESSION_PROGRESS | PROGRESS_AND_NEXT_ACTION + PRODUCT_REQUIREMENTS; rehearsal half → ROADMAP (#1046) | EXTRACTED |
| Feature Group Taxonomy | Feature grouping | PR | N/A | PRODUCT_REQUIREMENTS | EXTRACTED |
| Vetted Product Claim Register | Approved marketable claims | PR | verify each claim vs evidence | PRODUCT_REQUIREMENTS → Claims | EXTRACTED |
| Product Surface Summary | Surfaces inventory | PR | cross-check routes | PRODUCT_REQUIREMENTS | EXTRACTED |
| Accepted Feature Candidates & Timing | Roadmap candidates | GAP | triage | ROADMAP | OPEN_GAP |
| Detailed Feature Inventory | Full feature list | PR | cross-check code | PRODUCT_REQUIREMENTS | EXTRACTED |
| Product Positioning | Positioning statement | PR | cross-check RELEASE_STATUS | PRODUCT_REQUIREMENTS | EXTRACTED |
| Current Product Claims Boundary | Claim limits (Native not corpus-WER) | PR | verify vs STT boundary | PRODUCT_REQUIREMENTS + STT | EXTRACTED |
| Related Operational Docs | Cross-links | PROC | N/A | (portal) | NO_DURABLE_CONTENT |

#### `SPEAKSHARP_SESSION_PROGRESS.operational.md` — Commit: current `main` · Role: PO

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| A.0 Why the score is being retired | Score-retirement rationale | PR | N/A (decision) | PROGRESS_AND_NEXT_ACTION → §2 (prohibitions) | EXTRACTED |
| A.1 Baseline: first session is a starting point | First session = baseline not grade | PR | N/A (decision) | PROGRESS_AND_NEXT_ACTION → §5 (baseline) | EXTRACTED |
| A.2 Target source (priority order) | Source priority order | PR | verify vs code target resolution | ROADMAP — target-selection priority order is an OPEN decision for the #1045 implementation family; the v1 contract does not specify it | OPEN_GAP |
| A.3 Progress calculation (two views) | Two views never conflated | PR | verify vs calc code | PROGRESS_AND_NEXT_ACTION → §5 (vs baseline AND vs previous comparable) | EXTRACTED |
| A.4 What every percentage must expose | Transparency requirements — the unit is now points, not a percentage (#1045 decision) | PR | verify vs UI | PROGRESS_AND_NEXT_ACTION → §7a | EXTRACTED |
| A.5 Worked examples (canonical) | Canonical examples | PR | recompute examples | PROGRESS_AND_NEXT_ACTION → §7b | EXTRACTED |
| A.6 Comparable-session contract | Comparability rules | PR | verify vs comparison code | PROGRESS_AND_NEXT_ACTION → §4 (cohort) | EXTRACTED |
| A.7 Outcome Progress (agenda coverage) | Executive-Rehearsal agenda coverage | PR | verify vs rehearsal code | ROADMAP — Guided-Rehearsal agenda coverage, owned by #1046; out of scope for the v1 Progress contract | OPEN_GAP |
| A.8 Summary language (initial) | Initial summary wording | PR | cross-check UI copy | PROGRESS_AND_NEXT_ACTION → §6 (direction language) | EXTRACTED |
| A.9 Completion is not performance | Completion ≠ performance | PR | N/A (decision) | PROGRESS_AND_NEXT_ACTION → §7c | EXTRACTED |
| Reviewer Context | Decision provenance | PR | N/A | PROGRESS_AND_NEXT_ACTION → header metadata (Authority / Supersedes / Evidence Sources) | EXTRACTED |
| Source Of Truth | Which artifact is truth for the score | AI | N/A | PROGRESS_AND_NEXT_ACTION → header metadata (Authority / Supersedes / Evidence Sources) | EXTRACTED |
| Implementation Design | Legacy score impl design | AI | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Signed-Off Architecture Boundary | Boundary of the score subsystem | AI | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| What The Score Means | Score semantics (legacy) | PR | N/A | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Research Anchors | Cited research basis — not carried into the v1 contract | EV | verify citations | EVIDENCE_INDEX (dated research provenance) | EVIDENCE_ONLY |
| Score Weights | Legacy weight table | AI | verify vs code constants | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Formula | Legacy score formula | AI | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Calibration And Bias Testing | Calibration/bias approach for the retired legacy score; the testing approach itself remains owned by QUALITY | AC | verify vs tests | QUALITY (test approach); the legacy 0–10 score itself is retired by the #1045 decision and is not carried forward | EXTRACTED |
| Score Labels | Legacy label bands | PR | cross-check UI | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Confidence Levels | Confidence bands | AI | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| User Experience Rules | Score UX rules | PR | cross-check UI | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| AI Role | AI's role in the legacy score | AI | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Number-To-Coaching Flow | Score→coaching mapping | PR | verify vs code | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |
| Experiment Status | Score experiment status | GAP | triage vs ROADMAP | ROADMAP | OPEN_GAP |
| Future Model Improvements | Planned score-model changes | GAP | triage | ROADMAP → Later | OPEN_GAP |
| Release Guardrail | Score release guardrail | AC | verify vs gates | PROGRESS_AND_NEXT_ACTION does NOT carry the legacy 0–10 score (retired by the #1045 decision); the historical record stays with the archived source | NO_DURABLE_CONTENT |

### 3.C Architecture (current) — File-state: ARCHIVE_AT_CLOSEOUT · Role: ENG

#### `ARCHITECTURE.operational.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 🏛️ Authoritative Sources of Truth | Which artifact is truth for what | AI | cross-check README §1 | ARCHITECTURE → Sources of Truth | EXTRACTED |
| 🛡️ Structural Invariants | No-silent-fallback, singleton controller, mutex, fail-closed | AI | grep each invariant in code | ARCHITECTURE → Invariants | EXTRACTED |
| 🏗️ Operational Components | Component responsibilities | AI | read components | ARCHITECTURE → Components | EXTRACTED |

#### `CODEBASE_MAP.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Product direction | Product-direction breadcrumb (promise→path→test→doc) | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 2. Session / UI (mode hierarchy + post-save) | Session/UI mode hierarchy + post-save map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 3. STT policy / entitlements | STT-policy / entitlement code map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 4. Billing (dual fail-closed) | Billing dual-fail-closed code map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 5. Persistence and feedback (Supabase = source of truth) | Persistence/feedback (Supabase SSOT) map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 6. Security perimeter | Security-perimeter code map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 7. Observability & release operations | Observability/release-ops code map | AI | verify paths/tests exist | ARCHITECTURE → Code Map | EXTRACTED |
| 8. When changing X, update Y | Change-impact breadcrumb | AI | N/A | ARCHITECTURE → Code Map | EXTRACTED |

### 3.D STT (current) — File-state: ARCHIVE_AT_CLOSEOUT · Role: ENG

#### `STT_BASELINE_CONTRACTS.operational.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 2026-06-01 Current Execution Addendum | Current execution notes | AC | cross-check STT evidence | STT → Environment | EXTRACTED |
| Test Environment For Latest Corpus Evidence | Test-env definition | AC | read harness config | STT → Environment | EXTRACTED |
| What "Drop-In" Means | Drop-in definition | AC | N/A | STT → Environment | EXTRACTED |
| Stored Benchmark Targets | Per-engine stored targets | AC | verify vs metrics matrix | STT → Targets | EXTRACTED |
| Published Performance Objectives | Published objectives | AC | verify vs SERVICE_LEVELS | STT → Targets | EXTRACTED |
| Shared Cross-Engine Contract | Cross-engine contract | AC | verify vs code | STT → Contract | EXTRACTED |
| Baseline Matrix | Baseline matrix | AC | verify vs evidence | STT → Matrix | EXTRACTED |
| Gate Status Language | Gate vocabulary | AC | cross-check RC_GATES | STT → Evidence; QUALITY | EXTRACTED |
| Evidence Table Required For Each STT | Required evidence per engine | AC | cross-check evidence files | STT → Evidence | EXTRACTED |
| Deterministic Evidence Collected | Collected deterministic runs | EV | verify artifacts | STT → Evidence; EVIDENCE_INDEX | EVIDENCE_ONLY |
| Full Harvard Corpus Baseline Comparison | Corpus comparison | AC/EV | verify vs artifacts | STT → Matrix | EXTRACTED |
| SpeakSharp Score Eligibility | Which engines benchmarkable (Native=browser behavior only) | PR/AC | verify vs product boundary | STT + PRODUCT_REQUIREMENTS | EXTRACTED |
| Acceptance Targets | Acceptance thresholds | AC | verify vs gates | STT → Targets | EXTRACTED |
| Review Rule | STT review rule | PROC | N/A | STT → Review | EXTRACTED |

#### `PRIVATE_STT_ACCURACY_LEVERS.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Reference baselines | What each number proves | AC/EV | verify vs evidence | STT → Levers | EXTRACTED |
| Lever 1 — Mic-constraint alignment | Mic-constraint lever (do-first) | AC | verify vs code | STT → Levers | EXTRACTED |
| Lever 2 — COI → WASM multithreading | Cross-origin-isolation latency lever | AC | verify vs headers/code | STT → Levers | EXTRACTED |
| Lever 3 — WebGPU acceleration | WebGPU latency lever | AC | verify vs v4 (hard-off) | STT → Levers | EXTRACTED |
| Lever 4 — Model upgrade tiny→base/small | Accuracy-ceiling lever | AC | verify vs model flag | STT → Levers | EXTRACTED |
| Recommended sequence | Ordered plan | GAP | triage | STT → Levers / ROADMAP | OPEN_GAP |

#### `stt-perf-proof-protocol.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Tiered ladder | Top-down early-exit ladder | PROC | N/A | STT → Perf Proof | EXTRACTED |
| Layered measurement | Separate each measured layer | PROC | N/A | STT → Perf Proof | EXTRACTED |
| Cold / warm / hot | Mandatory thermal states | AC | N/A | STT → Perf Proof | EXTRACTED |
| Controls | Attribution controls | PROC | N/A | STT → Perf Proof | EXTRACTED |
| Minimum matrix | Next-pass matrix | AC | N/A | STT → Perf Proof | EXTRACTED |
| Report fields | Required report fields | PROC | N/A | STT → Perf Proof | EXTRACTED |
| Slowdown classification | Classify every result | AC | N/A | STT → Perf Proof | EXTRACTED |
| Decision thresholds | Thresholds set before running | AC | N/A | STT → Perf Proof / (harness step 7) | EXTRACTED |

### 3.E Quality / service-levels / test-inventory (current) — File-state: ARCHIVE_AT_CLOSEOUT · Role: EQ

#### `SOFTWARE_QUALITY.operational.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Evidence Chain | Evidence-chain model | PROC | N/A | QUALITY → Evidence Chain | EXTRACTED |
| 2. Quality Evidence Sources | Source list | PROC | verify sources exist | QUALITY → Sources | EXTRACTED |
| 3. Generated Evidence Files | Generated digests | EV | verify files under evidence/ | QUALITY; EVIDENCE_INDEX | EXTRACTED |
| 4. Current Quality Targets | Coverage/lighthouse/etc. targets | AC | verify vs CI thresholds | QUALITY → Targets | EXTRACTED |
| 5. Interpretation Rules | How to read evidence | PROC | N/A | QUALITY → Interpretation | EXTRACTED |
| 6. Related Documents | Cross-links | PROC | N/A | (portal) | NO_DURABLE_CONTENT |

#### `QUALITY_METRICS.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Current Evidence Files | Evidence file list | EV | verify files | QUALITY; EVIDENCE_INDEX | EVIDENCE_ONLY |
| Release Targets | Release quality targets | AC | verify vs CI | QUALITY → Targets | EXTRACTED |
| Latest Target Vs Measured Digest | Digest table | EV | regenerate digest | EVIDENCE_INDEX | EVIDENCE_ONLY |
| Evidence Closure Rule | Closure rule | PROC | N/A | QUALITY → Interpretation | EXTRACTED |

#### `SERVICE_LEVELS.operational.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Definitions | SLO/SLC/SLA terms | AC | N/A | QUALITY → SLOs | EXTRACTED |
| 2. Soft-Release Targets | Per-metric targets (incl STT latency/WER) | AC | verify vs evidence | QUALITY (general) + STT (STT SLOs) | EXTRACTED |
| 3. Industry Reality Check | Industry comparison | HYP | flag unverified | QUALITY → SLOs (context) | EVIDENCE_ONLY |
| 4. Evidence Mapping | Metric→evidence map (incl STT) | AC | verify links | QUALITY + STT | EXTRACTED |
| 5. Release-Gate Fit | Which SL feeds which gate | AC | cross-check RC_GATES | QUALITY / RELEASE_PROCESS | EXTRACTED |
| 6. Evidence Artifact Expectations | Required artifacts | PROC | N/A | QUALITY | EXTRACTED |

#### `RC_TEST_INVENTORY.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Executive Summary | Inventory summary | AC | N/A | QUALITY → Test Inventory | EXTRACTED |
| Per-File Triage Status | Per-file triage | AC | verify vs test tree | QUALITY | EXTRACTED |
| RC Gate Structure | Gate structure | AC | cross-check RC_GATES | RELEASE_PROCESS / QUALITY | EXTRACTED |
| How Tests Are Decided Into Gates | Gate-assignment rule | PROC | N/A | QUALITY | EXTRACTED |
| STT Corpus Gate Layers | STT corpus layers | AC | cross-check STT | QUALITY + STT | EXTRACTED |
| Contract Source Requirement | Contract-source rule | PROC | N/A | QUALITY | EXTRACTED |
| RC-Counted Browser And Live Ledger | Counted browser/live tests | AC | verify vs workflows | QUALITY | EXTRACTED |
| RC-Counted Unit / Component Ledger | Counted unit tests | AC | verify vs vitest | QUALITY | EXTRACTED |
| Gate Coverage Map | Gate→test map | AC | verify | QUALITY | EXTRACTED |
| Where Workflows Fit | Workflow placement | PROC | read workflows | QUALITY / RELEASE_PROCESS | EXTRACTED |
| Tests Added Or Tightened (latest) | Recent additions | AC | verify vs git | QUALITY | EXTRACTED |
| GitHub Workflows | Workflow inventory | PROC | read .github/workflows | RELEASE_PROCESS | EXTRACTED |
| Script Inventory | Script list | PROC | read scripts/ | QUALITY / RELEASE_PROCESS | EXTRACTED |
| What Counts For Release Confidence | Confidence criteria | AC | N/A | QUALITY | EXTRACTED |
| Current Gaps | Coverage gaps | GAP | triage | ROADMAP | OPEN_GAP |
| Redundancy / Waste Candidates | Waste candidates | GAP | triage | ROADMAP | OPEN_GAP |
| Recommended RC Reporting Format | Report format | PROC | N/A | QUALITY | EXTRACTED |

### 3.F Release process / status / roadmap (current)

#### `RC_GATES.md` — Commit: current `main` · Role: EQ · File-state: ARCHIVE_AT_CLOSEOUT

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Evidence Rules | Gate evidence rules | AC | N/A | RELEASE_PROCESS → Gates | EXTRACTED |
| Gate Summary | 5-gate summary | AC | cross-check workflows | RELEASE_PROCESS → Gates | EXTRACTED |
| Gate 1 - Product Truth | Product-truth gate | AC | verify workflow | RELEASE_PROCESS; QUALITY | EXTRACTED |
| Gate 2 - SAST / Code Review | SAST gate | AC | verify workflow | RELEASE_PROCESS | EXTRACTED |
| Gate 3 - DAST / Running App | Live DAST gate | AC | verify workflow | RELEASE_PROCESS | EXTRACTED |
| Gate 4 - SCA / Dependency Review | SCA gate | AC | verify sca-osv | RELEASE_PROCESS; OPERATIONS_AND_SECURITY | EXTRACTED |
| Gate 5 - UX Smoke | UX-smoke gate | AC | verify workflow | RELEASE_PROCESS; QUALITY | EXTRACTED |
| Observability API Readback | Readback requirements | AC | verify vs providers | RELEASE_PROCESS; OPERATIONS_AND_SECURITY | EXTRACTED |
| Evidence Freshness Contract | Freshness contract | AC | N/A | RELEASE_PROCESS; RELEASE_STATUS | EXTRACTED |
| Named STT Gate Artifacts | Named STT artifacts | AC | verify artifact names | STT + RELEASE_PROCESS | EXTRACTED |

#### `RELEASE_RECOVERY.md` — Commit: current `main` · Role: OPS/EQ · File-state: ARCHIVE_AT_CLOSEOUT

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Recovery Doctrine: Forward-Fix First | Forward-fix doctrine | PROC | N/A | RELEASE_PROCESS → Recovery | EXTRACTED |
| 🚨 Emergency Triage Levels | Triage levels | PROC | N/A | RELEASE_PROCESS → Recovery | EXTRACTED |
| 1. Emergency Rollback Criteria | Rollback criteria | PROC | N/A | RELEASE_PROCESS → Recovery | EXTRACTED |
| 2. Supabase Emergency Patching | Emergency patch steps | PROC | verify vs supabase config | RELEASE_PROCESS; OPERATIONS_AND_SECURITY | EXTRACTED |
| 3. Data Integrity Recovery | Data-integrity recovery (respects L3) | PROC | cross-check PRECEDENCE rules | RELEASE_PROCESS → Recovery | EXTRACTED |
| 4. Communication Protocol | Comms protocol | PROC | N/A | RELEASE_PROCESS → Recovery | EXTRACTED |
| 5. Deployment & schema facts | Deploy/schema facts | AI/RF | verify vs current; move volatile to RELEASE_STATUS | RELEASE_PROCESS; RELEASE_STATUS (volatile) | EXTRACTED |

#### `RELEASE_CLOSEOUT_LEDGER.md` — Commit: current `main` · Role: PO/POQ · File-state: ARCHIVE_AT_CLOSEOUT

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Target state (release-owner) | Older target state | GAP | triage | ROADMAP | OPEN_GAP |
| Live release lane — current status | Stale current-status | RF | move to RELEASE_STATUS | RELEASE_STATUS | NO_DURABLE_CONTENT |
| A. Backlog / disposition ledger | Deferred items | GAP | triage | ROADMAP | OPEN_GAP |
| B. Documentation-gap closures | Recorded doc statuses | EV | verify | EVIDENCE_INDEX | EVIDENCE_ONLY |
| C. Prep-only checklist — SLO/SLC | SLO rig checklist | PROC | cross-check QUALITY | QUALITY / RELEASE_PROCESS | EXTRACTED |
| D. #3 Stripe activation contract | Live-activation contract | PR/PROC | verify vs PAID_OPS | ENTITLEMENTS_AND_BILLING; OPERATIONS_AND_SECURITY | EXTRACTED |
| E. DB hygiene closeout | Historical DB cleanup | EV | N/A (dated) | EVIDENCE_INDEX | EVIDENCE_ONLY |
| Dev posture | Dev posture note | GAP | N/A | ROADMAP | NO_DURABLE_CONTENT |

#### `BACKLOG.md` / `ACTIVE_COORDINATION.md` / `ROADMAP.operational.md` — Commit: current `main` · Role: PO · File-state: ARCHIVE_AT_CLOSEOUT

| Source · Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| BACKLOG · 1 Product Positioning Contract | Positioning invariants | PR | cross-check RELEASE_STATUS | PRODUCT_REQUIREMENTS + ROADMAP | EXTRACTED |
| BACKLOG · 2 Remaining P0 | Open P0 items | GAP | triage | ROADMAP → Now | OPEN_GAP |
| BACKLOG · 3 Remaining P1 | Open P1 items | GAP | triage | ROADMAP → Next | OPEN_GAP |
| BACKLOG · 4 Deferred P2/P3 | Deferred items | GAP | triage | ROADMAP → Later | OPEN_GAP |
| BACKLOG · 5 Triage Rules | Prioritization rules | PROC | N/A | ROADMAP → Triage | EXTRACTED |
| ACTIVE_COORDINATION · Current baseline | References RELEASE_STATUS baseline | RF | move to RELEASE_STATUS | RELEASE_STATUS | NO_DURABLE_CONTENT |
| ACTIVE_COORDINATION · Current work | Working board | GAP | triage | ROADMAP → Now | OPEN_GAP |
| ROADMAP.operational · Risk Matrix | Stale risk matrix (durable risks only) | GAP | triage each row | ROADMAP → Now/Declined | OPEN_GAP |
| ROADMAP.operational · Pre-Launch Hardening (12-hr sprint) | Stale sprint framing | HIST | N/A | ROADMAP (superseded) | NO_DURABLE_CONTENT |
| ROADMAP.operational · Launch Boundary (Deferred) | Declined/deferred boundary | GAP | triage | ROADMAP → Declined | OPEN_GAP |

### 3.G Operations & security (current) — File-state: ARCHIVE_AT_CLOSEOUT · Role: OPS

#### `LAUNCH_ENV_CHECKLIST.md`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| 1. Billing & Payments (Stripe) | Stripe env checklist | PROC | verify vs env | OPERATIONS_AND_SECURITY → Env | EXTRACTED |
| 2. Backend Infrastructure (Supabase) | Supabase env checklist | PROC | verify vs env | OPERATIONS_AND_SECURITY → Env | EXTRACTED |
| 3. Vercel Frontend Environment Safety | Vercel env safety | PROC | verify vs Vercel | OPERATIONS_AND_SECURITY → Env | EXTRACTED |
| 4. Observability & Monitoring | Observability env | PROC | verify vs providers | OPERATIONS_AND_SECURITY → Env | EXTRACTED |
| 5. Third-Party APIs | Third-party API env | PROC | verify vs env | OPERATIONS_AND_SECURITY → Env | EXTRACTED |
| 6. Live Database Entitlement Evidence | Entitlement evidence check | EV | verify vs DB | EVIDENCE_INDEX; ENTITLEMENTS_AND_BILLING | EVIDENCE_ONLY |
| 7. Security & Rate Limiting | Security/rate-limit checklist | PROC | verify vs edge functions | OPERATIONS_AND_SECURITY → Security | EXTRACTED |
| 8. STT feature flags & runtime toggles | STT flag checklist | PROC | verify vs flags | OPERATIONS_AND_SECURITY → Flags | EXTRACTED |
| 🛡️ Verification Protocol | Verification steps | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |

#### `ENV_INVENTORY.md`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Storage Homes (legend) | Env storage legend | PROC | N/A | OPERATIONS_AND_SECURITY → Env Inventory | EXTRACTED |
| `.env.*` file map + minimum set | Env-file map | PROC | verify vs repo | OPERATIONS_AND_SECURITY | EXTRACTED |
| Decisions log | Env decisions | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| 1. Client-public `VITE_*` | Public client vars (not secrets) | PROC | verify vs build | OPERATIONS_AND_SECURITY | EXTRACTED |
| 2. Server-side secrets (Edge, Home C) | Secret inventory (names/scope only) | PROC | verify names vs functions | OPERATIONS_AND_SECURITY → Secrets | EXTRACTED |
| 3. GitHub Actions env (Home D) | Actions secrets vs variables | PROC | verify vs workflows | OPERATIONS_AND_SECURITY | EXTRACTED |
| 4. Vercel Project Env (Home B) | Vercel env inventory | PROC | verify vs Vercel | OPERATIONS_AND_SECURITY | EXTRACTED |
| How to add a NEW env variable | Add-var procedure | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Feature-flag & runtime vars — code-verified sync | Flag/var sync | PROC | grep flags in code | OPERATIONS_AND_SECURITY → Flags | EXTRACTED |
| Draft #1006 — NOT deployed | #1006 draft vars (not shipped) | GAP | cross-check RELEASE_STATUS (#1006 CLOSED) | ROADMAP (if revived) | OPEN_GAP |
| Open decisions affecting this inventory | Open env decisions | GAP | triage | ROADMAP | OPEN_GAP |
| GitHub Actions inventory (tester-evidence audit) | Audit workflow env (names/scope) | PROC | verify vs workflow | OPERATIONS_AND_SECURITY; TESTER_OPERATIONS | EXTRACTED |

#### `SECRET_ROTATION_RUNBOOK.md`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| What Must Be Rotated Or Proved Fake | Rotation inventory | PROC | verify vs secrets | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |
| Automation Reality | Rotation automation limits | PROC | N/A | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |
| Recommended Product-Ops Sequence | Rotation sequence | PROC | N/A | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |
| Verification After Rotation | Post-rotation verification | PROC | N/A | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |
| Ownership | Rotation ownership | PROC | N/A | OPERATIONS_AND_SECURITY → Rotation | EXTRACTED |

#### `PAID_OPS_HARDENING_RUNBOOK.md` — Role: OPS (+PO for billing gating)

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| How the paid path is gated (architecture) | Paid-path gating architecture | AI/PR | grep payment switches in code | OPERATIONS_AND_SECURITY; ENTITLEMENTS_AND_BILLING | EXTRACTED |
| Checklist — verifiable now (no live keys) | Now-verifiable checklist | PROC | run checklist | OPERATIONS_AND_SECURITY | EXTRACTED |
| Live env variable checklist | Live-var checklist (Dev never handles secrets) | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Required live-activation verification + optional smoke | Activation verification | PROC | N/A | ENTITLEMENTS_AND_BILLING; OPERATIONS_AND_SECURITY | EXTRACTED |
| Scope note — not proven here | Scope caveat | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Guardrails honored | Guardrails | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |

#### `OPS_HEALTH_DASHBOARD.md`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Implementation Status | Ops-health impl status | RF | verify vs code | OPERATIONS_AND_SECURITY → Ops Health | EXTRACTED |
| What It Answers | Dashboard scope | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Current V1 Rows | V1 health rows | PROC | verify vs code | OPERATIONS_AND_SECURITY | EXTRACTED |
| GitHub API row — bounded-retry semantics (#990) | Retry/recovery semantics | AI | grep ops-health code | OPERATIONS_AND_SECURITY; ARCHITECTURE | EXTRACTED |
| Status Vocabulary | Status vocabulary | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Security Rules | Ops-health security rules | PROC | N/A | OPERATIONS_AND_SECURITY → Security | EXTRACTED |
| Usage | Usage instructions | PROC | N/A | OPERATIONS_AND_SECURITY | EXTRACTED |
| Work In Progress Checks | WIP checks | GAP | triage | ROADMAP | OPEN_GAP |
| Future Checks | Future checks | GAP | triage | ROADMAP → Later | OPEN_GAP |

#### `SCA_EXCEPTIONS.md`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| GHSA-5xrq — Vitest UI advisory | Single ignored advisory + rationale | PROC/EV | verify vs sca-osv config | OPERATIONS_AND_SECURITY → SCA | EXTRACTED |
| Pinned-audit execution result (2026-07-15) | Dated audit result | EV | N/A (dated) | EVIDENCE_INDEX | EVIDENCE_ONLY |

### 3.H Tester copy — File-state: ARCHIVE_AT_CLOSEOUT

#### `INTERNAL_TEST_PROTOCOL.md` — Commit: current `main` · Role: EQ (engineering) / POQ (tester-ops)

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Release posture | Engineering release posture | PROC | cross-check RELEASE_STATUS | QUALITY | EXTRACTED |
| Pre-invite operator checklist | Operator pre-invite steps | PROC | N/A | TESTER_OPERATIONS | EXTRACTED |
| Entitlement / scope rules | Tester entitlement rules | PR | cross-check ENTITLEMENTS_AND_BILLING | QUALITY; ENTITLEMENTS_AND_BILLING | EXTRACTED |
| Per-tester acceptance criteria | "Successful session" definition | AC | verify vs app | QUALITY → Acceptance | EXTRACTED |
| Session UI truth | What the session screen shows | PR | verify vs UI | QUALITY; PRODUCT_REQUIREMENTS | EXTRACTED |
| Data provenance / observability truth | Provenance/observability facts | AI | verify vs code | QUALITY; ARCHITECTURE | EXTRACTED |
| Browser-support wording | Browser-support statement | PR | verify vs support matrix | QUALITY; TESTER_GUIDE | EXTRACTED |
| Automated first-time-tester proof | Pre-invite automated proof | PROC | run proof | TESTER_OPERATIONS | EXTRACTED |
| Private v4 rollout posture (internal) | v4 internal posture (never in tester guide) | PR | cross-check RELEASE_STATUS | TESTER_OPERATIONS; STT | EXTRACTED |

#### `MANUAL_HARDWARE_VALIDATION.md` — Commit: current `main` · Role: EQ (protocol) / POQ (run)

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Desktop Chrome | Chrome validation protocol | PROC | run protocol | QUALITY (protocol); TESTER_OPERATIONS (run) | EXTRACTED |
| Desktop Safari | Safari protocol | PROC | run protocol | QUALITY; TESTER_OPERATIONS | EXTRACTED |
| Firefox | Firefox protocol | PROC | run protocol | QUALITY; TESTER_OPERATIONS | EXTRACTED |
| iPhone Safari | iPhone protocol | PROC | run protocol | QUALITY; TESTER_OPERATIONS | EXTRACTED |
| Bluetooth / External Mic | Bluetooth/mic protocol | PROC | run protocol | QUALITY; TESTER_OPERATIONS | EXTRACTED |
| Stress / Degraded Conditions | Stress protocol | PROC | run protocol | QUALITY; TESTER_OPERATIONS | EXTRACTED |
| Hardware Evidence Logs | Dated hardware logs | EV | N/A (dated) | EVIDENCE_INDEX | EVIDENCE_ONLY |

#### `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` — Commit: current `main` · Role: PO

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| What is SpeakSharp? | Plain-language intro | PR | cross-check PRODUCT_REQUIREMENTS | TESTER_GUIDE → Intro | EXTRACTED |
| Beta invitation copy | Send-ready invite copy | PR | cross-check RELEASE_STATUS posture | TESTER_GUIDE → Invite | EXTRACTED |
| A simple walkthrough | Tester walkthrough | PROC | verify vs app flow | TESTER_GUIDE → Walkthrough | EXTRACTED |
| What feedback helps most | Feedback guidance | PROC | N/A | TESTER_GUIDE → Feedback | EXTRACTED |

### 3.I Evidence & exploratory (substantive files enumerated) — File-state: RETAINED_EVIDENCE · Role: POQ

#### `PUBLIC_LAUNCH_LEDGER.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Gate Ledger / Phase Plan / Latest Evidence / Next Gate | Broad-launch gate plan | GAP | triage vs ROADMAP | ROADMAP (open gates) | OPEN_GAP |
| Evidence summaries PL-002 · PL-003 · PL-004 · PL-005 · PL-006 · PL-007 (Cloud transcript attempt + provider-level proof) · PL-008 · PL-009 · PL-010 · PL-011 | Dated per-gate proof (Checkout, Entitlement, Billing lifecycle, Access lifecycle, Cloud, AI feedback, PDF, Mobile, Observability) | EV | N/A (dated) | EVIDENCE_INDEX | EVIDENCE_ONLY |

#### `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` — Commit: current `main`

| Heading | Atomic claim | Class | Verify method | Target → § | Content |
|---|---|---|---|---|---|
| Release closeout summary | Entitlement audit closeout | EV | N/A (dated) | EVIDENCE_INDEX | EVIDENCE_ONLY |
| Finding 1a — Pro daily/monthly limit requirement | Pro daily/monthly limit (policy constant) | PR | verify policy const in code | ENTITLEMENTS_AND_BILLING → Limits | EXTRACTED |
| Finding 1b — Pro limit const-vs-DB reconciliation | Open ops: const vs deployed DB mismatch | GAP | verify deployed DB value | ROADMAP | OPEN_GAP |
| Finding 2: overlapping usage functions | Divergent usage fns | GAP | grep usage functions | ROADMAP | OPEN_GAP |
| Verified OK | Verified facts | EV | N/A | EVIDENCE_INDEX | EVIDENCE_ONLY |
| Open / needs-ops | Open ops items | GAP | triage | ROADMAP | OPEN_GAP |

> `evidence/**` (beta50 packets, private-path validation, STT release reports, metrics matrix, generated digests) and `v4_work/**` (5 md, v4 hard-off exploration): all **EVIDENCE_ONLY / RETAINED_EVIDENCE**, indexed by EVIDENCE_INDEX; any embedded requirement/gap is routed (requirement→canonical, gap→ROADMAP) at EVIDENCE_INDEX build. `attribution-sanitation-crosswalk.md`: NO_DURABLE_CONTENT (provenance), semantics ALREADY_ARCHIVED.

---

## 4. Current-state corrections (from superseded PR #1031) — applied to `RELEASE_STATUS.md` in the foundation step

PR [#1031](https://github.com/relativityE/speaksharp/pull/1031) (closed, superseded) flagged stale current-state facts. The foundation step repairs `RELEASE_STATUS.md` directly (the SSOT), so the corrections are *applied*, not merely recorded. Read the current values from `RELEASE_STATUS.md` — the kinds of correction (no changing SHAs here):

- **Baselines** now distinguish repo `main` (moving pointer), last product-behavior release, later docs/audit/tooling commits, and the deployed release (`window.__APP_RELEASE__`).
- **Release mechanism** corrected to `window.__APP_RELEASE__` (the `__BUILD_ID__` define was removed in #1027; Sentry `release.inject:false`).
- **#1006 corrected to CLOSED** (no longer current work).
- **Posture** updated to `/practice` default (#1022), stale-chunk P0 (#1027), issue-report hygiene (#1024); audit tooling #1028–#1030 = no product-behavior change.
- **STT/tester wording** corrected (Browser method name + "Quick preview" descriptor badge, #1041; v2 default; v4 hard-off; Cloud paid-Pro-only).

---

## 5. The Browser STT naming decision (#1041 Option B, shipped)

**Decision (SHIPPED — #1041, merged via PR #1060):** the user-facing **transcription-method name is "Browser"** (replacing user-facing "Native"), with **"Quick preview" retained as a secondary descriptor badge** on the Browser option. This **supersedes** the earlier **"Quick Preview (Browser)"** primary-label proposal (retired). "Quick Practice" (the retired *product* name → Freestyle Practice, #1042) is a separate concept — not to be conflated with the "Quick preview" descriptor.
- **Scope:** display label + truthful copy **only**. Internal engine token, telemetry, and DB `engine`/`mode` values remain **`native`** — unchanged.
- **Shipped copy (#1041):** *"Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended."*
- **Guardrails:** never claim **local, offline, on-device, Private-equivalent, or cross-browser-consistent** (Chrome routes audio to Google). Convenience preview, not a benchmarked path, never an automatic fallback.
- **Status:** implementation shipped in PR #1060; this docs-only successor reconciles the authority record. Canonical docs must use this truthful wording.

---

## 6. Known gaps & open decisions

1. **Canonical set is Product Owner-approved** (`README.md` §2). New-file names fixed.
2. **PRODUCT_REQUIREMENTS (PRD v1) — WRITTEN (#1038).** `product_release/PRODUCT_REQUIREMENTS.md` is the canonical requirements authority, consolidating the interim `PRD.operational.md` + `PRODUCT_FEATURES.operational.md` (both banner-marked stale; archived at closeout). `RELEASE_STATUS.md` remains authoritative for current release status.
3. **ARCHITECTURE (v1) — WRITTEN (#1039).** `product_release/ARCHITECTURE.md` is the canonical structure & authority-ADR document, consolidating the interim `ARCHITECTURE.operational.md` + `CODEBASE_MAP.md` (both EXTRACTED; archived at closeout). The entitlement-authority ADR (server-side authoritative; payment status vs capability entitlements are distinct; comped/legacy grants allowed; quotas/pricing/comped-policy owned by #1053) and the storage/retention-boundary ADR (Private audio never persists; retention-duration & deletion policy remain unresolved) are recorded there. **STT ADRs pending (#1040).**
4. **ENTITLEMENTS_AND_BILLING (v1) — WRITTEN (#1053).** `product_release/ENTITLEMENTS_AND_BILLING.md` is the canonical tier/entitlement/billing contract, reconciling `PRD.operational.md` §1 + `PAID_OPS_HARDENING_RUNBOOK.md` + `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (Finding 1) under a five-category provenance split (observed-code / deployed-DB / marketing / PO-approved / unresolved). Numeric quotas are documented as **observed code / migration-seeded configuration only — provisional, subject to change, and NOT approved policy or customer commitments**. Final quotas/pricing/packaging/unlimited-positioning/comped-access remain **unresolved product decisions** → ROADMAP, timed to later product/pricing work informed by readiness + usage evidence.
5. **Private v2 ≈90s finalize** = accepted RC limitation, **not** a measured p95 — STT.md must state it so.
6. **`ENTITLEMENT_PRO_LIMIT_EVIDENCE` open item** overlaps BACKLOG P1.3 → ROADMAP.
7. **Sequencing** — one reconciliation PR at a time; final PR archives superseded files → exactly 14 canonical + this ledger archived.
8. **TESTER_GUIDE / TESTER_OPERATIONS / EVIDENCE_INDEX (v1) — WRITTEN (#1050).** The final content triad is materialized by extract-and-verify, keeping external tester copy strictly separate from internal operations and indexing dated evidence without promoting it to current truth:
   - `TESTER_GUIDE.md` (#12) = the **external** tester-facing copy, extracted from `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` (EXTRACTED; §3.H) and reconciled to shipped mode wording (#1041/#1064; §5) — the stale "Recommended" descriptor is dropped.
   - `TESTER_OPERATIONS.md` (#13) = **internal** tester administration, extracting the operator/run parts of `INTERNAL_TEST_PROTOCOL.md` + `MANUAL_HARDWARE_VALIDATION.md` (EXTRACTED (split); §3.H — the engineering/quality parts already went to `QUALITY.md` via #1049 and are referenced, not duplicated), the broad-launch operations of `PUBLIC_LAUNCH_LEDGER.md`, and the entitlement ops items of `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`; open gaps route to `ROADMAP.md`.
   - `EVIDENCE_INDEX.md` (#14) = an **index** of dated proof artifacts by path + date (`evidence/**`, §3.I retained evidence, generated digests), framed as historical evidence that reflects the moment it was captured and is **not** current release posture. Volatile run IDs / SHAs / current pass-fail posture stay in `RELEASE_STATUS.md`.

---

## 7. Ledger validation (committed, CI-wired test)

A deterministic documentation-contract test — [`tests/config/documentationContract.test.ts`](../tests/config/documentationContract.test.ts) — runs under `pnpm test:unit` (the **CI - Test Audit** gate) and asserts: exactly 14 canonical names; every pre-foundation root Markdown is mapped in this ledger; the required metadata fields on `README.md` / `RELEASE_STATUS.md` / `PRODUCT_REQUIREMENTS.md` / this ledger (each promoted canonical document is added here as it lands); single-value content dispositions (no compound cells); every EXTRACTED row has a canonical target heading; relative links in the governed docs resolve; every retained-evidence file has an exact destination; no resolved finding is preserved as an open/unmerged gap; volatile release identity (SHAs) appears only in `RELEASE_STATUS.md`; the closeout leaves exactly 14 root files. It is a real test, not an ad-hoc check.

---

*Temporary migration record, archived at closeout. No changing release status; that lives only in [`RELEASE_STATUS.md`](./RELEASE_STATUS.md).*

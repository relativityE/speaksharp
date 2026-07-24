**Status:** Authoritative (canonical portal)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Last Verified:** 2026-07-24 (canonical set, precedence model, and links verified against the repo tree)
**Applies To:** All SpeakSharp product/release documentation under `product_release/`
**Class:** Procedure (documentation portal)
**Authority:** Entry point, precedence model, and canonical-document map — the SSOT for *documentation structure and authority*.
**Not Authoritative For:** current release/deployment status (→ `RELEASE_STATUS.md`); PR/merge state (→ the PR description).
**Supersedes:** `content_list.md`; absorbs `PRECEDENCE.md` (§1).
**Evidence Sources:** the 14 canonical documents (§2) and `DOC_MIGRATION_LEDGER.md`.

# SpeakSharp Documentation Portal

This is the entry point and authority map for SpeakSharp documentation. It defines the **precedence model** used to resolve conflicts, the **14 canonical documents** that will be the only active product docs at the root of `product_release/` after migration, the **classification/disposition taxonomies**, and the **metadata schema**.

It replaces [`content_list.md`](./content_list.md) as the index and **absorbs [`PRECEDENCE.md`](./PRECEDENCE.md)** (its conflict-resolution rules live in §1 below). The source-by-source, section-level migration record is in [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md).

> **The migration model.** The canonicalization proceeds as a sequence of docs-only reconciliation steps. The foundation establishes this portal, the section-level extraction ledger, the pinned historical sources, and the repaired `RELEASE_STATUS.md`. Consolidation into the 14 targets happens in subsequent single-topic steps; the final step moves superseded active files into `archive/`/`evidence/` and leaves **exactly 14** canonical Markdown files at the root of `product_release/`. During the migration the active root count is temporarily higher than 14. `DOC_MIGRATION_LEDGER.md` is **temporary** — archived at closeout; it is **not** a fifteenth canonical document. The migration changes no code, telemetry, DB values, or product behavior.

---

## 1. Precedence model (conflict resolution)

*(Absorbs `PRECEDENCE.md` in full — the hierarchy of truth, the canonical-release-artifact rule, and the enforcement protocol below are its durable content.)*

Documentation describes a product bound by promises. Precedence is therefore **not** "whatever the code does wins." A conflict between layers is a **release event**, not a silent pick.

### Hierarchy of truth (highest binding authority first)

| Level | Domain | Scope |
|---|---|---|
| **1** | **User Trust & Legal Promises** — the binding constraints | PRD + Billing + Privacy + Security promises (e.g. "Private STT audio never leaves the browser," "no silent switch to a paid/cloud engine," "billing fails closed") |
| **2** | **Runtime Truth** — observed behavior | Deployed code + DB schema + edge functions + env config |
| **3** | **Data Integrity Invariants** | ACID/atomicity/schema consistency |
| **4** | **Security Invariants** | RLS + JWT validation + CSRF + rate limiting |
| **5** | **Operational Survivability** | Availability + latency + error recovery |
| **6** | **Tests / CI Evidence** | E2E + unit + integration + static analysis |
| **7** | **Architecture Intent / Docs** | `ARCHITECTURE.md` + design docs |
| **8** | **Roadmap / Status / Triage** | Current status + backlog + triage |

### Durable rules (carried from `PRECEDENCE.md`)

- **Normative obligations bind.** If shipped behavior violates a Level-1 promise, the behavior is **wrong** — the promise does not bend to the code.
- **Runtime truth is observed, not exculpatory.** The system is what it *does* (Level 2), and Level-2 reality overrides stale prose (a doc that disagrees with code is **Drift**; code that violates intent is a **Vulnerability**). But **runtime truth never excuses violating a Level-1/3/4 obligation** — an obligation-vs-implementation conflict is a **release blocker requiring reconciliation** (fix the code, or change the promise through an explicit, owner-approved decision), never "the code is therefore correct."
- **Silent data corruption is categorically worse than an outage.** A feature that cannot guarantee data integrity MUST fail closed or be disabled, **even if that causes a service outage** (Level 3 > Level 5).
- **Never trade security for survivability.** A Security Invariant (Level 4) may **not** be bypassed to restore Survivability (Level 5). Establish runtime state (Level 2) before attempting recovery (Level 5); recovery must respect Data Integrity (Level 3).
- **Tests/CI are evidence, not truth.** Level-6 evidence sits **below** runtime truth and obligations; a green suite does not override a Level-1/2/3 reality.
- **Architecture drift is classified, not automatically a trust violation.** A Level-7 doc/code divergence is "launch polish" **unless** it cascades into Levels 1–4, in which case it inherits their severity.
- **Canonical release-artifact rule.** Current release status may be taken **only** from [`RELEASE_STATUS.md`](./RELEASE_STATUS.md) (SSOT). Older reports/audits are historical evidence; if they conflict with `RELEASE_STATUS.md`, current workflow results, or deployed runtime, the newer canonical source wins.

### Enforcement (Go/No-Go)

- Any violation of **Level 1 (User Trust)** or **Level 3 (Data Integrity)** is an **AUTOMATIC NO-GO**.
- Level-7 (Architecture Intent) violations are "polish" unless they cascade into Levels 1–4.

Below these layers sit **evidence** (dated proof; cite for rationale, never current status) and **archive/legacy** (historical, non-authoritative).

---

## 2. The 14 canonical documents (Product Owner-approved)

After migration, these — and only these — are the active canonical Markdown products at the root of `product_release/`:

| # | Canonical document | Owns (authority) | Primary class | Consolidates (interim sources) |
|---|---|---|---|---|
| 1 | **README.md** *(this file)* | Portal, precedence model, taxonomies, metadata schema | Procedure | `content_list.md`, `PRECEDENCE.md` |
| 2 | **PRODUCT_REQUIREMENTS.md** | User-visible guarantees, failure behavior, non-goals, feature contract | Product requirement | `PRD.operational.md`, `PRODUCT_FEATURES.operational.md`, historical `docs/PRD.md` |
| 3 | **ROADMAP.md** | Now / Next / Later / Declined — all unfinished & deferred work | Open gap / risk | `BACKLOG.md`, `ACTIVE_COORDINATION.md`, `ROADMAP.operational.md`, `RELEASE_CLOSEOUT_LEDGER.md`, historical `docs/ROADMAP.md` |
| 4 | **ARCHITECTURE.md** | Structural invariants, authoritative sources of truth, durable design decisions (ADRs), code map | Architecture invariant / ADR | `ARCHITECTURE.operational.md`, `CODEBASE_MAP.md`, historical `docs/ARCHITECTURE.md` |
| 5 | **STT.md** | STT baselines, contracts, accuracy/perf, STT-specific SLOs | Acceptance criterion / SLO | `STT_BASELINE_CONTRACTS.operational.md`, `PRIVATE_STT_ACCURACY_LEVERS.md`, `stt-perf-proof-protocol.md`, STT-specific SLOs from `SERVICE_LEVELS.operational.md` |
| 6 | **COACHING_SCORE.md** | Session Progress / scoring model contract (Personal Progress direction + legacy score retirement) | Product requirement / decision | `SPEAKSHARP_SESSION_PROGRESS.operational.md`, scoring material in historical `docs/PRD.md` |
| 7 | **ENTITLEMENTS_AND_BILLING.md** | Tier/entitlement rules, quota limits, billing gating requirements | Product requirement | entitlement/billing requirements from `PRD.operational.md`; requirements distilled from `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (evidence stays evidence) |
| 8 | **QUALITY.md** | Quality-evidence taxonomy, general SLOs, engineering test protocol, RC test acceptance detail | Procedure / SLO | `SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md`, general `SERVICE_LEVELS.operational.md`, `RC_TEST_INVENTORY.md`, engineering parts of `INTERNAL_TEST_PROTOCOL.md` / `MANUAL_HARDWARE_VALIDATION.md` |
| 9 | **RELEASE_PROCESS.md** | Release-gate definitions, release workflow, recovery/rollback | Acceptance criterion / procedure | `RC_GATES.md`, `RELEASE_RECOVERY.md`, release-workflow material |
| 10 | **RELEASE_STATUS.md** | Current release/deployment posture (**SSOT**) | Runtime fact | `RELEASE_STATUS.md` (unchanged) |
| 11 | **OPERATIONS_AND_SECURITY.md** | Env/secrets/config, rotation, paid-ops hardening, ops-health, SCA exceptions, security | Procedure | `LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md` |
| 12 | **TESTER_GUIDE.md** | Plain-language external tester-facing guide | Procedure | `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` |
| 13 | **TESTER_OPERATIONS.md** | Internal tester administration, audit procedures, tester-ops protocols | Procedure | tester-ops parts of `INTERNAL_TEST_PROTOCOL.md`, tester-facing manual-hardware procedures |
| 14 | **EVIDENCE_INDEX.md** | Index of all dated evidence (launch/entitlement/STT/test) | Evidence (index) | indexes `evidence/`, `PUBLIC_LAUNCH_LEDGER.md`, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` |

### Accountable-role map

Ownership is per-document by accountable role (Product Owner remains final approver on all). Technical verification is owned by the relevant engineering/quality/ops role, not blanket Product Owner:

| Role | Canonical documents |
|---|---|
| **Product Owner** | PRODUCT_REQUIREMENTS, ROADMAP, COACHING_SCORE, ENTITLEMENTS_AND_BILLING (product policy), TESTER_GUIDE |
| **Engineering** | ARCHITECTURE, STT (implementation contracts) |
| **Engineering / Quality** | QUALITY, RELEASE_PROCESS |
| **Operations / Security** | OPERATIONS_AND_SECURITY |
| **Product Operations / Quality** | TESTER_OPERATIONS, EVIDENCE_INDEX |
| **Product Owner (SSOT)** | RELEASE_STATUS, README |

**Retained by classification, NOT canonical (indexed by `EVIDENCE_INDEX.md` or kept in `archive/`):**
- **Evidence** (dated proof; cite for rationale): `evidence/**`, `PUBLIC_LAUNCH_LEDGER.md`, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`.
- **Superseded / historical**: `attribution-sanitation-crosswalk.md`, `archive/**`, `archive/legacy-docs/**`, and — at closeout — `content_list.md`, `DOC_MIGRATION_LEDGER.md`.
- **Exploratory** (not release-path): `v4_work/**` — reference for the deferred Private v4 disposition.

---

## 3. Classification taxonomy

| Classification | Meaning | Canonical home |
|---|---|---|
| **Product requirement / decision** | A user-visible guarantee or product choice | PRODUCT_REQUIREMENTS / COACHING_SCORE / ENTITLEMENTS_AND_BILLING |
| **Runtime fact** | Current, changing state | RELEASE_STATUS |
| **Architecture invariant / ADR** | A structural rule or recorded design decision | ARCHITECTURE |
| **Acceptance criterion / SLO** | A measurable pass/fail threshold or service target | STT / QUALITY / RELEASE_PROCESS |
| **Procedure** | Repeatable operator/dev/tester steps | RELEASE_PROCESS / OPERATIONS_AND_SECURITY / TESTER_GUIDE / TESTER_OPERATIONS |
| **Evidence** | Dated proof of a past claim | EVIDENCE_INDEX → `evidence/**` |
| **Open gap / risk** | Unfinished or at-risk work | ROADMAP |
| **Superseded history** | Formerly-true, kept for provenance | `archive/**` |
| **Unverified hypothesis** | A claim not yet proven | ROADMAP (flagged) |

---

## 4. Disposition taxonomy

Two independent axes. Every ledger row carries **exactly one content disposition** *and* one source-file state — they are never combined into a single value.

**Content disposition** (what happens to the *content*):

| Disposition | Meaning |
|---|---|
| **EXTRACTED** | Durable content lifts into a canonical document (later PR). |
| **EVIDENCE_ONLY** | Kept as dated evidence; indexed, not promoted to a contract. |
| **OPEN_GAP** | Names unfinished work; routes to ROADMAP. |
| **NO_DURABLE_CONTENT** | Nothing worth carrying forward; archive/retire only. |

**Source-file state** (what happens to the *file* — this axis, not content disposition, carries the "superseded/archived" idea):

| State | Meaning |
|---|---|
| **ACTIVE** | Remains a canonical active file. |
| **RETAINED_EVIDENCE** | Kept under `evidence/`. |
| **ARCHIVE_AT_CLOSEOUT** | Moved to `archive/` after its durable content is proven-incorporated. |
| **ALREADY_ARCHIVED** | Already under `archive/`. |

A source with durable content that will be retired is therefore **content=EXTRACTED, file-state=ARCHIVE_AT_CLOSEOUT** — never "SUPERSEDED" as a content disposition. A single atomic claim that is *both* a durable requirement *and* an open gap is split into two rows (one EXTRACTED, one OPEN_GAP).

---

## 5. Metadata schema

Each canonical document carries this header:

```
**Status:** <Authoritative | Draft | ⚠️ STALE — UNDER REVISION>
**Owner:** <accountable role — see §2 role map>
**Last Reviewed:** <YYYY-MM-DD prose was last read by a human>
**Last Verified:** <YYYY-MM-DD the factual claims were last checked against current code/runtime/evidence>
**Applies To:** <scope: which product surface / release track>
**Class:** <classification from §3>
**Authority:** <what this doc is the SSOT for, one line>
**Not Authoritative For:** <what readers must NOT take from this doc — e.g. current status → RELEASE_STATUS.md>
**Supersedes:** <prior docs this replaces, if any>
**Evidence Sources:** <links to the code/tests/evidence backing the claims>
```

**`Last Reviewed` ≠ `Last Verified`.** Review means a human read the prose; **verification** means its factual claims were checked against current code, runtime, or dated evidence. A canonical doc may be recently reviewed yet unverified — the two dates make that explicit.

`RELEASE_STATUS.md` additionally carries the **Update rule** (only it receives changing status) and the **Evidence Freshness Contract**. Stale contracts are **banner-marked** (`⚠️ STALE — UNDER REVISION`), never silently trusted.

**Execution plans are not documents.** Per Product Owner decision, there is **no permanent `docs/proposals/` collection**. PR execution plans live in GitHub issues / PR descriptions; durable design decisions belong in `ARCHITECTURE.md`; superseded proposals go to `archive/`.

---

## 6. Archive & legacy docs

- [`archive/`](./archive/) — historical evidence and superseded release material. See [`archive/README.md`](./archive/README.md).
- [`archive/legacy-docs/`](./archive/legacy-docs/) — **pinned, read-only** copies of the pre-consolidation `docs/*.md` sources at their exact source commit, each with a non-authoritative banner. Provenance:
  - `d31102a8/` — `ARCHITECTURE.md`, `PRD.md`, `ROADMAP.md`, `CHANGELOG.md`, `OUTLINE.md`.
  - `a21e1e52/` — `USER_GUIDE.md`, `research/pricing_analysis.md`.
  - `a247f62c/` — `Backend/edge-functions.md`.

---

## 7. Related records

- [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md) — section-level source→target inventory, dispositions, owners, and the Quick Preview (Browser) decision. **Temporary**; archived at closeout.
- [`RELEASE_STATUS.md`](./RELEASE_STATUS.md) — current posture (SSOT).

*This portal is navigational and structural. It records no changing release status; that lives only in `RELEASE_STATUS.md`.*

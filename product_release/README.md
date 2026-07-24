**Owner:** Prod Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Class:** Procedure (documentation portal)
**Authority:** Entry point, precedence model, and canonical-document map for SpeakSharp product/release docs.
**Status:** Foundation PR — establishes the **Product Owner-approved** canonical system. **Unmerged, pending Product Owner approval.**

# SpeakSharp Documentation Portal

This is the entry point and authority map for SpeakSharp documentation. It defines the **precedence model** used to resolve conflicts, the **14 canonical documents** that will be the only active product docs at the root of `product_release/` after migration, the **classification/disposition taxonomies**, and the **metadata schema**.

It replaces [`content_list.md`](./content_list.md) as the index and **absorbs [`PRECEDENCE.md`](./PRECEDENCE.md)** (its conflict-resolution rules live in §1 below). The source-by-source, section-level migration record is in [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md).

> **What this PR is.** This establishes the approved canonical **system** and the complete extraction **ledger**. The **actual consolidation is PRs 2–6**; the final PR moves superseded active files into `archive/` and leaves **exactly 14** canonical active Markdown files. During migration the active root count **temporarily increases** (this PR adds the portal + ledger + pinned history). `DOC_MIGRATION_LEDGER.md` is **temporary** — archived at migration closeout; it is **not** a fifteenth canonical document.
>
> **What this PR is not.** It does not delete/move/rewrite any active document, and it changes **no** code, telemetry, DB values, or product behavior. No PRD/STT/attribution/entitlement/UI-label/harness implementation happens on this branch.

---

## 1. Precedence model (conflict resolution)

Documentation describes a product bound by promises. Precedence is therefore **not** "whatever the code does wins." Four distinct layers, and a conflict between them is a **release event**, not a silent pick:

1. **Normative obligations — the binding constraints.** User-trust, privacy, legal, and billing promises (e.g. "Private STT audio never leaves the browser," "no silent switch to a paid/cloud engine," "billing fails closed"). These are **release constraints**. If shipped behavior violates one of them, the behavior is **wrong** — the promise does not bend to the code.
2. **Observed implementation — what the code/runtime actually does.** Authoritative for *describing current behavior*, and it overrides stale prose. But when it conflicts with a layer-1 obligation, that conflict is a **release blocker requiring reconciliation** (fix the code, or change the promise through an explicit, owner-approved decision) — never "the code is therefore correct."
3. **Current operational status.** [`RELEASE_STATUS.md`](./RELEASE_STATUS.md) is the single source of truth (SSOT) for changing state: baselines, deploy posture, run IDs, blockers, go/no-go. No other document records changing status.
4. **Canonical contracts & procedures.** The 14 documents below — authoritative for *what the product promises and how it is built/operated*, subordinate to the live status in (3).

**Resolution rule:** obligation (1) vs. implementation (2) disagreement → **reconcile before release** (blocker). Contract (4) vs. live status (3) → status wins for *current* facts; the contract is corrected. Any document vs. `RELEASE_STATUS.md` on changing state → `RELEASE_STATUS.md` wins.

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

Every source section in the ledger carries exactly one:

| Disposition | Meaning |
|---|---|
| **EXTRACTED** | Durable content lifts into a canonical document (later PR). |
| **EVIDENCE_ONLY** | Kept as dated evidence; indexed, not promoted to a contract. |
| **SUPERSEDED** | Replaced by a canonical document; retained read-only for history. |
| **OPEN_GAP** | Names unfinished work; routes to ROADMAP. |
| **NO_DURABLE_CONTENT** | Nothing worth carrying forward; archive/retire only. |

---

## 5. Metadata schema

Each canonical document carries:

```
**Owner:** <role/person accountable>
**Last Reviewed:** <YYYY-MM-DD>
**Class:** <classification from §3>
**Authority:** <what this doc is the SSOT for, one line>
```

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

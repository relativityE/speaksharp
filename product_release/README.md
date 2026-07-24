**Owner:** Prod Owner (relativityE)
**Last Reviewed:** 2026-07-24
**Status:** Foundation PR — proposed canonical system, **unmerged, pending Product Owner approval.**

# SpeakSharp Documentation Portal

This is the entry point and authority map for SpeakSharp product/release documentation. It defines the **canonical document set**, the **precedence order** used to resolve conflicts, the **classification and disposition taxonomies** used across the corpus, and the **metadata schema** every canonical document carries.

It replaces [`content_list.md`](./content_list.md) as the index. The full source-by-source migration record lives in [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md).

> **Scope of this PR.** This is the *foundation* of the documentation-canonicalization effort. It **adds** this portal, the migration ledger, and pinned historical sources under [`archive/legacy-docs/`](./archive/legacy-docs/). It does **not** delete, move, rewrite, or re-home any active document, and it changes **no** code, telemetry, DB values, or product behavior. Subsequent reconciliation PRs (one at a time) perform the actual consolidation described here.

---

## 1. Authority & precedence

Truth is layered. When two documents disagree, the higher layer wins:

1. **Code, migrations, tests, and CI on `main`** — the executable truth. A document that contradicts shipped code is wrong.
2. **[`RELEASE_STATUS.md`](./RELEASE_STATUS.md)** — single source of truth (SSOT) for *current* release/deployment posture, baselines, blockers, and go/no-go. Nothing else records changing status.
3. **[`PRECEDENCE.md`](./PRECEDENCE.md)** — the formal truth hierarchy and conflict-resolution procedure. Consult it whenever the layering above is ambiguous.
4. **Canonical operational contracts** (PRD, Architecture, STT contracts, Service Levels, Software Quality, RC Gates) — stable guarantees and invariants. Authoritative for *what the product promises and how it is structured*, not for *current status*.
5. **Procedures & tester copy** (Ops runbook, Test protocol, Tester instructions) — how to operate, validate, and onboard.
6. **Evidence** (`evidence/`, `PUBLIC_LAUNCH_LEDGER.md`, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`) — dated proof. Cite for *rationale*, never for *current status*.
7. **Archive & legacy docs** (`archive/`, `archive/legacy-docs/`) — historical/superseded. Non-authoritative; retained for provenance only.

**Rule of thumb:** current status → `RELEASE_STATUS.md`; what/why → PRD; how it's built → Architecture; is it proven → Evidence/RC Gates; what's left → `BACKLOG.md`.

---

## 2. The canonical document set (proposed)

The target state consolidates ~33 active root documents into the **14 canonical documents** below. Several canonical documents do not yet exist as a single file; their **interim sources** are the current authoritative files, to be consolidated in later reconciliation PRs. Nothing here is deleted in this PR.

> The 14-document target is **proposed for Product Owner confirmation**. The mapping from every existing file to its target is enumerated in [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md); open naming/boundary questions are listed there under "Known gaps & decisions."

| # | Canonical document | Owns (authority) | Class | Interim source(s) | Cadence |
|---|---|---|---|---|---|
| 1 | **README.md** *(this file)* | Documentation portal, authority map, taxonomies, metadata schema | Procedure | — (replaces `content_list.md`) | On corpus change |
| 2 | **RELEASE_STATUS.md** | Current release/deployment posture, baselines, blockers, go/no-go (**SSOT**) | Runtime fact | `RELEASE_STATUS.md` | Every deploy / status change |
| 3 | **PRECEDENCE.md** | Truth hierarchy & conflict resolution | Procedure | `PRECEDENCE.md` | Rare |
| 4 | **PRD.md** *(v1, to be written)* | Product requirements, user-visible guarantees, failure behavior, non-goals | Product requirement | `PRD.operational.md`, `PRODUCT_FEATURES.operational.md`, `SPEAKSHARP_SESSION_PROGRESS.operational.md`, `docs/PRD.md` (historical) | On product decision |
| 5 | **ARCHITECTURE.md** *(canonical)* | Structural invariants, authoritative sources of truth, ADRs | Architecture invariant / ADR | `ARCHITECTURE.operational.md` | On architecture decision |
| 6 | **CODEBASE_MAP.md** | Product intent → code path → protecting test → doc | Architecture invariant | `CODEBASE_MAP.md` | On structural change |
| 7 | **STT_CONTRACTS.md** *(canonical)* | STT baselines, accuracy/perf contracts, proof protocols | Acceptance criterion / SLO | `STT_BASELINE_CONTRACTS.operational.md`, `PRIVATE_STT_ACCURACY_LEVERS.md`, `stt-perf-proof-protocol.md` | On STT contract change |
| 8 | **SERVICE_LEVELS.md** *(canonical)* | SLO/SLC/SLA terms, targets, classification | Acceptance criterion / SLO | `SERVICE_LEVELS.operational.md` | On SLO change |
| 9 | **SOFTWARE_QUALITY.md** *(canonical)* | Quality-evidence taxonomy, interpretation, digest | Procedure / evidence | `SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md` | On quality-policy change |
| 10 | **RC_GATES.md** | Release-gate definitions, evidence requirements, counted test/workflow inventory | Acceptance criterion | `RC_GATES.md`, `RC_TEST_INVENTORY.md` | On gate change |
| 11 | **TEST_PROTOCOL.md** *(canonical)* | Operator/dev acceptance protocol + manual hardware/browser validation | Procedure | `INTERNAL_TEST_PROTOCOL.md`, `MANUAL_HARDWARE_VALIDATION.md` | On protocol change |
| 12 | **TESTER_INSTRUCTIONS.md** *(canonical)* | Plain-language tester-facing guide | Procedure | `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | Per tester wave |
| 13 | **OPS_RUNBOOK.md** *(canonical)* | Env/secrets/config, rotation, paid-ops hardening, recovery, ops-health, SCA exceptions | Procedure | `LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `RELEASE_RECOVERY.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md` | On ops change |
| 14 | **BACKLOG.md** | Unfinished work, active-coordination board, risk tracker | Open gap / risk | `BACKLOG.md`, `ACTIVE_COORDINATION.md`, `ROADMAP.operational.md` (stale), `RELEASE_CLOSEOUT_LEDGER.md` | Continuous |

**Not among the 14 (retained by classification):**
- **Evidence** (dated proof, cite for rationale): everything under `evidence/`, plus `PUBLIC_LAUNCH_LEDGER.md`, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`.
- **Superseded / historical**: `attribution-sanitation-crosswalk.md`, everything under `archive/` and `archive/legacy-docs/`, `content_list.md` (replaced by this portal).
- **Exploratory** (not release-path): `v4_work/` — retained as reference for the deferred Private v4 disposition.

---

## 3. Classification taxonomy

Every source is classified by the *kind of truth* it carries. Classification drives which canonical document owns it and how durable it is.

| Classification | Meaning | Canonical home |
|---|---|---|
| **Product requirement / decision** | A user-visible guarantee or product choice | PRD |
| **Runtime fact** | Current, changing state (baselines, deploy posture, run IDs) | RELEASE_STATUS |
| **Architecture invariant / ADR** | A structural rule or recorded design decision | ARCHITECTURE / CODEBASE_MAP |
| **Acceptance criterion / SLO** | A measurable pass/fail threshold or service target | RC_GATES / SERVICE_LEVELS / STT_CONTRACTS |
| **Procedure** | Repeatable operator/dev/tester steps | OPS_RUNBOOK / TEST_PROTOCOL / TESTER_INSTRUCTIONS |
| **Evidence** | Dated proof of a past claim | `evidence/`, launch ledgers |
| **Open gap / risk** | Unfinished or at-risk work | BACKLOG |
| **Superseded history** | Formerly-true, kept for provenance | `archive/`, `archive/legacy-docs/` |
| **Unverified hypothesis** | A claim not yet proven | BACKLOG (flagged) |

---

## 4. Disposition taxonomy

Every source in the ledger is assigned a disposition — what the migration does with it:

| Disposition | Meaning |
|---|---|
| **EXTRACTED** | Durable content lifts into a canonical document (later PR). |
| **EVIDENCE_ONLY** | Kept as dated evidence; not promoted to a contract. |
| **SUPERSEDED** | Replaced by a canonical document; retained read-only for history. |
| **OPEN_GAP** | Names unfinished work; routes to BACKLOG. |
| **NO_DURABLE_CONTENT** | Nothing worth carrying forward; archive/retire only. |

---

## 5. Metadata schema

Each canonical document carries a short header so authority and freshness are self-describing:

```
**Owner:** <role/person accountable for the content>
**Last Reviewed:** <YYYY-MM-DD of last human review>
**Class:** <classification from §3>
**Authority:** <what this doc is the SSOT for, in one line>
```

`RELEASE_STATUS.md` additionally carries the **Update rule** (only it receives changing status) and the **Evidence Freshness Contract** (latest complete passing run; a newer failing run returns the parent gate to red). Stale contracts must be **banner-marked** (`⚠️ STALE — UNDER REVISION`) rather than silently trusted; see the current banners on `PRD.operational.md` and `ROADMAP.operational.md`.

---

## 6. Archive & legacy docs

- [`archive/`](./archive/) — historical evidence packets and superseded release material (audits, recovery, rehearsals, release-status, STT, workflows). See [`archive/README.md`](./archive/README.md).
- [`archive/legacy-docs/`](./archive/legacy-docs/) — **pinned, read-only copies** of the pre-consolidation `docs/*.md` sources, materialized at their exact source commit so the historical corpus is browsable without Git archaeology. Each file carries a non-authoritative banner naming its source commit. These are **not** current product truth. Provenance:
  - `d31102a8/` (2026-05-17) — `ARCHITECTURE.md`, `PRD.md`, `ROADMAP.md`, `CHANGELOG.md`, `OUTLINE.md`.
  - `a21e1e52/` (2026-03-13, parent of the retirement commit `1526b33f`) — `USER_GUIDE.md`, `research/pricing_analysis.md`.
  - `a247f62c/` (2026-03-07, parent of the retirement commit `d24f69a3`) — `Backend/edge-functions.md`.

---

## 7. Related records

- [`DOC_MIGRATION_LEDGER.md`](./DOC_MIGRATION_LEDGER.md) — source-by-source inventory, classification, disposition, target, known gaps, and the **Quick Preview (Browser)** naming decision.
- [`RELEASE_STATUS.md`](./RELEASE_STATUS.md) — current posture (SSOT).
- [`PRECEDENCE.md`](./PRECEDENCE.md) — conflict resolution.

*This portal is navigational and structural. It records no changing release status; that lives only in `RELEASE_STATUS.md`.*

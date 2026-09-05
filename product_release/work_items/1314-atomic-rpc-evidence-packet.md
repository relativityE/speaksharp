<!-- pm-currentization:2026-09-04 -->
> [!CAUTION]
> **Reviewed 4 Sep 2026 — superseded work packet.** This file is preserved for provenance and must not be executed as current product/release authority. Preview/internal-build model selection, PostHog-flag targeting, two-transcript retention, and prior closure claims are superseded by the canonical root documents and issues #1259/#1258/#1390/#1404/#1407/#1386/#1263/#1304. Use canonical Production only; do not infer that historical PASS evidence qualifies the current product.
<!-- /pm-currentization:2026-09-04 -->

# SUPERSEDED — do not use

This packet described the **first** atomic-completion design and is now wrong in three material ways. It was the
source of a claim/artifact drift RETURN, so its body has been removed rather than left to be read again:

| it claimed | the artifact actually does |
|---|---|
| one same-name `complete_session` overload, dropping the Stage-A one | a distinctly named **`complete_session_v2`**; purely additive, drops nothing |
| a **single UPDATE** in a single transaction | **two statements** — the session write outside, the transcript write plus the coordinator inside one subtransaction |
| a **200,000-character** bound | **50,000 characters AND 200,000 bytes**, either one rejecting |
| success/failure only | intentional **partial-success** semantics: session saved, transcript not retained |

**Use instead:**

- `1314-migration-apply-packet.md` — the immutable apply / readback / rollback packet, frozen at a specific SHA.
- `1314-correction-design.md` — the reviewed design, with its own superseded section annotated.

A superseded document that still reads as current is a liability, not a record. The history stays in the PR
comments and the git log, which are timestamped and cannot silently drift.

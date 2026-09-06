<!-- pm-currentization:2026-09-04 -->
> [!CAUTION]
> **Reviewed 4 Sep 2026 — historical evidence index.** This file is preserved for provenance and must not be executed as current product/release authority. Preview/internal-build model selection, PostHog-flag targeting, two-transcript retention, and prior closure claims are superseded by the canonical root documents and issues #1259/#1258/#1390/#1404/#1407/#1386/#1263/#1304. Use canonical Production only; do not infer that historical PASS evidence qualifies the current product.
<!-- /pm-currentization:2026-09-04 -->

# Release Evidence Index

> **HISTORICAL EVIDENCE — all files reviewed 4 Sep 2026.** Dated artifacts here are point-in-time proofs; they are not current release truth. Commit SHAs recorded before **2026-07-15** predate the attribution history sanitation — map old→new via `retained/attribution-sanitation-crosswalk.md`. Historical PostHog `release_sha` values also retain the old SHAs by design.

This directory stores dated release-proof artifacts. It is retained evidence, not the current coordination board and not the disposable `product_release/archive/` tree.

### Supersessions — recorded here, never written into the dated record

A dated artifact states what was proved on its date, in the words of the contract in force then.
When later work changes that contract, the change is recorded in this index. The artifact itself is
not edited: a proof rewritten to match current behavior no longer evidences anything, because it can
no longer disagree with the present — and disagreeing with the present is the only reason to keep it.

| Artifact | What it proved then | Superseded by |
|---|---|---|
| `BETA_50_RELEASE_EVIDENCE_2026-07-09.md` — Share Feedback acceptance | A report row carrying `include_transcript`, `transcript_excerpt`, `include_audio` and `audio_attachment_note` opt-in columns, a user-entered title, and a raw `userAgent` in metadata | #1404 / #1416 — the redesigned two-field form derives the title, stores coarse parsed browser/OS instead of the raw user agent, and submits no transcript or audio fields at all |

## Current truth sources

- Current release verdict: `product_release/RELEASE_STATUS.md`.
- Open and deferred work: `product_release/ROADMAP.md`.
- STT interpretation: `product_release/STT.md`.
- Evidence locations: `product_release/EVIDENCE_INDEX.md`.

## Evidence Rules

- Dated JSON/Markdown files are retained as audit trail.
- Older reports may contain superseded conclusions; do not treat them as current release policy without checking the owning canonical document.
- STT model evaluations, raw benchmark data, protocols, and down-selection history live under `stt/`; they must not be moved to or depend on `archive/`.
- `*.latest.json` and `*.latest.md` names are rolling snapshots. They are not
  stable proof references unless copied to a dated artifact.
- Any STT proof from mock auth, `localhost:5173`, bad fixtures, or wrong CDP tab
  is invalid for release evidence unless explicitly labeled mocked diagnostic.

## Durable sub-indexes

- [`stt/README.md`](./stt/README.md): permanent STT model-evaluation and benchmark history.
- [`retained/`](./retained/): dated documentation-reconciliation, launch, entitlement, closeout, and security proof retained after canonical consolidation.

The release risk is stale or contradictory interpretation, so new findings update the owning canonical document and append evidence; they do not rewrite historical results.

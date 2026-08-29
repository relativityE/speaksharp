# Release Evidence Index

> **HISTORICAL EVIDENCE.** Dated artifacts here are point-in-time proofs; they are not current release truth. Commit SHAs recorded before **2026-07-15** predate the attribution history sanitation — map old→new via `retained/attribution-sanitation-crosswalk.md`. Historical PostHog `release_sha` values also retain the old SHAs by design.

This directory stores dated release-proof artifacts. It is retained evidence, not the current coordination board and not the disposable `product_release/archive/` tree.

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
- [`retained/`](./retained/): dated launch, entitlement, closeout, and security proof retained after canonical consolidation.

The release risk is stale or contradictory interpretation, so new findings update the owning canonical document and append evidence; they do not rewrite historical results.

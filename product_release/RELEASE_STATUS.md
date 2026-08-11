# Release Status

**Status authority:** this file only.
**Reconciled:** 2026-08-11.
**Current main and deployed release observed:** `a1c297ba3191568b80af5d0f6d1f97b79157d2ee`.

## Current disposition

SpeakSharp is **not yet an approved Flawless Launch** and the historical “19/19” numerator is not claimed. The old ledger became stale after the product changed to Private-only transcription and Open Mic + Focus Points.

## Product truth

- One SpeakSharp speaking-practice product.
- Practice modes: **Open Mic** and **Focus Points**.
- Customer transcription: **Private on-device only** for Free and Pro.
- Browser and Cloud are not customer choices or fallbacks.
- Controlled beta: free; no card or checkout.
- Practice Loop: choose → speak → review → one next action → repeat → progress.

## Immediate release corrections

- #1269 / #1254 — public product-truth surfaces.
- #1270 / #1255 — responsive mobile session shell.
- #1271 / #1256 — Focus Points review isolation and next-Open-Mic proof.
- #1257 — this canonical documentation reset.

## Flawless Launch qualification

- #1258 — deployed authenticated Private Practice Loop and device proof.
- #1259 — sanitized baseline, telemetry, SLOs.
- #1260 — unaffiliated-domain purge.
- #1261 — SECURITY DEFINER hardening.
- #1267 — launch-day GO/HOLD and rollback playbook.

## Explicit liens / non-blocking work

- #1262 — unit-coverage merge hardening while preserving the sharding speedup.
- #1263 — v2/v4 benchmark and flag hygiene; v2 stays default until separately approved.
- #1264 — optional Practice Focus intent and repeat persistence.
- #1265 — comparable-session Progress definition.
- #1266 — future paid offer; billing remains inactive.
- #1268 — discourse-marker opt-in after release.

## Authority gates

Merge, migration apply, deployment/dispatch, configuration activation, destructive cleanup, and issue closure after delivery are separate Product Owner decisions. CI green is evidence, not completion.

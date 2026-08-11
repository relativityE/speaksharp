**Status:** Authoritative
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-11
**Last Verified:** 2026-08-11T19:36:02Z against GitHub, freshly fetched `origin/main`, and the live production release signal read at 19:05:44Z
**Applies To:** Current SpeakSharp main, production frontend, open release work, and launch posture
**Class:** Runtime fact
**Authority:** The only source for current release/deployment posture, blockers, SHAs, and workflow evidence
**Not Authoritative For:** Stable product guarantees (→ [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)); unfinished-work detail (→ [ROADMAP.md](./ROADMAP.md))
**Supersedes:** Previous release-status snapshots and historical completion numerators
**Evidence Sources:** [`origin/main`](https://github.com/relativityE/speaksharp/commit/a1c297ba3191568b80af5d0f6d1f97b79157d2ee), [production frontend](https://speaksharp-public.vercel.app/), and the PR/run links below
**Update rule:** Put changing SHAs, run IDs, deployment identity, blockers, and go/no-go state only in this file.

# Release Status

## Verified identity

| Surface | Verified value | Verification |
|---|---|---|
| GitHub `main` | `a1c297ba3191568b80af5d0f6d1f97b79157d2ee` | freshly fetched `origin/main`, observed 2026-08-11T19:05:44Z |
| Production frontend | `a1c297ba3191568b80af5d0f6d1f97b79157d2ee` | live `window.__APP_RELEASE__`, observed 2026-08-11T19:05:44Z |

Production and `main` match. None of the open product or documentation PR heads below is merged or deployed. No migration application, feature activation, or production dispatch is implied by their state.

## Current disposition

SpeakSharp is **HOLD for Flawless Launch qualification**. The retired completion numerator is not a current release measure. The launch decision requires accepted product heads, deployed Private Practice Loop proof, sanitized observability, repository/domain and database-privilege hardening, and an approved GO/HOLD and rollback playbook.

## Open product and documentation heads

| Requirement | PR head | Exact-head evidence | Current disposition |
|---|---|---|---|
| [#1254](https://github.com/relativityE/speaksharp/issues/1254) product truth | [#1269](https://github.com/relativityE/speaksharp/pull/1269) `9a48848c` | Full [CI 31495950708](https://github.com/relativityE/speaksharp/actions/runs/31495950708) passed | Three independent review findings on closed-beta offer/event/quota truth remain unresolved; no ACCEPT disposition exists |
| [#1255](https://github.com/relativityE/speaksharp/issues/1255) responsive session shell | [#1270](https://github.com/relativityE/speaksharp/pull/1270) `4fb94490` | Full PR-context [CI 31526887105](https://github.com/relativityE/speaksharp/actions/runs/31526887105), [U3 31526887092](https://github.com/relativityE/speaksharp/actions/runs/31526887092), and [SCA 31526887078](https://github.com/relativityE/speaksharp/actions/runs/31526887078) passed | Corrected head is terminal green; renewed independent acceptance remains |
| [#1256](https://github.com/relativityE/speaksharp/issues/1256) completed-brief isolation | [#1271](https://github.com/relativityE/speaksharp/pull/1271) `4eecac96` | Full [CI 31493299907](https://github.com/relativityE/speaksharp/actions/runs/31493299907) passed; U3 and SCA are green | Independently ACCEPTed on the exact head; merge remains a separate Product Owner decision |
| [#1259](https://github.com/relativityE/speaksharp/issues/1259) sanitized launch telemetry | [#1274](https://github.com/relativityE/speaksharp/pull/1274) `e8b8c19f` | Prior CI does not resolve the reviewed identity and second-redaction-boundary defects | Not review-ready; corrective implementation and exact-head evidence remain |
| [#1260](https://github.com/relativityE/speaksharp/issues/1260) unaffiliated-domain purge | [#1279](https://github.com/relativityE/speaksharp/pull/1279) `5830dc7f` | Full [CI 31525950419](https://github.com/relativityE/speaksharp/actions/runs/31525950419), [zero-reference 31525950420](https://github.com/relativityE/speaksharp/actions/runs/31525950420), and read-only hosted `ALLOWED_ORIGIN` [proof 31526663981](https://github.com/relativityE/speaksharp/actions/runs/31526663981) are terminal green | Ready for independent review; duplicate draft #1277 still needs explicit reconciliation |
| [#1261](https://github.com/relativityE/speaksharp/issues/1261) privileged-function hardening | [#1276](https://github.com/relativityE/speaksharp/pull/1276) `af223b2e` | Full [CI 31506021684](https://github.com/relativityE/speaksharp/actions/runs/31506021684) and PostgreSQL 15/16/17 [matrix 31506022204](https://github.com/relativityE/speaksharp/actions/runs/31506022204) passed | Source-only remediation is ready for independent review; no migration was applied |
| [#1262](https://github.com/relativityE/speaksharp/issues/1262) fail-closed merged coverage | [#1273](https://github.com/relativityE/speaksharp/pull/1273) `18fda9c6` | Full [CI 31523856588](https://github.com/relativityE/speaksharp/actions/runs/31523856588) passed | Prior RETURN correction is present; renewed independent acceptance remains |
| [#1263](https://github.com/relativityE/speaksharp/issues/1263) Private implementation evidence | [#1283](https://github.com/relativityE/speaksharp/pull/1283) `194bb09c` | Draft evidence lane only | Draft; benchmark/flag evidence and independent review remain |
| [#1264](https://github.com/relativityE/speaksharp/issues/1264) optional Practice Focus | [#1278](https://github.com/relativityE/speaksharp/pull/1278) `2931ec32` | Draft evidence lane only | Draft; final exact-head evidence and independent review remain |
| [#1265](https://github.com/relativityE/speaksharp/issues/1265) comparable Progress | [#1281](https://github.com/relativityE/speaksharp/pull/1281) `28c0dadb` | Full [CI 31525169733](https://github.com/relativityE/speaksharp/actions/runs/31525169733) and cross-page evidence passed | Ready for independent review; duplicate draft #1280 still needs explicit reconciliation |
| [#1266](https://github.com/relativityE/speaksharp/issues/1266) free-beta contract | [#1282](https://github.com/relativityE/speaksharp/pull/1282) `6f89c3ed` | Full exact-head [CI 31527999428](https://github.com/relativityE/speaksharp/actions/runs/31527999428) and [U3 31527954361](https://github.com/relativityE/speaksharp/actions/runs/31527954361) are terminal green; focused pricing and full Edge evidence passed | Ready for independent review; intentionally stacked on #1269 |
| [#1267](https://github.com/relativityE/speaksharp/issues/1267) launch support and GO/HOLD | [#1284](https://github.com/relativityE/speaksharp/pull/1284) `c16229db` | Full PR-context [CI 31527362912](https://github.com/relativityE/speaksharp/actions/runs/31527362912), [U3 31527363048](https://github.com/relativityE/speaksharp/actions/runs/31527363048), and [SCA 31527363028](https://github.com/relativityE/speaksharp/actions/runs/31527363028) are terminal green | Ready for independent review; no production action occurred |
| [#1257](https://github.com/relativityE/speaksharp/issues/1257) canonical documentation | [#1272](https://github.com/relativityE/speaksharp/pull/1272) current WIP | Prior review findings are corrected; a new exact-head lane is required after the final factual refresh | Draft by design; #1269 and #1270 do not yet have terminal accepted heads |

## Remaining launch requirements

The single-owner mapping for every surviving requirement is in [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md#open-requirement-ownership). Current execution detail is in [BACKLOG.md](./BACKLOG.md), and phase sequencing is in the canonical [ROADMAP.md](./ROADMAP.md). #1258, #1268, and #1275 have no current review-ready implementation head.

## Evidence freshness contract

- Evidence is valid only for the exact SHA and surface it tested.
- A later commit makes prior exact-head CI historical; a later deployment makes prior production readback historical.
- A PR being ready, green, reviewed, merged, deployed, activated, and production-qualified are distinct facts.
- Update this file only at a coherent checkpoint after re-reading GitHub state, `origin/main`, and the live release signal.
- Never infer frontend deployment, migration application, feature activation, or production qualification from a merge or workflow association alone.

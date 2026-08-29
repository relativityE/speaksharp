# Attribution-history sanitation — retained release SHA crosswalk

**Sanitation date:** 2026-07-15
**Tool:** git-filter-repo v2.47.0 · sha256 `67447413e273fc76809289111748870b6f6072f08b17efe94863a92d810b7d94`
**Command:** `git filter-repo --force --preserve-commit-hashes --message-callback <surgical attribution-only>`
**Backup:** verified bundle `ss-prewrite-backup-b27f8328.bundle` (frozen pre-rewrite mirror; preserves every old SHA for rollback).
**Scope:** removed only Claude/Anthropic co-author trailers, generated-with-Claude-Code footers, and session links from commit messages. Trees, authorship, dates, parents, merge topology, and the `fibonacci@fibonnaci.local` identity are byte-preserved. Legitimate technical references to Claude remain.

## Branch heads

| ref | old (pre-sanitation) | new (sanitized) |
|---|---|---|
| `main` | `b27f83284c3b` | `84f720d22422` |
| `docs/wave1-pro-availability-clarification` (PR #981) | `1cb11397e7b7` | `64b8f63a8379` |

`main` tree unchanged: `94f62bc3559b347b2e22c41ab27a124f35fa1611`. #981 net-diff patch-id unchanged: `ea3a7c70…`.

## Version tags (9)

| tag | type | old object | new object |
|---|---|---|---|
| `v0.8.5-rc1` | annotated | `35b0e5c04c84` | `7e1f2963cfdc` |
| `v0.8.5-rc2` | annotated | `5cb2a852d77f` | `8b1c968993b2` |
| `v0.8.5-rc3` | annotated | `4880bf4996cd` | `c0e8c7b7d75f` |
| `v0.8.5-rc4` | annotated | `3248d419562d` | `57ee01a75cc7` |
| `v0.8.5-rc5` | annotated | `1c2b146ebfe4` | `a241ec362412` |
| `v0.9.0-rc0` | annotated | `b50f57f5b111` | `a42ee05df7f7` |
| `v0.9.0-rc1` | annotated | `55f9f6ed0ea1` | `6409567ab0d4` |
| `v0.9.0-rc2` | annotated | `db633bf0c7cf` | `b235a43d1781` |
| `v0.9.0-rc3` | annotated | `771607ab86d4` | `383f5bb6e363` |

## Archive tags (12)

| tag | type | old object | new object |
|---|---|---|---|
| `archive/891-engine-terminated-toast-2026-07-15` | annotated | `dd53db6d279c` | `95f4b8e37aa7` |
| `archive/891-private-segmented-finalization-2026-07-15` | annotated | `ef1c6162fac2` | `568eedf47e77` |
| `archive/891-webgpu-engagement-2026-07-15` | annotated | `117ce244ea44` | `bf01830926b5` |
| `archive/dev-v4-app-path-proof-fix-pre-main-convergence` | lightweight | `926cf988be48` | `bb5f57d8735c` |
| `archive/dev-v4-app-path-proof-harness-pre-main-convergence` | lightweight | `9270c4cc9763` | `8bd991a9f418` |
| `archive/dev-v4-customer-safe-ux-pre-main-convergence` | lightweight | `11c77fce39f2` | `ed2c8ee46560` |
| `archive/dev-v4-decode-fallback-pre-main-convergence` | lightweight | `9ee52cbfece2` | `841b92efd9b0` |
| `archive/dev-v4-flag-ready-pre-main-convergence` | lightweight | `5ac9493f4b95` | `9830f7c9cdf6` |
| `archive/dev-v4-integration-pre-main-convergence` | lightweight | `dd561d69a492` | `2ac7a6317bda` |
| `archive/research-v4-transcript-merge-collapse-pre-main-convergence` | lightweight | `f37b9f7b2800` | `147ff60606d0` |
| `archive/test-v4-auto-fallback-proof-pre-main-convergence` | lightweight | `81483e9726c6` | `d4a1f74c49e7` |
| `archive/test-v4-auto-fallback-with-sample-pre-main-convergence` | lightweight | `c3460387ce54` | `e0bbcc1b672e` |

The 13 pre-boundary tags (`v0.3.x`…`v0.8.0-rc0`, `main_backup_v3`) were **not** touched.

## Historical PostHog `release_sha`

PostHog telemetry rows emitted before 2026-07-15 retain the **old** commit SHAs in their `release_sha` property; those values are immutable event data and are **not** rewritten. To correlate a historical `release_sha` (e.g. an rc0–rc3 build) with the current sanitized history, use the mapping tables above and the full 969-row commit crosswalk retained as release evidence.

## rc crosswalk (build tags)

| release | old | new |
|---|---|---|
| v0.9.0-rc0 | `b50f57f5b111` | `a42ee05df7f7` |
| v0.9.0-rc1 | `55f9f6ed0ea1` | `6409567ab0d4` |
| v0.9.0-rc2 | `db633bf0c7cf` | `b235a43d1781` |
| v0.9.0-rc3 | `771607ab86d4` | `383f5bb6e363` |

## Signature-loss disclosure

211 previously GPG-signed commits (204 main + 7 tag-only + 0 #981) received new SHAs and therefore lost their signatures. Per owner decision these are **not** re-signed. No new signatures were fabricated.

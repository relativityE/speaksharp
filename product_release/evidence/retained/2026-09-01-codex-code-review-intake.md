# Codex Code Review Findings — Raw Register

> [!CAUTION]
> **POINT-IN-TIME INTAKE — 2026-09-01.** This document preserves what Codex reported on historical PR diffs. It is not a statement that every finding remains reachable on current `main`, and it must not be used as an undifferentiated implementation queue.

- Repository: `relativityE/speaksharp`
- Generated: 2026-09-01 UTC
- Scope: latest 100 pull requests returned by GitHub, ordered by update time
- PRs with Codex findings: 77
- Findings: 206
- Source: GitHub inline review threads authored by `chatgpt-codex-connector`

## Required triage states

Every finding must be assigned exactly one current state before implementation:

- `confirmed-current` — reachable on the current PR head or current `main`
- `fixed-verified` — correction exists and closure evidence proves it
- `partially-fixed` — some but not all of the failure remains
- `superseded` — later design intentionally removed the affected path
- `duplicate` — same root cause is owned by another finding/work item
- `dismissed` — finding is inapplicable, with evidence
- `unverified` — current reachability has not yet been established

Only `confirmed-current` and `partially-fixed` findings may be promoted into implementation work. MVP priority is assigned after current-state verification.

## Index

| PR | Title | Findings |
|---:|---|---:|
| [#1380](https://github.com/relativityE/speaksharp/pull/1380) | feat(#1263): config-driven Private STT candidate registry and boot selection | 2 |
| [#1395](https://github.com/relativityE/speaksharp/pull/1395) | fix(#1258): the release journey gate drove a control the product deleted | 1 |
| [#1396](https://github.com/relativityE/speaksharp/pull/1396) | ci(#1306): read-only audit for the retired issue-report transcript column, and correct a false schema claim | 2 |
| [#1374](https://github.com/relativityE/speaksharp/pull/1374) | fix(#1259 T1): content-free governed telemetry schemas and real-producer controls | 2 |
| [#1375](https://github.com/relativityE/speaksharp/pull/1375) | fix(#1304): trustworthy targeted STT selection evidence and promotable final artifact | 3 |
| [#1388](https://github.com/relativityE/speaksharp/pull/1388) | fix(#1304): bidirectional host interlock — prevent benchmark/local-suite contamination structurally | 2 |
| [#1379](https://github.com/relativityE/speaksharp/pull/1379) | fix(#1324): the canonical filler total IS the coachable total the user sees | 1 |
| [#1376](https://github.com/relativityE/speaksharp/pull/1376) | ci(#1306): allowlist Stage B for exact application — deployment support only | 3 |
| [#1377](https://github.com/relativityE/speaksharp/pull/1377) | fix(#1254): Focus Points detection language and naming rule (Focus Points only) | 2 |
| [#1378](https://github.com/relativityE/speaksharp/pull/1378) | feat(#1302): Stripe TEST-MODE commercial lifecycle qualification — dispatchable, no live path | 4 |
| [#1373](https://github.com/relativityE/speaksharp/pull/1373) | feat(#1306) Stage B: retire the legacy complete_session v1 overloads — source only | 3 |
| [#1367](https://github.com/relativityE/speaksharp/pull/1367) | docs(#1367): complete non-archive Markdown reconciliation + claim-by-claim code audit | 3 |
| [#1369](https://github.com/relativityE/speaksharp/pull/1369) | fix(#1304): artifact completeness and mandatory retention — a run can no longer keep nothing | 2 |
| [#1371](https://github.com/relativityE/speaksharp/pull/1371) | feat(#1304): reconcile contaminated arms — score equivalence, per-utterance, fail-closed | 2 |
| [#1370](https://github.com/relativityE/speaksharp/pull/1370) | docs(#1304): record the frozen-600 latency contamination and its disposition | 2 |
| [#1372](https://github.com/relativityE/speaksharp/pull/1372) | refactor(#1304): delete the retired universal-score UI, keep the shadow score | 1 |
| [#1317](https://github.com/relativityE/speaksharp/pull/1317) | HISTORICAL POST-MVP — regenerate trusted PR governance; do not merge | 19 |
| [#1303](https://github.com/relativityE/speaksharp/pull/1303) | HISTORICAL BILLING — fresh re-cut after retention, Stage-B, and #1259 | 1 |
| [#1361](https://github.com/relativityE/speaksharp/pull/1361) | DO NOT MERGE — #1360 diagnosis; split product and database findings | 3 |
| [#1368](https://github.com/relativityE/speaksharp/pull/1368) | fix(#1304): pin the inference runtimes — serve them through a verifying endpoint, bind them into the fingerprint | 1 |
| [#1365](https://github.com/relativityE/speaksharp/pull/1365) | #1304 Task 3C: certified harness — four evidence blockers closed; Moonshine Streaming admitted; frozen 600 HELD on asset pinning | 4 |
| [#1366](https://github.com/relativityE/speaksharp/pull/1366) | fix(#1360): truthful recovery copy — no transcript promise the draft cannot keep | 1 |
| [#1364](https://github.com/relativityE/speaksharp/pull/1364) | ACCEPTED — #1304 Task 4 frozen corpus; ready for Dev merge | 3 |
| [#1362](https://github.com/relativityE/speaksharp/pull/1362) | ACCEPTED — #1304 3B scoring seam; ready for Dev merge | 1 |
| [#1363](https://github.com/relativityE/speaksharp/pull/1363) | RETURN — #1304 Task 4: freeze verified LibriSpeech corpus identity | 3 |
| [#1346](https://github.com/relativityE/speaksharp/pull/1346) | fix(#1304) Task 3A: shared decode builder + route identity (un-parked) | 2 |
| [#1347](https://github.com/relativityE/speaksharp/pull/1347) | fix(#1347): Private browser capability gate — WebAssembly, not the retired Web Speech API | 1 |
| [#1359](https://github.com/relativityE/speaksharp/pull/1359) | test(#1352) B: execute the shipped newest-two retention contract (first time, anywhere) | 1 |
| [#1358](https://github.com/relativityE/speaksharp/pull/1358) | docs: currentize RELEASE_STATUS + ACTIVE_COORDINATION (five-week-stale SSOTs) | 2 |
| [#1357](https://github.com/relativityE/speaksharp/pull/1357) | RETURN — fix(#1304) Task 2: authoritative benchmark specs read the real product surface | 2 |
| [#1356](https://github.com/relativityE/speaksharp/pull/1356) | fix(#1304) Task 1: certified WER scorer — official normalization, Track A/B separation | 3 |
| [#1355](https://github.com/relativityE/speaksharp/pull/1355) | fix(#1354): block the next recording until Progress evidence is terminal | 2 |
| [#1353](https://github.com/relativityE/speaksharp/pull/1353) | fix(#1352): prove canonical-project read authority | 1 |
| [#1351](https://github.com/relativityE/speaksharp/pull/1351) | RETURN — fix(#1306): make attempt 9 authoritative | 2 |
| [#1349](https://github.com/relativityE/speaksharp/pull/1349) | fix(#1306): split the transcript assertion by lifecycle phase, remove the looped-audio confound | 2 |
| [#1306](https://github.com/relativityE/speaksharp/pull/1306) | data(privacy): adopt atomic completion and newest-two transcript retention before MVP | 2 |
| [#1348](https://github.com/relativityE/speaksharp/pull/1348) | fix(#1306): correct the desktop production-proof control journey | 1 |
| [#1345](https://github.com/relativityE/speaksharp/pull/1345) | test(#1306): key the acquisition verdict on status, exercise the real CTA | 2 |
| [#1331](https://github.com/relativityE/speaksharp/pull/1331) | fix(#1324): preserve interim filler episodes and align coachable totals | 2 |
| [#1344](https://github.com/relativityE/speaksharp/pull/1344) | test(#1306): capture unhandled promise rejections — the likeliest acquisition failure | 1 |
| [#1343](https://github.com/relativityE/speaksharp/pull/1343) | test(#1306): instrument model acquisition so attempt 5 diagnoses instead of timing out | 1 |
| [#1342](https://github.com/relativityE/speaksharp/pull/1342) | test(#1306): wait for Private runtime mode in production proof | 1 |
| [#1341](https://github.com/relativityE/speaksharp/pull/1341) | test(#1306): align production proof with the Private-only flow | 2 |
| [#1339](https://github.com/relativityE/speaksharp/pull/1339) | ci: typecheck root live proof specs before production dispatch | 1 |
| [#1338](https://github.com/relativityE/speaksharp/pull/1338) | test(#1306): harden production proof preflight, cleanup, privacy, and per-session assertions | 2 |
| [#1337](https://github.com/relativityE/speaksharp/pull/1337) | test(#1306): prove the deployed three-session v2 retention journey | 2 |
| [#1335](https://github.com/relativityE/speaksharp/pull/1335) | fix(#1306): restore complete_session_v2 E2E coverage on the real client double | 1 |
| [#1334](https://github.com/relativityE/speaksharp/pull/1334) | fix(#1306): e2e route stub must answer complete_session_v2 (main is red) | 2 |
| [#1330](https://github.com/relativityE/speaksharp/pull/1330) | fix(#1306): SEC-002 IPv4 session-pooler discovery + pre-apply connectivity/TLS proof | 1 |
| [#1329](https://github.com/relativityE/speaksharp/pull/1329) | fix(#1306): recover exact #1314 production postflight safely | 1 |
| [#1326](https://github.com/relativityE/speaksharp/pull/1326) | fix(#1325): add privacy-safe filler count trace for Private STT qualification | 3 |
| [#1272](https://github.com/relativityE/speaksharp/pull/1272) | docs(#1257): reset the release ledger and roadmap to the current Private Practice Loop | 3 |
| [#1309](https://github.com/relativityE/speaksharp/pull/1309) | #1306 (2/3): cutover — metrics-only application | 8 |
| [#1311](https://github.com/relativityE/speaksharp/pull/1311) | ci: harden Setup Environment against un-timed network hangs (#1306) | 1 |
| [#1308](https://github.com/relativityE/speaksharp/pull/1308) | #1306 (1/3): Stage A — additive metrics-only DB contract | 3 |
| [#1301](https://github.com/relativityE/speaksharp/pull/1301) | fix(#1294): correct the weekly Stripe test-mode/test-clock billing qualification (5 RETURN defects) | 2 |
| [#1300](https://github.com/relativityE/speaksharp/pull/1300) | fix(canary): schedule active-trial and no-charge paid qualification | 6 |
| [#1294](https://github.com/relativityE/speaksharp/pull/1294) | fix: close test-account contract and qualify trial/paid canary | 2 |
| [#1297](https://github.com/relativityE/speaksharp/pull/1297) | fix(#1282): stamp commercial_trial_granted_at on new-account trial (grant-on-conflict) | 1 |
| [#1296](https://github.com/relativityE/speaksharp/pull/1296) | docs: refresh beta tester invitation and dogfood checklist | 2 |
| [#1290](https://github.com/relativityE/speaksharp/pull/1290) | fix: reconcile flawless-launch product contract across repository | 3 |
| [#1282](https://github.com/relativityE/speaksharp/pull/1282) | feat(#1282): 30-day full-product trial → $10/month, server-authoritative | 3 |
| [#1286](https://github.com/relativityE/speaksharp/pull/1286) | feat(#1265): server-side Focus Points/Open Mic Progress separation | 2 |
| [#1279](https://github.com/relativityE/speaksharp/pull/1279) | fix(#1260): purge the unaffiliated domain and enforce zero-reference CI | 1 |
| [#1284](https://github.com/relativityE/speaksharp/pull/1284) | docs(#1267): add Private-only launch playbook | 2 |
| [#1287](https://github.com/relativityE/speaksharp/pull/1287) | feat(#1266): webhook lifecycle DB prerequisite (apply before #1282 Edge) | 1 |
| [#1269](https://github.com/relativityE/speaksharp/pull/1269) | fix(#1254): make every public surface tell the Private-only product truth | 3 |
| [#1280](https://github.com/relativityE/speaksharp/pull/1280) | feat(#1265): Progress metric definition matrix + single-source consistency | 2 |
| [#1281](https://github.com/relativityE/speaksharp/pull/1281) | feat(#1265): show comparable Progress and one next action | 4 |
| [#1278](https://github.com/relativityE/speaksharp/pull/1278) | feat(#1264): optional Open Mic Practice Focus, preserved through repeat | 1 |
| [#1271](https://github.com/relativityE/speaksharp/pull/1271) | fix(#1256): keep Focus Points review state out of the next Open Mic take | 2 |
| [#1270](https://github.com/relativityE/speaksharp/pull/1270) | fix(#1255): stack the session shell on mobile | 1 |
| [#1276](https://github.com/relativityE/speaksharp/pull/1276) | fix(#1261): revoke PUBLIC/anon from exposed SECURITY DEFINER functions (source-only) | 3 |
| [#1274](https://github.com/relativityE/speaksharp/pull/1274) | ops(#1259): define Practice Loop funnel + Private SLOs and lock content-free telemetry | 2 |
| [#1273](https://github.com/relativityE/speaksharp/pull/1273) | ci(#1262): make merged unit coverage fail closed with one threshold authority | 1 |
| [#1126](https://github.com/relativityE/speaksharp/pull/1126) | chore(infra): single-owner worktree governance (agent collision prevention) | 26 |
| [#1121](https://github.com/relativityE/speaksharp/pull/1121) | draft(product-value): #1116 increment 1 — Practice Focus on-ramp | 7 |

## Findings

### PR #1380 — feat(#1263): config-driven Private STT candidate registry and boot selection

- PR: https://github.com/relativityE/speaksharp/pull/1380

#### CR-001: Correct the localStorage selection inventory

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6djGaG`
- **Thread state:** unresolved
- **Location:** `product_release/evidence/retained/2026-08-30-stt-selection-inventory.md:30`
- **Created:** 2026-08-30T18:22:17Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Correct the localStorage selection inventory**

At the pinned baseline, application code never reads the listed `privateEngine` or `privateModel` localStorage keys; those names are only written in bypass tests. Conversely, `privateV4Experiment.ts` reads actual controls such as `speaksharp.v4.variant` and `speaksharp.v4.forceAuto`, which can select the v4 variant/path in dev and test contexts, and the canonical `STT_MODE_PROVIDER_CONFIG.defaultProvider` is also omitted. Because this artifact is presented as the mechanical inventory to drive removal of every existing selector, following it would retire nonexistent authorities while leaving real ones unreconciled.

Useful? React with 👍 / 👎.

#### CR-002: Add the retained artifact to the evidence index

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6djGaI`
- **Thread state:** unresolved
- **Location:** `product_release/evidence/retained/2026-08-30-stt-selection-inventory.md:3`
- **Created:** 2026-08-30T18:22:17Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Add the retained artifact to the evidence index**

This new dated artifact is classified as retained evidence, but the commit does not add it to `product_release/EVIDENCE_INDEX.md`, even though that canonical document owns the index of all dated proof artifacts and its retained-evidence section is the supported discovery path. As committed, readers following the repository's documentation portal cannot discover this inventory from the authoritative index; add a dated entry with its point-in-time scope and current interpretation owner.

AGENTS.md reference: [AGENTS.md:L475-L478](https://github.com/relativityE/speaksharp/blob/b8d3cde16e082831b88f1a173050cfc108a3a253/AGENTS.md#L475-L478)

Useful? React with 👍 / 👎.


### PR #1395 — fix(#1258): the release journey gate drove a control the product deleted

- PR: https://github.com/relativityE/speaksharp/pull/1395

#### CR-003: Include all release proofs in the retired-control scan

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6d96pG`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/session/__tests__/proofSelectorCoverage.test.tsx:31`
- **Created:** 2026-09-01T04:17:43Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Include all release proofs in the retired-control scan**

This new guard still scans only the three entries in `PROOF_FILES`, so its claim that no proof drives the retired control is already false: `tests/live/account-wide-recording-mutex.live.spec.ts:174-180` still enables and clicks `session-start-stop-button`, and `package.json:75` runs that spec in the full `rc:dast:live` release gate. A production-source search at the reviewed SHA finds no component rendering that ID, so any run reaching this step still times out for the same harness/product mismatch while this guard passes; include active release proofs in the scan or migrate this spec to the shared control helpers.

AGENTS.md reference: [AGENTS.md:L469-L473](https://github.com/relativityE/speaksharp/blob/0befda958e5bc0b59e76a5132481377c8a690612/AGENTS.md#L469-L473)

Useful? React with 👍 / 👎.


### PR #1396 — ci(#1306): read-only audit for the retired issue-report transcript column, and correct a false schema claim

- PR: https://github.com/relativityE/speaksharp/pull/1396

#### CR-004: Update the contract test for the third workflow mode

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6d-gi9`
- **Thread state:** unresolved
- **Location:** `.github/workflows/db-grant-check.yml:104`
- **Created:** 2026-09-01T05:12:37Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Update the contract test for the third workflow mode**

Adding this step raises the workflow's `set -euo pipefail` and `--fail-with-body` occurrences from two to three, but `tests/config/db-grant-check-workflow.test.ts` still asserts that both counts equal two. The full merge-candidate lane runs that Vitest suite, so this commit cannot pass required CI until the test is updated to cover the new audit.

AGENTS.md reference: [AGENTS.md:L226-L230](https://github.com/relativityE/speaksharp/blob/03c5a6bc1a93a532f160cac79cda2b798cac056e/AGENTS.md#L226-L230)

Useful? React with 👍 / 👎.

#### CR-005: Validate the audit response before declaring the column absent

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6d-gjB`
- **Thread state:** unresolved
- **Location:** `.github/workflows/db-grant-check.yml:126`
- **Created:** 2026-09-01T05:12:37Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Validate the audit response before declaring the column absent**

When the Management API returns HTTP 200 with invalid JSON, an unexpected response shape, or merely different JSON whitespace, `run_sql` echoes the response and this raw-string `grep` falls through to the successful `ABSENT` branch. Unlike the workflow's existing modes, the new audit therefore fails open and can record false schema evidence; parse the response and assert the expected one-row `cols` structure before deciding presence or running the count query.

Useful? React with 👍 / 👎.


### PR #1374 — fix(#1259 T1): content-free governed telemetry schemas and real-producer controls

- PR: https://github.com/relativityE/speaksharp/pull/1374

#### CR-006: Reuse the existing attempt/outcome path

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZahU`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/work_items/1259-telemetry-qualification-plan.md`
- **Created:** 2026-08-29T11:04:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reuse the existing attempt/outcome path**

At the reviewed parent, `backend/supabase/migrations/20260731130000_progress_recommendations.sql` already defines recommendation identities, explicit accepted attempts, comparable-session eligibility, target-specific server-derived outcomes, and absence outcomes; `frontend/src/components/progress/ProgressPanel.tsx` records acceptance and displays the resulting attempt state. Calling all of these missing directs #1259 toward a duplicate path, which would fragment advice identities and invalidate outcome telemetry instead of qualifying the shipped implementation. Reconcile this plan with those existing tables, RPCs, and UI first.

AGENTS.md reference: [AGENTS.md:L111-L114](https://github.com/relativityE/speaksharp/blob/676ea28d4162e3030d4554ac9917992abbdf5122/AGENTS.md#L111-L114)

Useful? React with 👍 / 👎.

#### CR-007: Move the temporary plan out of permanent documentation

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZahY`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/work_items/1259-telemetry-qualification-plan.md`
- **Created:** 2026-08-29T11:04:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Move the temporary plan out of permanent documentation**

This file explicitly classifies itself as a temporary work-item plan, but repository policy requires temporary implementation plans to live in the issue or PR description rather than the tracked documentation tree. Keeping it under `product_release/` also conflicts with the documentation portal's rule that execution plans are not documents, so move the checklist and falsification plan to #1259/the PR instead of adding this file.

AGENTS.md reference: [AGENTS.md:L475-L487](https://github.com/relativityE/speaksharp/blob/676ea28d4162e3030d4554ac9917992abbdf5122/AGENTS.md#L475-L487)

Useful? React with 👍 / 👎.


### PR #1375 — fix(#1304): trustworthy targeted STT selection evidence and promotable final artifact

- PR: https://github.com/relativityE/speaksharp/pull/1375

#### CR-008: Lock the output before concurrent runners start

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6daE4A`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/run-browser-matrix.mts`
- **Created:** 2026-08-29T13:17:28Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Lock the output before concurrent runners start**

When two invocations for the same set and SHA start before either finishes, the default retention logic gives both the same output and partial paths, and both pass the one-time existence check near startup. This unconditional final write then lets the later process replace the earlier process's supposedly immutable artifact, while their checkpoint writes also race. Reserve or lock the path exclusively for the run, and make final promotion fail atomically if another process has already created the artifact.

Useful? React with 👍 / 👎.

#### CR-009: Bind resumed checkpoints to the benchmark host

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6daE4B`
- **Thread state:** unresolved
- **Location:** `scripts/run-browser-matrix.mts:341`
- **Created:** 2026-08-29T13:17:28Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Bind resumed checkpoints to the benchmark host**

When a partial checkpoint is resumed on a different machine or container, all of these identity fields can still match because the host and browser environment are omitted. The final artifact can therefore combine latency measurements from different CPUs even though the selection policy qualifies arms using p95 real-time factor, potentially changing which arms pass the performance gate. Include a stable execution-environment fingerprint in the resume identity or reject cross-environment resumes.

Useful? React with 👍 / 👎.

#### CR-010: Sync the directory after promoting the checkpoint

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6daE4C`
- **Thread state:** unresolved
- **Location:** `tests/evidence/certification/atomicWrite.ts:32`
- **Created:** 2026-08-29T13:17:28Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Sync the directory after promoting the checkpoint**

When the host crashes or loses power immediately after this rename, syncing only the temporary file does not guarantee that the directory-entry update itself is durable; the newly named checkpoint can disappear after recovery. Since this helper is intended to provide crash-retained evidence, open and `fsync` the containing directory after the rename before reporting the write complete.

Useful? React with 👍 / 👎.


### PR #1388 — fix(#1304): bidirectional host interlock — prevent benchmark/local-suite contamination structurally

- PR: https://github.com/relativityE/speaksharp/pull/1388

#### CR-011: Guard the full local CI orchestrator

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6d17Bx`
- **Thread state:** unresolved
- **Location:** `package.json:33`
- **Created:** 2026-08-31T19:09:04Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Guard the full local CI orchestrator**

This entry-point-only wiring leaves the repository's canonical `pnpm ci:local` command unprotected for substantial parts of its lifetime: `scripts/run-ci.mjs` invokes guarded `test:unit` and `build:test` children, but the parent does not inherit their lock and later launches Playwright directly around lines 612-684. A benchmark can therefore acquire its lock between stages or during that browser suite, recreating the contamination this change is intended to prevent; hold one outer local lock around the complete local orchestrator. The repository explicitly defines `pnpm ci:local` as the full local CI-parity command.

AGENTS.md reference: [AGENTS.md:L246-L246](https://github.com/relativityE/speaksharp/blob/b8f5d05dff090e85491b82c3328a727901687922/AGENTS.md#L246-L246)

Useful? React with 👍 / 👎.

#### CR-012: Preserve timing ineligibility in consolidated reports

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6d17B4`
- **Thread state:** unresolved
- **Location:** `scripts/run-browser-matrix.mts:754`
- **Created:** 2026-08-31T19:09:04Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve timing ineligibility in consolidated reports**

When `SPEAKSHARP_INTERLOCK=off` is used for a selection run, this top-level field correctly marks timing ineligible, but each result still has `selectionEligible: true` and `scripts/build-matrix-report.mts` reads only the results array, copies `wallClockMs`, and emits eligible rows without consulting `browserReport.interlock`. Thus the normal consolidated artifact silently loses the warning and can present contaminated latency as selection evidence; propagate this state into the report or invalidate the timing fields/eligibility at the row boundary.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/b8f5d05dff090e85491b82c3328a727901687922/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.


### PR #1379 — fix(#1324): the canonical filler total IS the coachable total the user sees

- PR: https://github.com/relativityE/speaksharp/pull/1379

#### CR-013: Align the reconciliation total with the headline

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dg39x`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/SpeechRuntimeController.ts:3625`
- **Created:** 2026-08-30T11:59:25Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Align the reconciliation total with the headline**

When the stop snapshot contains an excluded discourse marker (for example, `um=3, so=1`), `reconcileFinalizedFillers` above recomputes `reconciliation.persistedTotal` by summing every per-key entry, producing 4, while this assignment publishes 3 as the sibling `persistedTotal`. `SessionPage.tsx` builds its status from `finalizedAnalysis.reconciliation`, and `reconciliationStatusCopy` reads that nested comprehensive total, so the finalized result still carries competing totals and count-bearing reconciliation UI can report a different value from the review headline. The reconciliation result needs to use the same tiered count rather than only changing the sibling field.

Useful? React with 👍 / 👎.


### PR #1376 — ci(#1306): allowlist Stage B for exact application — deployment support only

- PR: https://github.com/relativityE/speaksharp/pull/1376

#### CR-014: Check execution grants for the second v1 overload

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dc9uo`
- **Thread state:** unresolved
- **Location:** `scripts/postflight-gate-1306.sh:67`
- **Created:** 2026-08-29T21:59:34Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Check execution grants for the second v1 overload**

When V1-B exists but either `authenticated` or `service_role` has already lost EXECUTE, `before` still passes because only V1-A's privileges are checked, despite this gate's stated premise that both overloads are present and reachable. Add the equivalent two privilege assertions for `V1B` so this high-risk migration cannot proceed from an unverified partial state.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/f91704209cf8577fb4fc8d96d2663e52ae753969/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.

#### CR-015: Include Stage B in the terminal outcome

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dc9uq`
- **Thread state:** unresolved
- **Location:** `.github/workflows/apply-exact-allowlisted-migration.yml:346`
- **Created:** 2026-08-29T21:59:34Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Include Stage B in the terminal outcome**

When the #1306 postflight fails after a successful apply, this new require step makes the job red, but the subsequent terminal step still considers only `postflight_1314` and therefore reports success; the published summary then says the terminal exact-operation gate succeeded. Feed `steps.postflight_1306.outcome` into the terminal authority and expose its result so a failed production verification cannot produce contradictory release evidence.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/f91704209cf8577fb4fc8d96d2663e52ae753969/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.

#### CR-016: Preserve Stage B in the activation-negative fixture

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dc9ur`
- **Thread state:** unresolved
- **Location:** `tests/db/exact-migration-gate-1314.test.ts:82`
- **Created:** 2026-08-29T21:59:34Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve Stage B in the activation-negative fixture**

Adding Stage B to `cfg.excludedMigrations` makes the later `activation got applied by the push` test invalid: its before/after snapshots still contain only V1314 and activation, so `assertAfterApply` throws because Stage B is absent before it ever evaluates whether activation moved. The test now passes even if activation-delta rejection regresses; include Stage B as pending in both snapshots and change only activation to applied.

AGENTS.md reference: [AGENTS.md:L216-L219](https://github.com/relativityE/speaksharp/blob/f91704209cf8577fb4fc8d96d2663e52ae753969/AGENTS.md#L216-L219)

Useful? React with 👍 / 👎.


### PR #1377 — fix(#1254): Focus Points detection language and naming rule (Focus Points only)

- PR: https://github.com/relativityE/speaksharp/pull/1377

#### CR-017: Stop claiming this flag disables Focus Points

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dd1t2`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/OPERATIONS_AND_SECURITY.md`
- **Created:** 2026-08-30T01:04:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Stop claiming this flag disables Focus Points**

When operators set `VITE_EXECUTIVE_REHEARSAL_DISABLED=true`, Focus Points remains reachable because a repo-wide search shows that `getExecutiveRehearsalFlagState` is never called outside its tests; merely reading the variable inside that unused resolver cannot gate the practice cards, setup dialog, or session flow. Since this authoritative operations table now assigns the flag to the shipped Focus Points slice, an incident responder could rely on a kill switch that has no effect; wire the resolver into the live entry/session path or document the flag's actual dormant scope.

AGENTS.md reference: [AGENTS.md:L52-L53](https://github.com/relativityE/speaksharp/blob/fd1545e5959c81a658de95bd4812c7338bbca373/AGENTS.md#L52-L53)

Useful? React with 👍 / 👎.

#### CR-018: Complete the detection-language rename across the journey

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dd1t4`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/session/FocusPointsRail.tsx:71`
- **Created:** 2026-08-30T01:04:32Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Complete the detection-language rename across the journey**

When a point is detected, this new after-state heading is still paired with the unchanged visible `Covered at …` text and screen-reader status `Covered` in this component (lines 126 and 137); the setup form and help overlay likewise still promise that points will be marked or shown as covered. Users therefore continue receiving the exact coverage assertion this change says the keyword matcher cannot support, so update the remaining result-oriented copy and add a covered-row regression case rather than testing only an all-missing after state.

Useful? React with 👍 / 👎.


### PR #1378 — feat(#1302): Stripe TEST-MODE commercial lifecycle qualification — dispatchable, no live path

- PR: https://github.com/relativityE/speaksharp/pull/1378

#### CR-019: Invoke the trial provisioning function through its trigger

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dgJc0`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/billing-qualification/pglite_supabase.ts`
- **Created:** 2026-08-30T09:43:49Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Invoke the trial provisioning function through its trigger**

The applied migrations define `ensure_trial_profile_for_new_user()` as a zero-argument `RETURNS TRIGGER` function that reads `NEW.id`, but this query passes an argument and invokes it as an ordinary scalar function. PostgreSQL/PGlite will reject the call before creating a profile, so every dispatched qualification stops during the first DB-trial phase; the fixture needs to install and exercise the production trigger path or use a callable provisioning function.

Useful? React with 👍 / 👎.

#### CR-020: Supply the price under the handler's expected key

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dgJc2`
- **Thread state:** unresolved
- **Location:** `scripts/billing-qualification/commercialRunner.ts:54`
- **Created:** 2026-08-30T09:43:49Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Supply the price under the handler's expected key**

The real webhook handler's `validateSubscriptionPrice` reads `STRIPE_PRO_PRICE_ID`, whereas this injected environment resolver only supplies `STRIPE_PRICE_ID`. Once the trial provisioning failure is fixed, every active subscription is therefore classified as missing the configured price, the initial checkout webhook returns an error, and the dispatch can never reach a passing result.

Useful? React with 👍 / 👎.

#### CR-021: Require successful responses for lifecycle webhooks

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dgJc5`
- **Thread state:** unresolved
- **Location:** `scripts/billing-qualification/commercialRunner.ts:216`
- **Created:** 2026-08-30T09:43:49Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Require successful responses for lifecycle webhooks**

When a duplicate, renewal, stale, or scheduled-cancellation webhook returns 4xx/5xx while the previously stored entitlement already equals `pro`, these checks inspect only the unchanged tier and allow the qualification to continue. That permits a `PASSED` artifact even though the real handler failed several lifecycle deliveries; these expected-success events need their HTTP status validated as the initial binding already is.

Useful? React with 👍 / 👎.

#### CR-022: Distinguish missing clocks from cleanup read failures

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dgJc8`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/billing-qualification/commercialRunner.ts`
- **Created:** 2026-08-30T09:43:49Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Distinguish missing clocks from cleanup read failures**

If the post-delete retrieval fails because of a transient network error, authentication failure, rate limit, or Stripe outage, this catch treats it as proof that the clock is gone and marks every recorded object confirmed deleted. The run can consequently publish successful cleanup evidence while fixtures remain; only Stripe's explicit `resource_missing` response should count as absence, with other errors failing cleanup.

Useful? React with 👍 / 👎.


### PR #1373 — feat(#1306) Stage B: retire the legacy complete_session v1 overloads — source only

- PR: https://github.com/relativityE/speaksharp/pull/1373

#### CR-023: Move the temporary plan out of product documentation

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZYH1`
- **Thread state:** resolved, outdated
- **Location:** `product_release/work_items/1306-stage-b-successor-plan.md`
- **Created:** 2026-08-29T10:58:38Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Move the temporary plan out of product documentation**

This file identifies itself as a temporary work item, but repository policy requires temporary implementation plans to live in issues or PR descriptions rather than permanent documentation. Keeping this checklist under `product_release/` creates another active documentation artifact that can become stale; move it to issue #1306 or the successor PR instead of adding this file.

AGENTS.md reference: [AGENTS.md:L475-L487](https://github.com/relativityE/speaksharp/blob/5e465ada130f3e74ad7115b7e71581418c4356c6/AGENTS.md#L475-L487)

Useful? React with 👍 / 👎.

#### CR-024: Target V1-A's actual retention failure

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZYH6`
- **Thread state:** resolved, outdated
- **Location:** `product_release/work_items/1306-stage-b-successor-plan.md`
- **Created:** 2026-08-29T10:58:38Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Target V1-A's actual retention failure**

The current V1-A definition in `20260812041500_flawless_launch_runtime_convergence_1290.sql:770-776` does invoke `converge_transcript_retention`; its defect is that it swallows exceptions and accepts `pending` or `non_converged` results while leaving the transcript written, unlike v2's rollback behavior. Consequently, the M2 transcript-path test described later can observe normal convergence and never reproduce an out-of-contract persistence. Revise the premise and regression to force an exception or non-converged result so it exercises the real bypass.

Useful? React with 👍 / 👎.

#### CR-025: Preserve an exact-head repository-wide caller check

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZYH-`
- **Thread state:** resolved, outdated
- **Location:** `product_release/work_items/1306-stage-b-successor-plan.md`
- **Created:** 2026-08-29T10:58:38Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve an exact-head repository-wide caller check**

The cited live assertion is scoped to network traffic generated by the single three-session browser journey: `three-session-retention-proof.live.spec.ts:658-670` waits for exactly those three v2 completions and checks that no v1 request occurred during them. A v1 caller on another route or background flow would not execute and this assertion would remain green, so it cannot serve as the general production-caller proof claimed here. Keep an exact-head repository-wide source/contract check as a separate closure assertion rather than relying on this journey.

AGENTS.md reference: [AGENTS.md:L231-L234](https://github.com/relativityE/speaksharp/blob/5e465ada130f3e74ad7115b7e71581418c4356c6/AGENTS.md#L231-L234)

Useful? React with 👍 / 👎.


### PR #1367 — docs(#1367): complete non-archive Markdown reconciliation + claim-by-claim code audit

- PR: https://github.com/relativityE/speaksharp/pull/1367

#### CR-026: Fetch history before validating the recorded baseline

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dPH-4`
- **Thread state:** unresolved
- **Location:** `tests/config/documentationContract.test.ts:448`
- **Created:** 2026-08-28T16:39:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Fetch history before validating the recorded baseline**

In the required full merge-candidate lane, `.github/workflows/ci.yml` runs this test in `unit-shard` after a default `actions/checkout@v6` checkout (lines 256–270), which is depth 1. The recorded baseline is the parent of the reviewed commit, so its object is absent and this `git cat-file` call exits 128, causing every full-lane run to fail even though the SHA is valid; either fetch sufficient history in that job or make the test resolve/fetch the commit without assuming it is already present.

AGENTS.md reference: [AGENTS.md:L253-L260](https://github.com/relativityE/speaksharp/blob/99322637a729843c0f68e248d8a15811d11ba078/AGENTS.md#L253-L260)

Useful? React with 👍 / 👎.

#### CR-027: Verify that the baseline is actually an ancestor

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dPH_B`
- **Thread state:** unresolved
- **Location:** `tests/config/documentationContract.test.ts:450`
- **Created:** 2026-08-28T16:39:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Verify that the baseline is actually an ancestor**

When the block mistakenly names any valid sibling or descendant commit—for example, a PR commit copied as the `main` baseline—`git cat-file` succeeds and `git rev-list <baseline>..HEAD` merely counts commits reachable from `HEAD` but not that commit; a small count therefore passes even though the baseline is not an ancestor at all. Add an explicit `git merge-base --is-ancestor <baseline> HEAD` check so this assertion enforces the relationship its name promises and cannot approve a false moving-main SHA.

AGENTS.md reference: [AGENTS.md:L49-L51](https://github.com/relativityE/speaksharp/blob/99322637a729843c0f68e248d8a15811d11ba078/AGENTS.md#L49-L51)

Useful? React with 👍 / 👎.

#### CR-028: Exclude the currency block when checking readable prose

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dPH_I`
- **Thread state:** unresolved
- **Location:** `tests/config/documentationContract.test.ts:438`
- **Created:** 2026-08-28T16:39:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Exclude the currency block when checking readable prose**

If a future update changes only the machine-readable block while leaving `ACTIVE_COORDINATION.md`'s `Current baseline` prose stale, these assertions still pass because both full Markdown strings contain the baseline inside the block being tested. `RELEASE_STATUS.md` has a later table-specific assertion, but the coordination document has no equivalent, so the guard permits exactly the machine-state-versus-reader-state contradiction it is intended to prevent; strip the block or target the baseline section before searching.

Useful? React with 👍 / 👎.


### PR #1369 — fix(#1304): artifact completeness and mandatory retention — a run can no longer keep nothing

- PR: https://github.com/relativityE/speaksharp/pull/1369

#### CR-029: Point reproduction at the tree containing the fixed generator

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZFC7`
- **Thread state:** unresolved
- **Location:** `evidence-runs/README.md:13`
- **Created:** 2026-08-29T10:16:56Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Point reproduction at the tree containing the fixed generator**

Following this command literally checks out `0e2fffd1`, whose `--pins-only` branch neither emits successful-arm rows nor runs the new completeness check; it therefore recreates the old incomplete artifact rather than the committed 15-row file. Point the command to a commit containing this generator so the evidence is reproducible from its stated source.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/07b49c0027d8c84ca910e1a83f811c0b4acda4bc/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.

#### CR-030: Retain the documented frozen-600 artifact

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZFC-`
- **Thread state:** unresolved
- **Location:** `evidence-runs/README.md:27`
- **Created:** 2026-08-29T10:16:56Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Retain the documented frozen-600 artifact**

A repo-wide `rg --files` finds no `frozen-600-main-0e2fffd1.json`, although this section calls it produced and assigns it a frozen identity. Consumers therefore cannot inspect the selection benchmark's scores or provenance; commit the artifact or describe the run as pending rather than retained evidence.

AGENTS.md reference: [AGENTS.md:L111-L114](https://github.com/relativityE/speaksharp/blob/07b49c0027d8c84ca910e1a83f811c0b4acda4bc/AGENTS.md#L111-L114)

Useful? React with 👍 / 👎.


### PR #1371 — feat(#1304): reconcile contaminated arms — score equivalence, per-utterance, fail-closed

- PR: https://github.com/relativityE/speaksharp/pull/1371

#### CR-031: Reject missing or incomplete utterance evidence

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZElX`
- **Thread state:** unresolved
- **Location:** `scripts/reconcile-contaminated-arms.mts:101`
- **Created:** 2026-08-29T10:15:48Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject missing or incomplete utterance evidence**

When both artifacts omit `perUtterance`, or both contain the same incomplete subset, these nullish fallbacks compare empty/partial lists and the success predicate exits 0; the tool can therefore claim “same utterance ids” after comparing zero rather than the required 600. Require both arrays to exist and contain exactly 600 unique expected IDs before performing the field comparisons.

AGENTS.md reference: [AGENTS.md:L218-L219](https://github.com/relativityE/speaksharp/blob/99df2709991444fb0e500c29119c7ea80efa7765/AGENTS.md#L218-L219)

Useful? React with 👍 / 👎.

#### CR-032: Require the rerun configuration fingerprint to match

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZElZ`
- **Thread state:** unresolved
- **Location:** `scripts/reconcile-contaminated-arms.mts:117`
- **Created:** 2026-08-29T10:15:48Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Require the rerun configuration fingerprint to match**

When a rerun uses changed model/runtime bytes, route, backend, or corpus but happens to produce the same scores, this predicate still approves replacing the original timing. The browser artifact already emits a `fingerprint` that binds those properties, including the corpus digest, so accepting a missing or different fingerprint mixes measurements from different experiments; require equal nonempty fingerprints before reporting score equivalence.

AGENTS.md reference: [AGENTS.md:L221-L222](https://github.com/relativityE/speaksharp/blob/99df2709991444fb0e500c29119c7ea80efa7765/AGENTS.md#L221-L222)

Useful? React with 👍 / 👎.


### PR #1370 — docs(#1304): record the frozen-600 latency contamination and its disposition

- PR: https://github.com/relativityE/speaksharp/pull/1370

#### CR-033: Reject contaminated rows in the qualifier

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZFFK`
- **Thread state:** unresolved
- **Location:** `evidence-runs/frozen-600-contamination.md:42`
- **Created:** 2026-08-29T10:17:03Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject contaminated rows in the qualifier**

When these pre-rerun rows are passed to the selection policy, this statement is not enforced: `qualify()` in `tests/evidence/certification/selectionPolicy.ts` only rejects a p95 RTF that is null or at least 1.0, while the generated verdict contains numeric contaminated timings and has no contamination flag. An affected arm whose polluted p95 is below 1.0 can therefore still qualify; null the affected speed fields in the consumable artifact or add a contamination state that `qualify()` rejects.

AGENTS.md reference: [AGENTS.md:L111-L114](https://github.com/relativityE/speaksharp/blob/3d3f211c419557e618e9ca1bd9b2aafdb05c38bf/AGENTS.md#L111-L114)

Useful? React with 👍 / 👎.

#### CR-034: Reference a reachable execution tree for the rerun

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZFFO`
- **Thread state:** unresolved
- **Location:** `evidence-runs/frozen-600-contamination.md:36`
- **Created:** 2026-08-29T10:17:03Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reference a reachable execution tree for the rerun**

A fresh checkout containing this commit cannot resolve `a299c805` with `git cat-file`, and a repository-wide search finds the hash only in this document; the timeline anchor `97b4d9a7` is likewise unavailable. Consequently another operator cannot reproduce the required code tree or independently validate the timestamp provenance, so record a full, repository-reachable commit/tree identifier before prescribing the rerun.

AGENTS.md reference: [AGENTS.md:L111-L111](https://github.com/relativityE/speaksharp/blob/3d3f211c419557e618e9ca1bd9b2aafdb05c38bf/AGENTS.md#L111-L111)

Useful? React with 👍 / 👎.


### PR #1372 — refactor(#1304): delete the retired universal-score UI, keep the shadow score

- PR: https://github.com/relativityE/speaksharp/pull/1372

#### CR-035: Reconcile the deleted test with the RC inventory

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dZTxj`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/session/__tests__/retiredScoreUi.guard.test.ts:10`
- **Created:** 2026-08-29T10:47:38Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reconcile the deleted test with the RC inventory**

When release operators use the repository-designated test inventory, `product_release/RC_TEST_INVENTORY.md:191` still counts the now-deleted `SpeakingTipsCard.component.test.tsx` as Gate 5 evidence. That leaves a release claim pointing to a test that cannot be rerun; update the inventory with the retirement or name replacement evidence before deleting this test.

AGENTS.md reference: [AGENTS.md:L54-L56](https://github.com/relativityE/speaksharp/blob/f7400f15805dff8dbe9b2ab85f40952912cc123e/AGENTS.md#L54-L56)

Useful? React with 👍 / 👎.


### PR #1317 — HISTORICAL POST-MVP — regenerate trusted PR governance; do not merge

- PR: https://github.com/relativityE/speaksharp/pull/1317

#### CR-036: Compare declared SHAs with the event payload

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axJum`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:11:28Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Compare declared SHAs with the event payload**

The validator only checks that the two author-entered head values equal each other and that the base value looks hexadecimal; it never compares them with `pull_request.head.sha` or `pull_request.base.sha` from the event already loaded in `main()`. A review-ready PR can therefore retain identical SHAs from an older push—or enter fabricated values—and this exact-artifact check still passes, allowing evidence for the wrong revision to qualify.

AGENTS.md reference: [AGENTS.md:L127-L130](https://github.com/relativityE/speaksharp/blob/a273c7a75a2d8d6e1155943b2bd1723ff3285d19/AGENTS.md#L127-L130)

Useful? React with 👍 / 👎.

#### CR-037: Run the contract validator from trusted code

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axJuq`
- **Thread state:** unresolved, outdated
- **Location:** `.github/workflows/pr-evidence-contract.yml`
- **Created:** 2026-08-20T10:11:28Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Run the contract validator from trusted code**

Because the preceding checkout selects the PR head, this command executes the PR-controlled copy of `scripts/pr-evidence-contract.mjs`. Any PR that changes that script can make both `--self-test` and normal validation return success, so the required check can report green precisely when the gate itself is weakened; execute a trusted base-revision validator or separately verify the validator artifact before running it.

AGENTS.md reference: [AGENTS.md:L138-L140](https://github.com/relativityE/speaksharp/blob/a273c7a75a2d8d6e1155943b2bd1723ff3285d19/AGENTS.md#L138-L140)

Useful? React with 👍 / 👎.

#### CR-038: Permit the declared under-review lifecycle phase

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axJux`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:11:28Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Permit the declared under-review lifecycle phase**

When a PR actually enters Phase 3, following the new lifecycle requires changing `Current phase` to Phase 3 and recording the active review return; editing the body retriggers this workflow, but every non-draft is unconditionally required to remain Phase 2 here (and the following check requires the return to be resolved). Consequently the mandatory check fails whenever the PR truthfully records its documented under-review state, so validation needs to model Phase 3 rather than treating every non-draft event as review-ready.

AGENTS.md reference: [AGENTS.md:L104-L111](https://github.com/relativityE/speaksharp/blob/a273c7a75a2d8d6e1155943b2bd1723ff3285d19/AGENTS.md#L104-L111)

Useful? React with 👍 / 👎.

#### CR-039: Scope unchecked-box validation to review readiness

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axJuz`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:11:28Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Scope unchecked-box validation to review readiness**

For a non-draft PR containing an unchecked task anywhere in its body—for example, an acceptance-criteria or explicitly out-of-scope checklist—this repository-wide regex fails the contract even when every checkbox under `## Review readiness` is checked. Since the diagnostic says it is enforcing only review-readiness boxes, apply the check to that section so unrelated task lists do not block review.

Useful? React with 👍 / 👎.

#### CR-040: Validate the required cache refresh action

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axrC7`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:41:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Validate the required cache refresh action**

When browser proof is `REQUIRED`, this branch validates the release SHAs, match flag, and selectors but never validates `Cache/reload action`; even `N/A — no browser evidence used` passes, as demonstrated by the new required-browser unit case leaving that value unchanged. This can qualify evidence collected from a stale cached bundle despite the repository requiring a new context or cache-disabled reload.

AGENTS.md reference: [AGENTS.md:L131-L134](https://github.com/relativityE/speaksharp/blob/00d28dc8ec5092d483571208a4f5bb7f2cdcadb8/AGENTS.md#L131-L134)

Useful? React with 👍 / 👎.

#### CR-041: Exclude code-fenced content from contract parsing

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axrC9`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:41:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Exclude code-fenced content from contract parsing**

These heading checks operate on comment-stripped Markdown without excluding fenced code blocks, and the field/section checks have the same behavior. Wrapping the body after the marker in `~~~` leaves `validatePrBody` returning no errors, even though GitHub renders the entire supposed contract as code rather than actual headings, fields, or checklists, producing a false-green mandatory control.

AGENTS.md reference: [AGENTS.md:L101-L102](https://github.com/relativityE/speaksharp/blob/00d28dc8ec5092d483571208a4f5bb7f2cdcadb8/AGENTS.md#L101-L102)

Useful? React with 👍 / 👎.

#### CR-042: Parse artifact hashes independently of path names

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axrDB`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T10:41:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Parse artifact hashes independently of path names**

The regex treats every 7-or-more-character hexadecimal-looking substring in the entire field as a hash prefix, including substrings in artifact paths. A correct entry such as `backend/supabase/migrations/20260817140000_...sql=<64-char SHA-256>` is therefore rejected because the migration timestamp is classified as a short hash; this breaks the mandatory check for the repository's normal timestamp-named migrations when hashes are reported with their artifact names.

AGENTS.md reference: [AGENTS.md:L127-L130](https://github.com/relativityE/speaksharp/blob/00d28dc8ec5092d483571208a4f5bb7f2cdcadb8/AGENTS.md#L127-L130)

Useful? React with 👍 / 👎.

#### CR-043: Resolve the governing reference only from its section

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6axrDD`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs:105`
- **Created:** 2026-08-20T10:41:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Resolve the governing reference only from its section**

This extracts `Refs`, `Fixes`, or `Closes` references from the entire PR body rather than `## Governing issue`. If that section remains unfilled while an older qualifying issue is mentioned under evidence, limitations, or out-of-scope text, the older issue is fetched and the issue-first gate passes without the PR naming its actual governing issue.

AGENTS.md reference: [AGENTS.md:L124-L126](https://github.com/relativityE/speaksharp/blob/00d28dc8ec5092d483571208a4f5bb7f2cdcadb8/AGENTS.md#L124-L126)

Useful? React with 👍 / 👎.

#### CR-044: Require the full CI lane before recording PASS

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ayS-V`
- **Thread state:** unresolved, outdated
- **Location:** `.github/workflows/pr-evidence-contract.yml`
- **Created:** 2026-08-20T11:18:06Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Require the full CI lane before recording PASS**

When an issue-first PR is opened as Draft, `ci.yml` can complete successfully using only `draft-checks`; marking it ready triggers this workflow but not `ci.yml`, whose default `pull_request` activity types exclude `ready_for_review`. This query then treats that same-head Draft workflow's overall `success` as final CI and allows review readiness without any full-lane jobs. Checked `gh run list --help`: `--commit` only filters by SHA, while `event` is a separate field; neither establishes which jobs ran. Inspect the run's full-lane contexts or require a qualifying full-evidence result before emitting `PASS`.

AGENTS.md reference: [AGENTS.md:L302-L310](https://github.com/relativityE/speaksharp/blob/bb729f943d324c1539c452c180f576172a6917de/AGENTS.md#L302-L310)

Useful? React with 👍 / 👎.

#### CR-045: Reject an unresolved governing issue

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ayS-c`
- **Thread state:** unresolved
- **Location:** `scripts/pr-evidence-contract.mjs:124`
- **Created:** 2026-08-20T11:18:06Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject an unresolved governing issue**

When every referenced number is nonexistent, is another PR, or postdates this PR, `governing_issue.json` remains `null`; `loadActual()` consequently supplies `undefined` for all three issue checks, but these conditions reject only literal `false`. A body containing a syntactically valid fake `Refs #...` therefore passes with a null AC hash even though no governing issue or acceptance criteria were found. Treat a missing resolved issue as failure rather than an unknown value.

AGENTS.md reference: [AGENTS.md:L129-L131](https://github.com/relativityE/speaksharp/blob/bb729f943d324c1539c452c180f576172a6917de/AGENTS.md#L129-L131)

Useful? React with 👍 / 👎.

#### CR-046: Preserve or ingest required FULL-tier evidence

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ayS-h`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T11:18:06Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve or ingest required FULL-tier evidence**

For every FULL-tier PR, `emitBlock()` creates only the `final-ci` record, and the workflow replaces the entire managed block with this output on every run. Since authors are instructed not to edit the block and no workflow input supplies mutation or browser records, the later mandatory mutation check can never succeed, permanently blocking migrations, auth, billing, persistence, and other FULL changes. Gather the required evidence or reconcile it into the emitted block instead of discarding it.

AGENTS.md reference: [AGENTS.md:L120-L126](https://github.com/relativityE/speaksharp/blob/bb729f943d324c1539c452c180f576172a6917de/AGENTS.md#L120-L126)

Useful? React with 👍 / 👎.

#### CR-047: Classify browser-facing product changes as FULL

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ayS-m`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T11:18:06Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Classify browser-facing product changes as FULL**

User-visible behavioral changes under common paths such as `frontend/src/components`, `frontend/src/hooks`, or `frontend/src/pages` match none of these rules and therefore default to LIGHT. Such PRs can qualify with CI alone, bypassing the structured browser/deployed-SHA evidence that the declared tier contract requires for browser work; add trusted rules covering browser-facing product paths or otherwise classify by affected behavior.

AGENTS.md reference: [AGENTS.md:L120-L126](https://github.com/relativityE/speaksharp/blob/bb729f943d324c1539c452c180f576172a6917de/AGENTS.md#L120-L126)

Useful? React with 👍 / 👎.

#### CR-048: Recompute evidence when acceptance criteria change

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS53`
- **Thread state:** unresolved
- **Location:** `.github/workflows/pr-evidence-contract.yml:16`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Recompute evidence when acceptance criteria change**

When the governing issue's Acceptance-criteria section is edited after this check has passed, no event listed here runs because the workflow subscribes only to `pull_request` activity. The managed `ac_hash` and successful required check therefore remain current on GitHub, and the PR is not returned to Draft, allowing evidence tied to the old intent clock to qualify until some unrelated PR event occurs. Add an issue-edit trigger or equivalent dispatch that resolves affected PRs, invalidates their evidence, and converts them to Draft.

AGENTS.md reference: [AGENTS.md:L109-L113](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L109-L113)

Useful? React with 👍 / 👎.

#### CR-049: Reject author-supplied evidence records

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS56`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject author-supplied evidence records**

When a FULL-tier PR author edits the visible managed JSON to add a `PASS` mutation or browser record using the current hashes, this preservation path accepts every non-CI record and rewrites it unchanged; `validatePr` then treats its type and status as proof. Fresh evidence in this revision is that the new preservation implementation lets a frontend FULL body with an empty-link, author-supplied mutation validate with no errors, so evidence must instead be ingested from a trusted run/artifact source rather than copied from author-editable PR text.

AGENTS.md reference: [AGENTS.md:L114-L128](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L114-L128)

Useful? React with 👍 / 👎.

#### CR-050: Require browser evidence for browser-facing changes

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS59`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Require browser evidence for browser-facing changes**

For any `frontend/src` change classified as FULL, this branch requires only a passing mutation record; it never requires a browser record or deployed-SHA assertion. Fresh evidence after the browser-path classification fix is that the added FULL test accepts `frontend/src/services/x.ts` with only CI and mutation evidence, so browser-facing work can still qualify without proving that the observed deployment matches the reviewed head.

AGENTS.md reference: [AGENTS.md:L120-L126](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L120-L126)

Useful? React with 👍 / 👎.

#### CR-051: Re-run the contract after final CI completes

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS6C`
- **Thread state:** unresolved
- **Location:** `.github/workflows/pr-evidence-contract.yml:16`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Re-run the contract after final CI completes**

For a LIGHT Draft PR, `ready_for_review` commonly observes the earlier draft-only CI run and records `PENDING`; after the documented `force_full=true` dispatch completes, this workflow receives no completion event and therefore leaves its required check red until an unrelated PR edit or review request retriggers it. Checked `.github/workflows/ci.yml`: its default `pull_request` trigger does not add `ready_for_review`, and no repository workflow dispatches this contract on `workflow_run`, so the contract should wait for or be triggered by completion of the exact-head full lane.

AGENTS.md reference: [AGENTS.md:L314-L327](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L314-L327)

Useful? React with 👍 / 👎.

#### CR-052: Classify evidence-control files as FULL

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS6I`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/pr-evidence-contract.mjs`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Classify evidence-control files as FULL**

Changes to `scripts/pr-evidence-contract.mjs` and `.github/workflows/pr-evidence-contract.yml` match none of these FULL rules—the new tests even assert that the validator script is LIGHT—so a future change to the trusted validator, schema, or workflow can qualify with CI alone and without the required independent defect-class mutation. Add explicit control-path rules for the evidence contract and other trusted shared/core configuration so changes cannot become the next enforcement authority through the LIGHT lane.

AGENTS.md reference: [AGENTS.md:L120-L128](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L120-L128)

Useful? React with 👍 / 👎.

#### CR-053: Record whether the PR originally opened as Draft

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS6P`
- **Thread state:** unresolved
- **Location:** `scripts/pr-evidence-contract.mjs:113`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Record whether the PR originally opened as Draft**

The validator receives only the PR's current `draft` value, so a PR opened ready-for-review can later pass after CI completes and any body edit retriggers validation; no fact records or checks its state at the `opened` event. That leaves the declared mechanical issue-first requirement unenforced—persist the opening state from the authoritative event or reject PRs whose opening event was non-draft.

AGENTS.md reference: [AGENTS.md:L129-L135](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L129-L135)

Useful? React with 👍 / 👎.

#### CR-054: Remove the obsolete author-attestation contract

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6azS6V`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/RELEASE_STATUS.md`
- **Created:** 2026-08-20T12:10:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Remove the obsolete author-attestation contract**

This newly authoritative section still requires authors to attest freshness and use prose statuses such as `QUALIFIED`, but the same change replaces those controls with bot-owned enum evidence and explicitly forbids mechanical author-attestation requirements. Anyone following the release-status authority is therefore directed to provide fields absent from the new PR template and incompatible with the stated two-clock model; update this section to describe the bot-owned contract instead.

AGENTS.md reference: [AGENTS.md:L129-L135](https://github.com/relativityE/speaksharp/blob/b72093f4686d45aadf22e569bb8933299d29a228/AGENTS.md#L129-L135)

Useful? React with 👍 / 👎.


### PR #1303 — HISTORICAL BILLING — fresh re-cut after retention, Stage-B, and #1259

- PR: https://github.com/relativityE/speaksharp/pull/1303

#### CR-055: Exercise the actual signup-trial-to-paid path

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Zn3ec`
- **Thread state:** unresolved
- **Location:** `scripts/billing-qualification/runner.ts:218`
- **Created:** 2026-08-16T15:57:12Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Exercise the actual signup-trial-to-paid path**

When this weekly lane is treated as proof of the product’s trial-to-paid conversion, `trial_period_days: 30` tests a different lifecycle: the production trial is granted at account creation by `ensure_trial_profile_for_new_user` (`20260812040000_thirty_day_trial_lifecycle_1282.sql:115-138`) without a card, while the production Checkout session (`stripe-checkout/index.ts:317-348`) creates an immediately billable subscription and supplies no Stripe trial. This synthetic subscription therefore adds a second, card-backed 30-day trial and can remain green even if the real database trial expiration followed by immediate paid continuation is broken, invalidating the release evidence this change claims to add. Model the database-backed trial first and invoke the same immediate-charge subscription shape used by Checkout at conversion.

AGENTS.md reference: [AGENTS.md:L64-L66](https://github.com/relativityE/speaksharp/blob/e2f262cf42a177cc277dfe15b08496d3f69109b1/AGENTS.md#L64-L66)

Useful? React with 👍 / 👎.


### PR #1361 — DO NOT MERGE — #1360 diagnosis; split product and database findings

- PR: https://github.com/relativityE/speaksharp/pull/1361

#### CR-056: Exercise the migrated cascade instead of the obsolete FK

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6gb`
- **Thread state:** unresolved
- **Location:** `tests/db/abandonment-orphan-cleanup.integration.test.ts:36`
- **Created:** 2026-08-27T23:50:55Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Exercise the migrated cascade instead of the obsolete FK**

The repository already applies `20260625120000_usage_checkpoints_user_id_on_delete_cascade.sql` after the referenced 20260309 migration, replacing this FK with `ON DELETE CASCADE`. Recreating only the obsolete definition guarantees that the user-delete test rejects in this synthetic database even though the current migrated schema cascades, producing a false account-deletion diagnosis and remaining green while asserting the opposite of production behavior. Build the fixture from the migration chain or model the current FK.

AGENTS.md reference: [AGENTS.md:L111-L111](https://github.com/relativityE/speaksharp/blob/72e8bc04727132069b729b5cfd443fa532ed4d02/AGENTS.md#L111-L111)

Useful? React with 👍 / 👎.

#### CR-057: Reproduce the production active-session state

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6gf`
- **Thread state:** unresolved
- **Location:** `tests/db/abandonment-orphan-cleanup.integration.test.ts:50`
- **Created:** 2026-08-27T23:50:55Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reproduce the production active-session state**

Production `create_session_and_update_usage` writes abandoned placeholders as `status = 'active'` with an `expires_at`, and after expiry a subsequent creation marks them failed; this fixture instead invents an `in_progress` row without expiry and never loads either cleanup path. Consequently the `NOTHING reaps it` case merely counts two manually inserted rows and cannot establish the claimed behavior for a real abandoned session. Exercise the shipped RPC/migrations or reproduce its exact status and expiry transitions.

AGENTS.md reference: [AGENTS.md:L111-L111](https://github.com/relativityE/speaksharp/blob/72e8bc04727132069b729b5cfd443fa532ed4d02/AGENTS.md#L111-L111)

Useful? React with 👍 / 👎.

#### CR-058: Require positive progress through the Start lifecycle

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6gh`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/__tests__/abandonment.recovery.test.ts:117`
- **Created:** 2026-08-27T23:50:55Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Require positive progress through the Start lifecycle**

`returningTab` is created with `Object.create`, so constructor-initialized fields such as `activeTasks` and `commandQueue` are absent; `startRecording()` therefore rejects in `enqueue()` at `this.activeTasks.add(...)` before lifecycle work begins. This line swallows that rejection, leaves the status message idle, and lets both negative regex assertions pass, so even a regression where every Start crashes satisfies the headline test. Use an initialized controller and assert an actual lifecycle transition or callback.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/72e8bc04727132069b729b5cfd443fa532ed4d02/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.


### PR #1368 — fix(#1304): pin the inference runtimes — serve them through a verifying endpoint, bind them into the fingerprint

- PR: https://github.com/relativityE/speaksharp/pull/1368

#### CR-059: Pin the Moonshine WASM runtime too

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dYnFP`
- **Thread state:** unresolved
- **Location:** `tests/evidence/certification/arms/runtimeAssets.ts:81`
- **Created:** 2026-08-29T08:54:03Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Pin the Moonshine WASM runtime too**

When either admitted `moonshine-wasm` arm runs, this returns no runtime assets even though the preceding comment acknowledges that the package supplies `moonshine.wasm`; the `/lib/` guard only refuses `ort-wasm*.{wasm,mjs}`, so that binary is served unchecked by the generic static mount and never enters `runtimeAssetRecords` or `allArmAssets`. Consequently, changing the Moonshine runtime binary would not move the fingerprint or invalidate selection eligibility, allowing unverified benchmark evidence; route this file through the pin-enforcing endpoint and include its observed digest in the arm assets.

AGENTS.md reference: [AGENTS.md:L460-L461](https://github.com/relativityE/speaksharp/blob/5c6f76305e659e61e7e0d75247c079b0479c4418/AGENTS.md#L460-L461)

Useful? React with 👍 / 👎.


### PR #1365 — #1304 Task 3C: certified harness — four evidence blockers closed; Moonshine Streaming admitted; frozen 600 HELD on asset pinning

- PR: https://github.com/relativityE/speaksharp/pull/1365

#### CR-060: Bind aggregation to the frozen corpus manifest

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dEueV`
- **Thread state:** unresolved, outdated
- **Location:** `tests/evidence/certification/runArm.ts`
- **Created:** 2026-08-28T06:01:31Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Bind aggregation to the frozen corpus manifest**

Deriving `expectedIds` from the same caller-supplied `utterances` being measured makes every subset appear complete. If an acquisition or decode runner passes 599 of the frozen 600 clips, `aggregateArm` compares those 599 scores against those same 599 IDs and `runArm` emits a valid selection row; the added subset test even demonstrates that a sliced corpus returns `ok: true`. The expected IDs must come independently from the frozen manifest so omitted clips invalidate the arm.

Useful? React with 👍 / 👎.

#### CR-061: Bind the certificate to the arm being executed

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dEueb`
- **Thread state:** unresolved
- **Location:** `tests/evidence/certification/runArm.ts:155`
- **Created:** 2026-08-28T06:01:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Bind the certificate to the arm being executed**

In a multi-arm down-select, a caller can pass a successful `CertificationResult` from arm A while executing arm B because this guard checks only the boolean and never compares the certificate's `armId` with the current arm. The returned row then uses B's ID and provenance while carrying A's certification version, allowing an arm that failed route or oracle certification to produce a selection row; certification should be bound to the exact arm/configuration being run.

Useful? React with 👍 / 👎.

#### CR-062: Reject placeholder provenance before certifying

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dEued`
- **Thread state:** unresolved, outdated
- **Location:** `tests/evidence/certification/arms/transformersV2Arm.ts`
- **Created:** 2026-08-28T06:01:32Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject placeholder provenance before certifying**

The real v2 arm is certified before its lazy `load()` runs, so `runtime.version` is always the literal `unknown` at certification time. `checkProvenance` rejects only blank strings, causing the CLI to report provenance as complete even though the inference-library version required for reproduction is absent; initialize this from the installed package metadata or treat placeholder values as incomplete.

Useful? React with 👍 / 👎.

#### CR-063: Reject truncated WAV data chunks

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dEueh`
- **Thread state:** unresolved
- **Location:** `tests/evidence/certification/audio.ts:92`
- **Created:** 2026-08-28T06:01:32Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject truncated WAV data chunks**

When a WAV is truncated or its `data` chunk declares a size larger than the remaining file, `Buffer.subarray` silently clamps the end rather than failing. The parser then decodes the shortened bytes and reports a shorter duration, so damaged input can yield plausible transcripts and corrupt WER instead of being refused; validate that `body + size` is within the RIFF buffer before accepting the chunk.

Useful? React with 👍 / 👎.


### PR #1366 — fix(#1360): truthful recovery copy — no transcript promise the draft cannot keep

- PR: https://github.com/relativityE/speaksharp/pull/1366

#### CR-064: Keep truthful copy visible during retry recovery

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dLozi`
- **Thread state:** unresolved
- **Location:** `frontend/src/pages/SessionPage.tsx:316`
- **Created:** 2026-08-28T13:29:45Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Keep truthful copy visible during retry recovery**

When a finalized draft is successfully rehydrated, the controller publishes `pendingResolutionKind === 'full_save'`, so this condition hides the new truthful message and leaves `UnresolvedRecoveryBanner` as the sole surface. Because `hasRecoverableWords` is derived from `recoveryDraft.metrics.totalWords` at lines 294–298, that banner appends “Your words are still here” even though only a numeric count—not the words or transcript—survived. Thus users in the primary failed-save recovery path still receive the content-recovery promise this change is intended to remove; the remaining banner needs content-free wording or must distinguish transcript text from metric counts.

Useful? React with 👍 / 👎.


### PR #1364 — ACCEPTED — #1304 Task 4 frozen corpus; ready for Dev merge

- PR: https://github.com/relativityE/speaksharp/pull/1364

#### CR-065: Make CLI verification run from paths containing spaces

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dCFmI`
- **Thread state:** unresolved
- **Location:** `scripts/corpus/verify-archive.mjs:163`
- **Created:** 2026-08-28T01:37:59Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Make CLI verification run from paths containing spaces**

When the repository path contains a space or another URL-escaped character, `import.meta.url` contains percent encoding while `process.argv[1]` does not, so this comparison is false. I reproduced `node "/tmp/with space/verify-archive.mjs" /missing test-clean.tar.gz` exiting 0 with no output; consequently both fetch and long-form scripts treat verification as successful and proceed with unverified input. Compare against `pathToFileURL(process.argv[1]).href` instead.

Useful? React with 👍 / 👎.

#### CR-066: Bind sampled files to the verified archive

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dCFmL`
- **Thread state:** unresolved
- **Location:** `scripts/corpus/make-corpus-manifest.mjs:214`
- **Created:** 2026-08-28T01:37:59Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Bind sampled files to the verified archive**

If the pinned tarball remains valid but the adjacent `LibriSpeech` extraction is stale, edited, or contains extra transcript files, this verification passes and `readUtterances` subsequently samples that independent directory. The resulting manifest therefore advertises the official archive hashes while its IDs and references may not come from those archives, invalidating comparisons based on the frozen corpus. Generate from a clean extraction of the just-verified archives or otherwise verify the extracted files against them.

Useful? React with 👍 / 👎.

#### CR-067: Verify checksum values against the committed files

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dCFmO`
- **Thread state:** unresolved, outdated
- **Location:** `tests/evidence/__tests__/corpusManifest.test.ts`
- **Created:** 2026-08-28T01:37:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Verify checksum values against the committed files**

If `long-01.wav` or its reference changes while `CHECKSUMS` remains stale, these assertions still pass because they validate only that two hash-shaped strings exist. The test therefore does not enforce the claimed audio/reference freeze and a changed fixture can silently alter experimental results; compute each file's SHA-256 and compare it with the corresponding recorded value.

AGENTS.md reference: [AGENTS.md:L218-L220](https://github.com/relativityE/speaksharp/blob/a717ad7c3aa827586260be9bcccb5e3584a75c8c/AGENTS.md#L218-L220)

Useful? React with 👍 / 👎.


### PR #1362 — ACCEPTED — #1304 3B scoring seam; ready for Dev merge

- PR: https://github.com/relativityE/speaksharp/pull/1362

#### CR-068: Route benchmark producers through the guarded scorer

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6DR`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/session/__tests__/benchmarkHarnessSurface.test.tsx:470`
- **Created:** 2026-08-27T23:50:14Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Route benchmark producers through the guarded scorer**

This boundary only rejects the legacy frontend scorer, so all three authoritative specs still pass while importing and calling the raw `tests/evidence/werMetric.wordErrorRate` directly (for example, `private-decode-params-ab.live.spec.ts:8` and `private-longform-timing.live.spec.ts:8`). A repository-wide search at this commit finds no production/live caller of `scoreBenchmarkRun`; consequently its invalid-run guard and aggregate behavior are never exercised by actual benchmark runs, while this change removes the previous ordering regression check. Require these specs to import the new seam rather than merely prohibiting `calculateWordErrorRate`.

Useful? React with 👍 / 👎.


### PR #1363 — RETURN — #1304 Task 4: freeze verified LibriSpeech corpus identity

- PR: https://github.com/relativityE/speaksharp/pull/1363

#### CR-069: Pin and verify the expected archive hashes

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6vn`
- **Thread state:** unresolved
- **Location:** `scripts/corpus/fetch-librispeech.sh:50`
- **Created:** 2026-08-27T23:51:13Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Pin and verify the expected archive hashes**

When OpenSLR replaces an archive with different valid bytes but the same byte count, this command simply records the new digest and the manifest generator subsequently trusts it; nothing compares the download with a previously approved SHA-256, so the changed corpus silently becomes the new “identity” and can alter samples and benchmark results. Store the expected hashes in the repository and verify them before extraction instead of deriving the expected identity from the downloaded files.

Useful? React with 👍 / 👎.

#### CR-070: Reject an incomplete corpus before writing the manifest

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6vt`
- **Thread state:** unresolved
- **Location:** `scripts/corpus/make-corpus-manifest.mjs:104`
- **Created:** 2026-08-27T23:51:13Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject an incomplete corpus before writing the manifest**

If either extraction is incomplete or transcript files are missing, `seededSample` returns the smaller pool and the generator still writes a successful manifest whose declared `subsetSize` is 300; for example, a directory containing one valid transcript produces `selected: 1`. That permits benchmark runs over an accidentally truncated and potentially biased corpus, so validate the expected available counts and require exactly 300 selected entries for both sets before writing the manifest.

AGENTS.md reference: [AGENTS.md:L218-L219](https://github.com/relativityE/speaksharp/blob/cdd244fc17be6e81b41f2254f990d0cdc9b25ef2/AGENTS.md#L218-L219)

Useful? React with 👍 / 👎.

#### CR-071: Resume partial archive downloads instead of skipping them

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dA6vw`
- **Thread state:** unresolved
- **Location:** `scripts/corpus/fetch-librispeech.sh:36`
- **Created:** 2026-08-27T23:51:13Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Resume partial archive downloads instead of skipping them**

After an interrupted transfer exhausts curl's retries and leaves a partial archive, every subsequent invocation enters this `else` branch, skips curl, and fails the size check, so the `--continue-at -` option (documented by `curl --help all` as “Resumed transfer offset”) can never resume that file. Operators must manually delete and restart a potentially large download; invoke curl for undersized existing archives so the intended resume behavior is reachable.

Useful? React with 👍 / 👎.


### PR #1346 — fix(#1304) Task 3A: shared decode builder + route identity (un-parked)

- PR: https://github.com/relativityE/speaksharp/pull/1346

#### CR-072: Hash the effective decode route instead of the defaults

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dABdL`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/transcription/decodeRoute.ts:50`
- **Created:** 2026-08-27T22:33:08Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Hash the effective decode route instead of the defaults**

When an evidence run uses supported runtime overrides, this resolver records a route that the engine did not execute: both engines apply `decodeOptions` after `buildShippingDecodeOptions` (for example, `return_timestamps: false` replaces the returned `true`), and the v4 loader can similarly replace the variant's decoder dtype through `v4DecoderDtype`. Because this API accepts neither effective options nor the resolved dtype, such runs receive the same identity as the default route and can be treated as comparable despite decoding differently; construct the identity from the final options/model configuration passed to the pipeline.

AGENTS.md reference: [AGENTS.md:L460-L461](https://github.com/relativityE/speaksharp/blob/ca283414c03c4e3291959558c48ca021d24aeaf6/AGENTS.md#L460-L461)

Useful? React with 👍 / 👎.

#### CR-073: Include nested dtype fields in the route hash

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6dABdT`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/transcription/decodeRoute.ts:68`
- **Created:** 2026-08-27T22:33:08Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Include nested dtype fields in the route hash**

When two v4 routes use the same model but different quantization, the replacer array passed to `JSON.stringify` is also applied to nested objects; because `encoder_model` and `decoder_model_merged` are absent from the top-level key list, every `dtype` serializes as `{}`. Consequently q4, fp32, or other decoder configurations can produce identical hashes, defeating the route-identity check for the exact dtype experiments this object is intended to distinguish; canonicalize nested values recursively instead.

AGENTS.md reference: [AGENTS.md:L460-L461](https://github.com/relativityE/speaksharp/blob/ca283414c03c4e3291959558c48ca021d24aeaf6/AGENTS.md#L460-L461)

Useful? React with 👍 / 👎.


### PR #1347 — fix(#1347): Private browser capability gate — WebAssembly, not the retired Web Speech API

- PR: https://github.com/relativityE/speaksharp/pull/1347

#### CR-074: Mount the capability gate on the active practice page

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c_igC`
- **Thread state:** unresolved
- **Location:** `frontend/src/hooks/useBrowserSupport.ts:56`
- **Created:** 2026-08-27T21:58:24Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Mount the capability gate on the active practice page**

At this commit, `App.tsx` routes both `/` and `/practice` to `PracticePage`, while a repo-wide reference search shows that this hook is consumed only by `Index.tsx` and `MainPage.tsx`, neither of which is imported by the application. Consequently, the changed predicate and warning copy never execute in the shipped route: for example, an authenticated user with blocked storage still reaches a disabled Start without this warning. Wire the hook and warning into the canonical routed surface rather than testing these unused pages.

Useful? React with 👍 / 👎.


### PR #1359 — test(#1352) B: execute the shipped newest-two retention contract (first time, anywhere)

- PR: https://github.com/relativityE/speaksharp/pull/1359

#### CR-075: Apply the real Stage A schema before exercising v2

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c-ptW`
- **Thread state:** unresolved
- **Location:** `tests/db/retention-contract-shipped.integration.test.ts:335`
- **Created:** 2026-08-27T21:03:26Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Apply the real Stage A schema before exercising v2**

The bootstrap hand-creates `next_action_signal` and omits the already-applied `20260816223606_metrics_only_additive_1306.sql`, whose trigger and CHECK require the six-field enum/numeric action shape. Consequently this fixture's `{"kind":"practice_again"}` succeeds only in the weakened test schema; on the shipped schema every `completeViaV2` call would be rejected before retention runs. Load Stage A and supply a valid product-shaped action so these tests actually exercise `complete_session_v2` under production constraints.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/55d74e7c6a609f6552ed7a34728e859b698592fe/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.


### PR #1358 — docs: currentize RELEASE_STATUS + ACTIVE_COORDINATION (five-week-stale SSOTs)

- PR: https://github.com/relativityE/speaksharp/pull/1358

#### CR-076: Remove the duplicate deployment SSOT

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c9maz`
- **Thread state:** unresolved
- **Location:** `product_release/ACTIVE_COORDINATION.md:9`
- **Created:** 2026-08-27T20:04:57Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Remove the duplicate deployment SSOT**

When `main` advances or Vercel leaves production behind, this copied deployment SHA can become stale independently of `RELEASE_STATUS.md`, recreating the exact stale-status problem this change is intended to fix. `ACTIVE_COORDINATION.md` itself says deployment posture belongs in `RELEASE_STATUS.md`, so replace this moving production value with a pointer to the canonical document rather than maintaining a second release identity.

AGENTS.md reference: [AGENTS.md:L49-L51](https://github.com/relativityE/speaksharp/blob/455181519fbd1b56758b2b5321343e69f9791268/AGENTS.md#L49-L51)

Useful? React with 👍 / 👎.

#### CR-077: Reconcile the contradictory STT posture

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c9ma5`
- **Thread state:** unresolved
- **Location:** `product_release/RELEASE_STATUS.md:78`
- **Created:** 2026-08-27T20:04:57Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reconcile the contradictory STT posture**

These rows now correctly say Browser and Cloud are removed, but the same authoritative document still calls Browser the current Free convenience path and Cloud available to existing paid-Pro accounts at lines 41–42, while lines 52 and 86 continue describing only Free users as lacking Cloud. A tester or release operator therefore receives mutually exclusive current availability guidance; retire or explicitly historicize those earlier bullets and update the release-track wording as part of this correction.

AGENTS.md reference: [AGENTS.md:L455-L456](https://github.com/relativityE/speaksharp/blob/455181519fbd1b56758b2b5321343e69f9791268/AGENTS.md#L455-L456)

Useful? React with 👍 / 👎.


### PR #1357 — RETURN — fix(#1304) Task 2: authoritative benchmark specs read the real product surface

- PR: https://github.com/relativityE/speaksharp/pull/1357

#### CR-078: Read the persisted transcript instead of absent debug text

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c8Ykc`
- **Thread state:** unresolved
- **Location:** `tests/live/benchmark-webgpu.live.spec.ts:87`
- **Created:** 2026-08-27T18:59:06Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Read the persisted transcript instead of absent debug text**

After every successful Stop, this value is still always `''`: `waitForBenchmarkSaveCandidate()` reads `window.__SPEECH_RUNTIME_DEBUG__().saveCandidate`, but `SpeechRuntimeController.ts:3293-3300` deliberately exposes only `selectedForSaveLength` and never `selectedForSave`. Consequently this guard rejects every WebGPU run, and the identical assumption at `private-decode-params-ab.live.spec.ts:129` and `private-longform-timing.live.spec.ts:71` makes those two authoritative specs fail unconditionally as well. Obtain the hypothesis through the persisted, verified transcript evidence path rather than expecting transcript content in the privacy-sanitized debug payload.

AGENTS.md reference: [AGENTS.md:L460-L461](https://github.com/relativityE/speaksharp/blob/6f90e92839e758e751f62c6f31ce404d75dfc1ec/AGENTS.md#L460-L461)

Useful? React with 👍 / 👎.

#### CR-079: Pass the raw hypothesis to the certified scorer

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c8Ykh`
- **Thread state:** unresolved
- **Location:** `tests/live/benchmark-webgpu.live.spec.ts:97`
- **Created:** 2026-08-27T18:59:06Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Pass the raw hypothesis to the certified scorer**

When the recognizer emits punctuation that separates tokens, such as `you—know` or `old-beer`, this pre-pass deletes the separator and merges the words before `wordErrorRate()` can apply its official normalizer, producing extra WER errors while the resulting row still records the official normalization identity. This is effectively the spec-local second ruler that the new guard intends to prohibit; pass `selectedForSave` directly to `wordErrorRate()` and derive any display-only counts from the scorer result.

Useful? React with 👍 / 👎.


### PR #1356 — fix(#1304) Task 1: certified WER scorer — official normalization, Track A/B separation

- PR: https://github.com/relativityE/speaksharp/pull/1356

#### CR-080: Enforce track separation in the artifact validator

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c5U71`
- **Thread state:** unresolved
- **Location:** `tests/evidence/sttEvidenceSchema.ts:383`
- **Created:** 2026-08-27T16:32:21Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Enforce track separation in the artifact validator**

This check only protects callers that invoke `finalizeRow`; the actual arbitrary-JSON boundary, `scripts/validate-stt-evidence.mjs`, neither validates `comparability_inputs.track` in its checks at lines 178-205 nor includes it in its cohort key at lines 329-333. Consequently, a scored artifact with no track—or Track A and Track B rows otherwise sharing a cohort—still passes the validator executed by `scripts/stt-corpus-lane.ts`, allowing incomparable WER results to be admitted and grouped together.

Useful? React with 👍 / 👎.

#### CR-081: Allow null normalization when WER is unmeasurable

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c5U75`
- **Thread state:** unresolved
- **Location:** `tests/evidence/corpusLane.ts:99`
- **Created:** 2026-08-27T16:32:21Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Allow null normalization when WER is unmeasurable**

When a route-proven corpus run has no ground truth or recognizer transcript, this now writes `normalizationVersion: null`, but `finalizeRow` still treats every falsy normalization version as a missing comparability input at lines 368-375. Thus `buildCorpusRow({ groundTruth: null })` becomes invalid and is excluded from latency summaries even though the new schema explicitly defines null as the honest value when WER is unmeasurable; the existing regression test checks only that WER is null and misses the invalidated row.

Useful? React with 👍 / 👎.

#### CR-082: Normalize before applying the additional-diacritics map

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c5U7-`
- **Thread state:** unresolved
- **Location:** `tests/evidence/normalization/officialNormalizer.ts:35`
- **Created:** 2026-08-27T16:32:21Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Normalize before applying the additional-diacritics map**

For characters whose NFKD expansion contains a character from `ADDITIONAL_DIACRITICS`, this ordering diverges from the pinned Whisper normalizer: upstream iterates the NFKD-normalized string and then applies the map, whereas this code checks the original character and never rechecks decomposed characters. For example, `ǿ` decomposes to `ø` plus an acute mark, so this port emits `ø` while the oracle emits `o`; such text can introduce artificial WER differences despite the scorer claiming official normalization.

Useful? React with 👍 / 👎.


### PR #1355 — fix(#1354): block the next recording until Progress evidence is terminal

- PR: https://github.com/relativityE/speaksharp/pull/1355

#### CR-083: Resolve the current owner before checking the start gate

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c2wOX`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/SpeechRuntimeController.ts:2539`
- **Created:** 2026-08-27T14:33:09Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Resolve the current owner before checking the start gate**

On a fresh reload, or after switching accounts, `capturedUserId` still represents no recording owner (or the previous recording's owner) until the later `auth.getSession()` result assigns it. Consequently this check can ignore the authenticated viewer's queued gate; the mobile sticky action remains enabled because it only receives `isButtonDisabled`, so tapping it after a reload with debt calls `evaluateStartGate(null, ...)`, which allows Start and bypasses the new invariant. Conversely, stale debt for a previous account can block the new account. Resolve the current authenticated owner before this check rather than using recording-bound state.

Useful? React with 👍 / 👎.

#### CR-084: Decouple recommendation work from the terminal gate result

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6c2wOd`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/progress/recordProgress.ts:412`
- **Created:** 2026-08-27T14:33:09Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Decouple recommendation work from the terminal gate result**

When the evaluation succeeds, its durable obligation is already cleared, but the function still awaits recommendation creation and attempt resolution before returning `recorded`. If any of those Supabase reads/RPCs hangs, the controller remains in the awaited stop path with the gate stuck at `resolving`; if one rejects, the controller converts the result to `unresolved` even though the evaluation is terminal. The new deadline only covers `recordProgressEvaluation`, so non-gating recommendation work needs to be bounded or handled separately from the evaluation outcome.

Useful? React with 👍 / 👎.


### PR #1353 — fix(#1352): prove canonical-project read authority

- PR: https://github.com/relativityE/speaksharp/pull/1353

#### CR-085: Read the project reference from the `id` field

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ccJvL`
- **Thread state:** unresolved
- **Location:** `tests/helpers/readEndpointAuthority.ts:114`
- **Created:** 2026-08-26T11:33:19Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Read the project reference from the `id` field**

Supabase's `GET /v1/projects/{ref}` response identifies the project with `id`, not `ref`. Consequently, every valid live response is classified as `malformed_response`; the standalone preflight fails closed, and the production proof receives `unknown` instead of the intended `primary-proven` verdict. The unit tests conceal this by fabricating responses containing `{ ref: REF }`; parse and compare the documented `id` field instead.

Useful? React with 👍 / 👎.


### PR #1351 — RETURN — fix(#1306): make attempt 9 authoritative

- PR: https://github.com/relativityE/speaksharp/pull/1351

#### CR-086: Pin the actual Node version before running the probe

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6cS0zV`
- **Thread state:** unresolved
- **Location:** `.github/workflows/three-session-retention-proof.yml:113`
- **Created:** 2026-08-26T00:17:39Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Pin the actual Node version before running the probe**

In the inspected production-proof workflow, this command is not actually preceded by the claimed `.nvmrc` pin: `.github/actions/setup-environment/action.yml` lines 47–50 configure `node-version: '22'`, which selects a mutable 22.x release rather than 22.12.0. Because this probe depends on the experimental TypeScript stripping behavior, a later workflow run can execute different runtime semantics while still being presented as pinned evidence; configure the setup action to use `.nvmrc` (or add an exact setup step here) before invoking the script.

Useful? React with 👍 / 👎.

#### CR-087: Restrict the authoritative preflight to the reviewed SHA

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6cS0zX`
- **Thread state:** unresolved
- **Location:** `.github/workflows/read-authority-preflight.yml:12`
- **Created:** 2026-08-26T00:17:39Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Restrict the authoritative preflight to the reviewed SHA**

When this workflow is dispatched with a non-default branch or tag selected as its ref, checkout and the classifier both run from that arbitrary ref, yet a green result is indistinguishable from the intended post-merge preflight and can be used to authorize attempt 9. Add a default-branch and/or expected-SHA gate like the production proof already has so the result establishes the reviewed implementation rather than merely whichever ref an operator selected.

AGENTS.md reference: [AGENTS.md:L276-L278](https://github.com/relativityE/speaksharp/blob/a582bfc289dc3c9d56ea7dbe1aa89c59cd912613/AGENTS.md#L276-L278)

Useful? React with 👍 / 👎.


### PR #1349 — fix(#1306): split the transcript assertion by lifecycle phase, remove the looped-audio confound

- PR: https://github.com/relativityE/speaksharp/pull/1349

#### CR-088: Wait for the minimum recording duration before stopping

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6cJOA2`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:387`
- **Created:** 2026-08-25T15:55:46Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Wait for the minimum recording duration before stopping**

When Private recognition produces 12 draft characters within the first five seconds, this await resolves immediately and the next statement clicks Stop. `useSessionLifecycle.handleStartStop` deliberately treats recordings shorter than `MIN_SESSION_DURATION_SECONDS` (5 seconds) as too short and returns without a persisted completion, so the subsequent save-candidate/persistence waits time out instead of exercising the three retention writes. The `60_000` argument is only a timeout, not a recording duration; explicitly wait for the product minimum before stopping.

Useful? React with 👍 / 👎.

#### CR-089: Wait for the current recording's save candidate

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6cJOA4`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:392`
- **Created:** 2026-08-25T15:55:46Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Wait for the current recording's save candidate**

On recordings 2 and 3, this call can immediately return recording 1's candidate: `__SPEECH_RUNTIME_DEBUG__().saveCandidate` exposes `lastSaveCandidateDebug`, which is assigned during finalization but never cleared when the next recording starts. Consequently, `expectFinalizedTranscriptOutput` can validate old word counts and log the current phase as complete before the current candidate exists; require the candidate's `sessionId` to match the in-flight recording, or clear the debug candidate and wait for a new value.

AGENTS.md reference: [AGENTS.md:L216-L219](https://github.com/relativityE/speaksharp/blob/e68515ec44808c33219d05021c97bfa28d6c5c35/AGENTS.md#L216-L219)

Useful? React with 👍 / 👎.


### PR #1306 — data(privacy): adopt atomic completion and newest-two transcript retention before MVP

- PR: https://github.com/relativityE/speaksharp/pull/1306

#### CR-090: Load the detail row before resolving its transcript

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bqtb5`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/AnalyticsDashboard.tsx:864`
- **Created:** 2026-08-24T11:05:45Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Load the detail row before resolving its transcript**

When any `/analytics/:sessionId` route opens, `targetSession` still comes from `sessionHistory`, whose query deliberately excludes `transcript`; `AnalyticsPage` never calls the newly broadened `getSessionById` path. Consequently `resolveTranscriptView(targetSession)` always receives no transcript and renders “could not be loaded,” and PDF export receives the same list row, so even the two retained transcripts can never be viewed or exported in the real route.

Useful? React with 👍 / 👎.

#### CR-091: Preserve the transcript when retention reports failure

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bqtcC`
- **Thread state:** unresolved
- **Location:** `frontend/src/lib/storage.ts:409`
- **Created:** 2026-08-24T11:05:45Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve the transcript when retention reports failure**

When `complete_session_v2` returns `transcript_outcome: 'retention_failed'`, the RPC has saved the metrics but explicitly forfeited the new transcript; this parser nevertheless returns `success: true`. The controller therefore skips its failure/retry path, clears the recovery draft, purges working transcript memory, and reports the session saved, silently destroying the only remaining copy without an actionable retry. Treat this outcome as a partial save failure that preserves recovery state and surfaces recovery to the user.

AGENTS.md reference: [AGENTS.md:L462-L463](https://github.com/relativityE/speaksharp/blob/d89213f49e1af31c3c3f828a63316c03627109bf/AGENTS.md#L462-L463)

Useful? React with 👍 / 👎.


### PR #1348 — fix(#1306): correct the desktop production-proof control journey

- PR: https://github.com/relativityE/speaksharp/pull/1348

#### CR-092: Keep waiting for cached-model readiness

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6cEUhE`
- **Thread state:** unresolved
- **Location:** `tests/live/helpers/benchmark-utils.ts:543`
- **Created:** 2026-08-25T12:22:21Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Keep waiting for cached-model readiness**

When a cached model is still initializing, `data-model-status` is `loading` even though no setup CTA is required. This branch now returns instead of performing the previous `waitForPrivateEngineReady(page, timeout)`, after which the three-session proof allows only 8 seconds for the disabled `mic-start` to become enabled; a normal cached initialization taking longer therefore aborts the authorized production proof despite its 600-second model budget. Preserve the readiness wait on the no-CTA path, and add coverage for a warm cache transitioning from `loading` to `ready`.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/90eeaff38c37ad1e9b4b0d56e1965fac5982b760/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.


### PR #1345 — test(#1306): key the acquisition verdict on status, exercise the real CTA

- PR: https://github.com/relativityE/speaksharp/pull/1345

#### CR-093: Distinguish non-CTA terminal states in the verdict

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b8SP1`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:297`
- **Created:** 2026-08-25T05:05:14Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Distinguish non-CTA terminal states in the verdict**

This fallback labels every run that never reached `ready` or `loading` as having remained download-required after a CTA, even when the captured status is `init-failed`, `error`, `idle`, or `absent`, or when no CTA was required. In those failure scenarios the machine-readable verdict points to the wrong acquisition cause despite `statusTransitions` containing contradictory evidence; derive the fallback from the observed terminal status and whether the CTA was actually exercised.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/b3acf8ea89a8056eb0290d87c58e6dfe01f935cd/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.

#### CR-094: Capture the status immediately after the CTA

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b8SP6`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:331`
- **Created:** 2026-08-25T05:05:14Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Capture the status immediately after the CTA**

When the CTA does nothing or starts loading and then stalls—the two outcomes this change says the before/after pair distinguishes—`preparePrivateModelIfPrompted` waits up to 600 seconds for readiness and throws, so this read and its assertion are never reached. Conversely, on success the helper has already established readiness, making the new assertion effectively tautological; capture the post-click status before awaiting readiness so the closure criterion has a meaningful assertion.

AGENTS.md reference: [AGENTS.md:L216-L219](https://github.com/relativityE/speaksharp/blob/b3acf8ea89a8056eb0290d87c58e6dfe01f935cd/AGENTS.md#L216-L219)

Useful? React with 👍 / 👎.


### PR #1331 — fix(#1324): preserve interim filler episodes and align coachable totals

- PR: https://github.com/relativityE/speaksharp/pull/1331

#### CR-095: Preserve episodes through production transcript rewrites

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b7cbc`
- **Thread state:** unresolved
- **Location:** `frontend/src/hooks/useSpeechRecognition/useFillerWords.ts:153`
- **Created:** 2026-08-25T03:43:12Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve episodes through production transcript rewrites**

The shipping adapter in `useSpeechRecognition_prod.ts` passes the entire committed transcript as one synthetic `visible-transcript` chunk, so every committed update after the first keeps `finalChunks.length === 1` and enters this rewrite branch. Replacing `accumulatedCounts` with a final-text recount drops interim-only occurrences committed by earlier episodes, while returning without reconciling or clearing `openEpisodeRef` can double-count a current filler that also appears in the final and carry that episode into the next update. Consequently the new episode logic works for the tests' growing chunk arrays but not for the production input shape.

Useful? React with 👍 / 👎.

#### CR-096: Clear an interim-only session when it resets

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b7cbh`
- **Thread state:** unresolved
- **Location:** `frontend/src/hooks/useSpeechRecognition/useFillerWords.ts:118`
- **Created:** 2026-08-25T03:43:12Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Clear an interim-only session when it resets**

When a recording is reset or fails before producing any final chunk, `lastProcessedIndexRef.current` is still `-1`, so this condition cannot recognize the reset. On the transition from a nonempty interim to empty store state, execution instead reaches the no-final close path and commits the abandoned episode into `accumulatedCounts`; because the hook remains mounted across controller resets, that filler count then appears in the next recording. Reset isolation needs a signal that also distinguishes sessions which never produced a final chunk.

Useful? React with 👍 / 👎.


### PR #1344 — test(#1306): capture unhandled promise rejections — the likeliest acquisition failure

- PR: https://github.com/relativityE/speaksharp/pull/1344

#### CR-097: Sanitize rejection reasons before logging

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b6JOf`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:181`
- **Created:** 2026-08-25T01:35:20Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Sanitize rejection reasons before logging**

When any promise unrelated to model acquisition rejects after the `/session` navigation, this global handler records its arbitrary raw reason and `emitModelDiagnosis` serializes it into the public GitHub Actions log. This bypasses the allowlist applied immediately below to console and `pageerror` messages, so errors containing transcript, account, session, URL, or backend details can leak even though this production proof promises content-free evidence. Capture only model-acquisition signatures or redact/allowlist the reason before storing it.

AGENTS.md reference: [AGENTS.md:L357-L360](https://github.com/relativityE/speaksharp/blob/76a2711b51c25bcd38c6eb95a1bf57390ac91651/AGENTS.md#L357-L360)

Useful? React with 👍 / 👎.


### PR #1343 — test(#1306): instrument model acquisition so attempt 5 diagnoses instead of timing out

- PR: https://github.com/relativityE/speaksharp/pull/1343

#### CR-098: Sanitize matched console entries before publishing

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b6B7p`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:164`
- **Created:** 2026-08-25T01:23:29Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Sanitize matched console entries before publishing**

When the cold-cache or failure paths log an allowlisted message, this copies the entire Pino payload into the public Actions output rather than only the matched topic; for example, `PrivateWhisper.ts:963-968` emits `sId` and `rId`, and error payloads may contain additional arbitrary details. The regex is only a selection filter and does not satisfy the stated content-free guarantee, so retain fixed event names or explicitly sanitized fields instead of `msg.text()`.

AGENTS.md reference: [AGENTS.md:L357-L360](https://github.com/relativityE/speaksharp/blob/52313895632a81630eb873aee44528a7c3327d15/AGENTS.md#L357-L360)

Useful? React with 👍 / 👎.


### PR #1342 — test(#1306): wait for Private runtime mode in production proof

- PR: https://github.com/relativityE/speaksharp/pull/1342

#### CR-099: Reject a resolved non-Private mode instead of retrying it

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b44j6`
- **Thread state:** unresolved
- **Location:** `tests/live/helpers/benchmark-utils.ts:358`
- **Created:** 2026-08-24T23:43:31Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject a resolved non-Private mode instead of retrying it**

When the runtime reports `cloud` or `native` on any poll and later changes to `private` within 30 seconds, `toPass` retries the failed equality assertion and ultimately passes. This violates the stated fail-closed contract and lets the production proof conceal a forbidden mode transition; retry only while the value is unresolved (`null`), and fail immediately once any non-Private mode is observed.

AGENTS.md reference: [AGENTS.md:L453-L458](https://github.com/relativityE/speaksharp/blob/0d3a8c9ae25fa69359883856e4bdafcf73b72342/AGENTS.md#L453-L458)

Useful? React with 👍 / 👎.


### PR #1341 — test(#1306): align production proof with the Private-only flow

- PR: https://github.com/relativityE/speaksharp/pull/1341

#### CR-100: Remove the still-blocking selector from quarantine

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b4fqA`
- **Thread state:** unresolved
- **Location:** `tests/unit/liveSpecSelectorContract.test.js:36`
- **Created:** 2026-08-24T23:10:22Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Remove the still-blocking selector from quarantine**

Do not exempt `stt-mode-select` while `waitForBenchmarkSession` still requires it to become visible. That helper is called before `selectBenchmarkMode` by the CPU and WebGPU benchmark specs included in `pnpm benchmark:browser`, so those runs still time out on the removed control; this quarantine makes the newly recursive contract report green despite that blocking dependency. Reconcile `waitForBenchmarkSession` with the Private-only readiness signal before treating this selector as harmless.

Useful? React with 👍 / 👎.

#### CR-101: Exclude test files from rendered-selector evidence

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b4fqE`
- **Thread state:** unresolved
- **Location:** `tests/unit/liveSpecSelectorContract.test.js:54`
- **Created:** 2026-08-24T23:10:22Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Exclude test files from rendered-selector evidence**

Limit `TSX_SOURCE` to production components rather than every `.tsx` under `frontend/src`, because test assertions can keep a deleted selector looking rendered. This already happens with `session-detail-transcript-expired`: its exact literal appears only in `AnalyticsDashboard.component.test.tsx`, while production constructs it through ``session-detail-transcript-${view.kind}``; if that production template is removed, `isRendered` will still return true and the live-proof guard will miss the stale selector.

Useful? React with 👍 / 👎.


### PR #1339 — ci: typecheck root live proof specs before production dispatch

- PR: https://github.com/relativityE/speaksharp/pull/1339

#### CR-102: Defer credential validation until after the live-mode skip

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b3-AJ`
- **Thread state:** unresolved
- **Location:** `tests/live/auth.live.spec.ts:31`
- **Created:** 2026-08-24T22:29:44Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Defer credential validation until after the live-mode skip**

When `VITE_USE_LIVE_DB` is not `true`, these initializers execute during module evaluation and throw before the `beforeAll` hook can call `test.skip()`. Consequently, collecting this spec in a non-live environment now fails for missing credentials instead of producing the explicitly intended skip. Move credential validation into the hook or test body after the live-mode check.

Useful? React with 👍 / 👎.


### PR #1338 — test(#1306): harden production proof preflight, cleanup, privacy, and per-session assertions

- PR: https://github.com/relativityE/speaksharp/pull/1338

#### CR-103: Include shared helper selectors in the rot check

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b2wbu`
- **Thread state:** unresolved
- **Location:** `tests/unit/liveSpecSelectorContract.test.js:52`
- **Created:** 2026-08-24T21:13:25Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Include shared helper selectors in the rot check**

Recurse into the shared live helpers rather than scanning only top-level `*.live.spec.ts` files. Both production proofs call `selectBenchmarkMode()` from `tests/live/helpers/benchmark-utils.ts`, which waits for `stt-mode-select`; the current frontend explicitly has no engine selector and a repo-wide search finds this value only in the unused `TEST_IDS` constant. Consequently, after signup these proofs will still fail before recording, while this new guard passes because it never inspects the helper.

Useful? React with 👍 / 👎.

#### CR-104: Scan Playwright-generated failures before claiming log privacy

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b2wbx`
- **Thread state:** unresolved
- **Location:** `tests/unit/liveProofPrivacyContract.test.js:38`
- **Created:** 2026-08-24T21:13:25Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Scan Playwright-generated failures before claiming log privacy**

Include Playwright assertion/action failures in this privacy contract, not just explicit `throw new Error` and console calls. For example, `exportPdfText()` catches the visibility assertion for `download-pdf-btn-${id}`, but the subsequent `control.click()` can still fail with a Playwright diagnostic containing that UUID-bearing locator; other dynamic locator assertions have the same problem. In those failure scenarios the public workflow log still exposes the identifier even though this newly added privacy test remains green.

Useful? React with 👍 / 👎.


### PR #1337 — test(#1306): prove the deployed three-session v2 retention journey

- PR: https://github.com/relativityE/speaksharp/pull/1337

#### CR-105: Verify persisted Private attribution for every session

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b0WtS`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:106`
- **Created:** 2026-08-24T19:03:10Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Verify persisted Private attribution for every session**

When a completion is misattributed or lacks server-recorded authority, this production proof still passes: `ROW_COLUMNS` fetches `engine` without asserting it, and none of the three IDs is checked against `session_attribution_authority`. Selecting Private in the UI and observing no provider request cannot substantiate the test's engine-specific conclusion; query each persisted session's verified authority and require the expected Private engine class/version before accepting the retention evidence.

AGENTS.md reference: [AGENTS.md:L460-L461](https://github.com/relativityE/speaksharp/blob/3b78797517d1b3875caa91a36e5d12ae27889c0b/AGENTS.md#L460-L461)

Useful? React with 👍 / 👎.

#### CR-106: Reject partial transcript leakage in history responses

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6b0WtW`
- **Thread state:** unresolved
- **Location:** `tests/live/three-session-retention-proof.live.spec.ts:354`
- **Created:** 2026-08-24T19:03:10Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject partial transcript leakage in history responses**

If the history endpoint leaks only a transcript prefix/preview, or JSON escaping changes the text's byte representation, this full-string containment check remains false and the production proof incorrectly reports that list traffic carries no transcript text. Parse each captured list response and assert that every returned row omits transcript-bearing fields rather than searching for the complete persisted transcript value.

Useful? React with 👍 / 👎.


### PR #1335 — fix(#1306): restore complete_session_v2 E2E coverage on the real client double

- PR: https://github.com/relativityE/speaksharp/pull/1335

#### CR-107: Reject Free v2 completions in the E2E double

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bwMbh`
- **Thread state:** unresolved
- **Location:** `tests/e2e/helpers/setupE2EManifest.ts:665`
- **Created:** 2026-08-24T15:30:57Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject Free v2 completions in the E2E double**

When `programmaticLoginWithRoutes(..., { userType: 'free' })` reaches this handler, as the changed Free post-save journey does, the double persists the completion and returns success for every tier. The real `complete_session_v2` RPC returns `{ success: false, error: 'trial_expired' }` whenever `effective_subscription_tier` is not `pro` (`backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql:132-134`), so this E2E path can report a successful Free save that cannot occur in production; gate the mock response on the profile tier or otherwise model the production rejection.

AGENTS.md reference: [AGENTS.md:L201-L207](https://github.com/relativityE/speaksharp/blob/3bf41d270ba33b95e338ef002782111abbf44a9e/AGENTS.md#L201-L207)

Useful? React with 👍 / 👎.


### PR #1334 — fix(#1306): e2e route stub must answer complete_session_v2 (main is red)

- PR: https://github.com/relativityE/speaksharp/pull/1334

#### CR-108: Skip retention for non-completed sessions

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6brHW4`
- **Thread state:** unresolved
- **Location:** `tests/e2e/mock-routes.ts:402`
- **Created:** 2026-08-24T11:28:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Skip retention for non-completed sessions**

When `p_status` is `failed`, cancelled, or otherwise non-completed, this unconditional sweep expires every transcript after the newest two. The production `complete_session_v2` explicitly limits retention to completed saves (`20260819120000_complete_session_v2_atomic_retention_1314.sql:207-212`), so any E2E failure journey can now destroy mock history that production preserves and conceal a client regression with the same behavior; guard this block on an eligible completed status and return the production skipped-retention envelope otherwise.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/7079ea96de5e4ec2d49e24a7d8dcbca4f9516fe9/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.

#### CR-109: Reject completion when the session ID is absent

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6brHXC`
- **Thread state:** unresolved
- **Location:** `tests/e2e/mock-routes.ts:420`
- **Created:** 2026-08-24T11:28:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject completion when the session ID is absent**

When `p_session_id` does not exist in `state.sessions`, the update is skipped but this response still unconditionally reports `success: true` and `session_saved: true`. Production returns `success: false, error: session_not_found`, so a stale or incorrect session ID can pass E2E while the application falsely believes a recording was persisted; return the matching failure envelope before fulfilling success when `idx === -1`.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/7079ea96de5e4ec2d49e24a7d8dcbca4f9516fe9/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.


### PR #1330 — fix(#1306): SEC-002 IPv4 session-pooler discovery + pre-apply connectivity/TLS proof

- PR: https://github.com/relativityE/speaksharp/pull/1330

#### CR-110: Move exact-head revalidation after pooler preflight

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bfTiK`
- **Thread state:** unresolved
- **Location:** `.github/workflows/postflight-only-1314.yml:127`
- **Created:** 2026-08-23T12:43:24Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Move exact-head revalidation after pooler preflight**

When `main` advances while the newly added Management API lookup or TLS probe is running, the check at the preceding `Revalidate main immediately before production postflight` step has already passed, so this workflow continues executing the gate and `NOTIFY` from a now-stale checkout and reports successful production verification. Move pooler discovery/connectivity before that revalidation, or recheck the branch again immediately before the gate/reload, so evidence cannot become historical during its own run.

AGENTS.md reference: [AGENTS.md:L276-L278](https://github.com/relativityE/speaksharp/blob/374b5780abb955451c314d9ee38e65395fa57bb5/AGENTS.md#L276-L278)

Useful? React with 👍 / 👎.


### PR #1329 — fix(#1306): recover exact #1314 production postflight safely

- PR: https://github.com/relativityE/speaksharp/pull/1329

#### CR-111: Include the API key header in the reload probe

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bXIaT`
- **Thread state:** unresolved
- **Location:** `.github/workflows/postflight-only-1314.yml:143`
- **Created:** 2026-08-22T06:45:18Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Include the API key header in the reload probe**

When this workflow calls the hosted Supabase REST endpoint, the gateway requires the project key in an `apikey` header; `Authorization: Bearer ...` alone is insufficient. Other direct REST calls in this repository, such as `.github/workflows/verify-entitlement-proof.yml`, send both headers. As written, every probe receives an authentication failure rather than the expected HTTP 200 response, so all 15 retries fail and the new postflight recovery workflow cannot complete.

Useful? React with 👍 / 👎.


### PR #1326 — fix(#1325): add privacy-safe filler count trace for Private STT qualification

- PR: https://github.com/relativityE/speaksharp/pull/1326

#### CR-112: Build evaluator rows from fixture expectations

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bN7xw`
- **Thread state:** unresolved
- **Location:** `scripts/manual-stt-corpus-proof.mjs:2519`
- **Created:** 2026-08-21T16:12:34Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Build evaluator rows from fixture expectations**

Every normal `runFixture` result sets `expectedFillers`, not `expectedByKey`, so this filter removes every real result. The empty-row fallback then marks the set accepted, while `gatePass` no longer checks `result.fillerPass`; consequently a deployed run can report `gatePass` and `deployedAcceptance` even when filler detection or its downstream chain failed. Derive `expectedByKey` from each fixture or populate it on the result before filtering.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/51a2866e71c615ac02aea847c7f265cda09af7b3/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.

#### CR-113: Preserve the version in captured trace events

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bN7x5`
- **Thread state:** unresolved
- **Location:** `scripts/manual-stt-corpus-proof.mjs:372`
- **Created:** 2026-08-21T16:12:34Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve the version in captured trace events**

When the browser trace is captured, this mapper strips `event.version`, although `isValidTraceEvent` later requires it to equal `filler_count_trace_v1`. Once real rows reach the evaluator, every genuine event is therefore reported as invalid and the required phases appear missing, preventing a controlled replay from qualifying.

Useful? React with 👍 / 👎.

#### CR-114: Fail the per-result chain when members are absent

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6bN7x9`
- **Thread state:** unresolved
- **Location:** `scripts/manual-stt-corpus-proof.mjs:1923`
- **Created:** 2026-08-21T16:12:34Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail the per-result chain when members are absent**

For production runs where the finalized surface is unavailable, this filter discards that missing member; it also discards `persistedFillerTotal`, which is not assigned until line 1945. `every` then succeeds on the remaining singleton or empty array, allowing `fillerPass` and the displayed result verdict to claim success without the finalized/persisted chain that this change says must fail closed.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/51a2866e71c615ac02aea847c7f265cda09af7b3/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.


### PR #1272 — docs(#1257): reset the release ledger and roadmap to the current Private Practice Loop

- PR: https://github.com/relativityE/speaksharp/pull/1272

#### CR-115: Preserve the deferred Vitest remediation

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOewo`
- **Thread state:** resolved, outdated
- **Location:** `ROADMAP.md`
- **Created:** 2026-08-11T12:40:24Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve the deferred Vitest remediation**

Once this file becomes the canonical roadmap, the deferred Vitest 4 upgrade loses its owner: `product_release/OPERATIONS_AND_SECURITY.md` still identifies retiring the GHSA-5xrq suppression as a remaining durable item routed to `ROADMAP.md`, while this only lists #1262 for coverage reliability and latency (matching the narrower descriptions in `PRODUCT_REQUIREMENTS.md` and `BACKLOG.md`). Add the dependency remediation to a current issue or record its explicit rejection/archive before replacing the old backlog; otherwise an acknowledged critical-advisory suppression silently disappears from unfinished-work tracking.

AGENTS.md reference: [AGENTS.md:L108-L111](https://github.com/relativityE/speaksharp/blob/013126bfd79a35a3b1664c29da412532ef7be167/AGENTS.md#L108-L111)

Useful? React with 👍 / 👎.

#### CR-116: Align closeout accounting with the root roadmap

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOewx`
- **Thread state:** resolved, outdated
- **Location:** `product_release/README.md`
- **Created:** 2026-08-11T12:40:24Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Align closeout accounting with the root roadmap**

Because this row relocates canonical document #3 to the repository root, the portal's surrounding contract is now internally impossible: `README.md` lines 14, 18, and 62 and `DOC_MIGRATION_LEDGER.md` lines 84–93 still require exactly 14 canonical Markdown files at the root of `product_release/` and count `ROADMAP.md` among the 12 files created there. At closeout, following the new location leaves only 13 files in that directory, while the updated test merely checks that the link exists and continues accepting the stale 14-file arithmetic. Update the portal, ledger, and closeout assertion to define whether the count is repository-wide or directory-local.

AGENTS.md reference: [AGENTS.md:L44-L48](https://github.com/relativityE/speaksharp/blob/013126bfd79a35a3b1664c29da412532ef7be167/AGENTS.md#L44-L48)

Useful? React with 👍 / 👎.

#### CR-117: Permit the required negative Cloud contract

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOew6`
- **Thread state:** resolved, outdated
- **Location:** `tests/config/documentationContract.test.ts`
- **Created:** 2026-08-11T12:40:24Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Permit the required negative Cloud contract**

This blanket `\bCloud\b` prohibition rejects correct privacy language as well as retired positive product claims. For example, adding the repository-mandated guarantee that Private must never silently fall back to Cloud to `PRODUCT_REQUIREMENTS.md` would fail this documentation contract and block CI, even though that is exactly where stable product promises belong. Restrict the check to affirmative Cloud availability/selection claims rather than banning the token in all governed documents.

AGENTS.md reference: [AGENTS.md:L439-L442](https://github.com/relativityE/speaksharp/blob/013126bfd79a35a3b1664c29da412532ef7be167/AGENTS.md#L439-L442)

Useful? React with 👍 / 👎.


### PR #1309 — #1306 (2/3): cutover — metrics-only application

- PR: https://github.com/relativityE/speaksharp/pull/1309

#### CR-118: Preserve the ready Private engine when the store mode is null

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0pGJ`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/services/SpeechRuntimeController.ts`
- **Created:** 2026-08-17T15:15:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve the ready Private engine when the store mode is null**

When the running service is ready in Private mode but `sttMode` is null—the production condition documented by `SpeechRuntimeController.idleReclamation.test.ts`—this guard becomes false and resets the engine after five minutes. The same change removes the reclamation token and foreground reload handler, so the mic can remain unusable rather than recovering; base preservation on the actual ready service mode, as the preceding #1258 fix did.

Useful? React with 👍 / 👎.

#### CR-119: Treat pre-cutover sessions as legacy instead of corrupted

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0pGL`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/AnalyticsDashboard.tsx:851`
- **Created:** 2026-08-17T15:15:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Treat pre-cutover sessions as legacy instead of corrupted**

When this cutover is deployed on Stage A, every existing completed session has `next_action_signal = NULL`: `20260816223606_metrics_only_additive_1306.sql` only adds the nullable column and performs no backfill. Consequently, opening any pre-cutover saved review shows a red data-integrity error, and the PDF emits the same false corruption claim; distinguish legacy sessions or backfill them before enforcing this invariant in the reader.

AGENTS.md reference: [AGENTS.md:L16-L22](https://github.com/relativityE/speaksharp/blob/42ac57f56d297535ad11782d3c6d8ab8549c2e57/AGENTS.md#L16-L22)

Useful? React with 👍 / 👎.

#### CR-120: Avoid emitting an unmeasurable ON_TRACK action

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0pGN`
- **Thread state:** unresolved
- **Location:** `frontend/src/utils/nextAction.ts:90`
- **Created:** 2026-08-17T15:15:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Avoid emitting an unmeasurable ON_TRACK action**

For every reliable session below the filler threshold with WPM between 130 and 150, this unconditional fallback persists `ON_TRACK`/`MAINTAIN` with `metric: 'none'` and `value: 0`, even if the supplied clarity score is very poor. That fabricates a positive and ignores `clarityScore`; it also conflicts with `product_release/PROGRESS_AND_NEXT_ACTION.md:151-155`, which requires the action to name a metric, direction, and target, so derive an evidence-backed measurable action instead.

AGENTS.md reference: [AGENTS.md:L479-L481](https://github.com/relativityE/speaksharp/blob/42ac57f56d297535ad11782d3c6d8ab8549c2e57/AGENTS.md#L479-L481)

Useful? React with 👍 / 👎.

#### CR-121: Stop requiring a second metrics write after atomic completion

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0pGP`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/SpeechRuntimeController.ts:3631`
- **Created:** 2026-08-17T15:15:32Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Stop requiring a second metrics write after atomic completion**

These metrics are now written atomically by `completeSession`, but the normal path subsequently writes the identical `richMetricsPayload` through `updateSession` and treats failure of that redundant request as lost analysis: it suppresses the success cue, warns the user, and skips Progress. If the RPC succeeds and the later UPDATE has a transient failure, the database already contains every metric, so the flow should regard the atomic RPC result as the persistence result rather than requiring a second write.

Useful? React with 👍 / 👎.

#### CR-122: Rehydrate the recovery draft before deleting it

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6aVslX`
- **Thread state:** unresolved
- **Location:** `frontend/src/hooks/useUnresolvedRecovery.ts:46`
- **Created:** 2026-08-19T03:44:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Rehydrate the recovery draft before deleting it**

On a same-user reload with an empty transcript, the first effect invokes this callback and synchronously deletes the finalized draft; the later rehydration effect only then imports the controller, whose `rehydrateUnresolvedRecording()` rereads localStorage and finds nothing. The UI claims the session was recovered, but no retry is armed and all saved recovery metrics are lost, so preserve the draft until controller rehydration succeeds.

AGENTS.md reference: [AGENTS.md:L450-L451](https://github.com/relativityE/speaksharp/blob/dbb8abdd34899295f402666eaa928495f101dc3b/AGENTS.md#L450-L451)

Useful? React with 👍 / 👎.

#### CR-123: Preserve measured-zero filler maps in recovery drafts

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6aVsle`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/sessionRecoveryDraft.ts:101`
- **Created:** 2026-08-19T03:44:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve measured-zero filler maps in recovery drafts**

When a zero-filler session's completion fails, `fillerCounts` is `{}`, but this condition drops that valid measured-zero map from the finalized recovery draft. After reload, the retry sends `p_filler_counts = NULL`; the Stage A `complete_session` RPC rejects completed sessions without a measured filler map, so Retry Save can never recover this otherwise valid session. Store `{}` distinctly from an absent or invalid map.

AGENTS.md reference: [AGENTS.md:L450-L451](https://github.com/relativityE/speaksharp/blob/dbb8abdd34899295f402666eaa928495f101dc3b/AGENTS.md#L450-L451)

Useful? React with 👍 / 👎.

#### CR-124: Retain finalized Focus Points coverage before purging text

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6aVslk`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/SpeechRuntimeController.ts:3898`
- **Created:** 2026-08-19T03:44:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Retain finalized Focus Points coverage before purging text**

For every completed Focus Points take, this purge empties the transcript that `SessionOverhaulView` still passes to `deriveFocusCoverage()`; that component ignores the supplied `objectiveCoverage` snapshot, so its terminal rail and coverage card recompute from an empty string and mark previously covered points as missed. The finalized coverage snapshot must drive the after-state before the transcript is discarded.

Useful? React with 👍 / 👎.

#### CR-125: Show the structured next action in the terminal review

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6aVslp`
- **Thread state:** unresolved
- **Location:** `frontend/src/pages/SessionPage.tsx:367`
- **Created:** 2026-08-19T03:44:32Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Show the structured next action in the terminal review**

For every completed Open Mic session, passing `undefined` forces `verdictFromSuggestions()` to render its legacy fallback (`Session saved — nice work.` plus a filler/baseline heuristic), rather than the structured action derived and persisted by this cutover. Poor sessions therefore receive fabricated praise, and the immediate review disagrees with the saved detail and PDF; wire the finalized next-action signal into this surface or use a neutral handoff. This conflicts with `product_release/PROGRESS_AND_NEXT_ACTION.md:141-155`, which requires one evidence-backed measurable action and forbids invented positives.

AGENTS.md reference: [AGENTS.md:L479-L481](https://github.com/relativityE/speaksharp/blob/dbb8abdd34899295f402666eaa928495f101dc3b/AGENTS.md#L479-L481)

Useful? React with 👍 / 👎.


### PR #1311 — ci: harden Setup Environment against un-timed network hangs (#1306)

- PR: https://github.com/relativityE/speaksharp/pull/1311

#### CR-126: Keep the setup action runnable on supported macOS agents

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z-OCv`
- **Thread state:** unresolved, outdated
- **Location:** `.github/actions/setup-environment/action.yml`
- **Created:** 2026-08-18T03:19:00Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Keep the setup action runnable on supported macOS agents**

When `v4-benchmark-gpu.yml` selects the explicitly supported Mac self-hosted GPU runner (see its lines 8–16 and `runs-on` at line 34), this step fails because macOS does not provide a `timeout` executable by default; Homebrew coreutils normally exposes it as `gtimeout`. Since the shared action now invokes `timeout` for every dependency-install attempt, the benchmark never reaches its tests. Use a platform-neutral timeout mechanism or select `timeout`/`gtimeout` based on `runner.os`.

Useful? React with 👍 / 👎.


### PR #1308 — #1306 (1/3): Stage A — additive metrics-only DB contract

- PR: https://github.com/relativityE/speaksharp/pull/1308

#### CR-127: Give the new overload a required distinguishing argument

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0owe`
- **Thread state:** unresolved
- **Location:** `backend/supabase/migrations/20260816223606_metrics_only_additive_1306.sql:131`
- **Created:** 2026-08-17T15:14:15Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Give the new overload a required distinguishing argument**

Legacy failure paths such as `discardUnresolvedRecording` call `completeSession` with only `p_session_id`, `p_status`, and `p_reason` after undefined values are omitted during JSON serialization. Because both the legacy function and this new function accept those same named arguments while defaulting every other parameter, PostgreSQL/PostgREST cannot select a unique overload, so these existing calls fail instead of marking the session failed. Use a distinct RPC name or require a parameter unique to this overload so Stage A remains compatible with the deployed frontend.

AGENTS.md reference: [AGENTS.md:L16-L22](https://github.com/relativityE/speaksharp/blob/5840bd55cafe64ba83d58732d4c4ce35de6c469a/AGENTS.md#L16-L22)

Useful? React with 👍 / 👎.

#### CR-128: Reject JSON nulls in next-action enum fields

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0owg`
- **Thread state:** unresolved
- **Location:** `backend/supabase/migrations/20260816223606_metrics_only_additive_1306.sql:74`
- **Created:** 2026-08-17T15:14:15Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject JSON nulls in next-action enum fields**

When a required enum field such as `reasonCode` is present but contains JSON `null`, `next_action_signal->>'reasonCode' = ANY (...)` evaluates to SQL `NULL`; if the other fields are valid, the overall CHECK expression is also `NULL`, which PostgreSQL accepts. A malformed action can therefore be persisted on a completed session despite the strict-shape contract. Explicitly require text values or make each comparison/the complete predicate evaluate `IS TRUE`.

Useful? React with 👍 / 👎.

#### CR-129: Correct the paired rollback to remove the actual additions

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Z0owk`
- **Thread state:** unresolved, outdated
- **Location:** `backend/supabase/migrations/20260816223606_metrics_only_additive_1306.sql`
- **Created:** 2026-08-17T15:14:15Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Correct the paired rollback to remove the actual additions**

If operators follow this rollback, the five-argument `DROP FUNCTION` matches neither the new ten-argument overload nor the legacy overload, so `IF EXISTS` silently leaves the new RPC installed; the rollback also never removes `filler_counts`. It can consequently leave an exposed function referencing a removed `next_action_signal` field and a partially reverted schema. Drop the exact ten-argument identity, remove both added columns, and dry-run the rollback before this migration is applied.

AGENTS.md reference: [AGENTS.md:L209-L214](https://github.com/relativityE/speaksharp/blob/5840bd55cafe64ba83d58732d4c4ce35de6c469a/AGENTS.md#L209-L214)

Useful? React with 👍 / 👎.


### PR #1301 — fix(#1294): correct the weekly Stripe test-mode/test-clock billing qualification (5 RETURN defects)

- PR: https://github.com/relativityE/speaksharp/pull/1301

#### CR-130: Inject Supabase credentials into the billing step

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Zh6gX`
- **Thread state:** resolved, outdated
- **Location:** `scripts/paid-billing-qualification.mjs`
- **Created:** 2026-08-15T18:04:35Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Inject Supabase credentials into the billing step**

When the weekly billing lane runs, `main()` now requires both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, but the billing step in `.github/workflows/canary.yml` injects only the three Stripe values; the Supabase credentials on the later ceiling step are step-scoped and unavailable here. Consequently every scheduled billing qualification exits at this guard before even reaching the Stripe preflight.

AGENTS.md reference: [AGENTS.md:L284-L294](https://github.com/relativityE/speaksharp/blob/15240b9019da79cb0232d5fee74d144c4b3af449/AGENTS.md#L284-L294)

Useful? React with 👍 / 👎.

#### CR-131: Bind the fresh profile before posting subscription updates

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Zh6gZ`
- **Thread state:** resolved, outdated
- **Location:** `scripts/lib/billingQualification.mjs`
- **Created:** 2026-08-15T18:04:35Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Bind the fresh profile before posting subscription updates**

After the missing credentials are supplied, this first synthetic webhook still cannot grant the newly created user Pro access. The deployed handler handles `customer.subscription.updated` with `bindUserId = null` and can therefore reconcile only a profile already bound to the subscription; first binding is supported only through `checkout.session.completed` with matching `metadata.userId` and `client_reference_id`. Since this runner creates an unbound profile and its `metadata.user_id` is ignored for subscription events, the webhook RPC fails and the following profile poll always times out.

Useful? React with 👍 / 👎.


### PR #1300 — fix(canary): schedule active-trial and no-charge paid qualification

- PR: https://github.com/relativityE/speaksharp/pull/1300

#### CR-132: Preserve paid evidence in the automatic canary gate

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Zgb6L`
- **Thread state:** unresolved, outdated
- **Location:** `.github/workflows/canary.yml`
- **Created:** 2026-08-15T12:47:28Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve paid evidence in the automatic canary gate**

On every push or scheduled run, this expression reduces the matrix to `active-trial`, while `canary-result` can still report success. That conflicts with the canonical gate contract in `product_release/QUALITY.md:234` and `product_release/RELEASE_PROCESS.md:38,84`, which requires the deployed canary to prove both active-trial and paid-continuation before GO. Consequently, the standard same-SHA canary can be consumed as green release evidence without the required paid journey; either retain both lanes in the counted canary or make the routine workflow non-gating and introduce a separately required qualification context.

AGENTS.md reference: [AGENTS.md:L44-L56](https://github.com/relativityE/speaksharp/blob/3c0a4f6b929008fc2ece375cbdf32624b4ffbb03/AGENTS.md#L44-L56)

Useful? React with 👍 / 👎.

#### CR-133: Prevent routine runs from canceling paid qualification

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Zgb6N`
- **Thread state:** unresolved, outdated
- **Location:** `.github/workflows/canary.yml`
- **Created:** 2026-08-15T12:47:28Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Prevent routine runs from canceling paid qualification**

Once this expression makes paid dispatches differ from routine runs, the workflow's unchanged `concurrency.group: canary-${{ github.ref }}` with `cancel-in-progress: true` allows a push or scheduled `main` run to cancel an in-progress `include_paid_billing=true` dispatch. The replacement then runs only active-trial, so the explicitly requested paid qualification produces no terminal result or artifacts; include the qualification mode in the concurrency key or otherwise prevent routine runs from canceling paid runs.

AGENTS.md reference: [AGENTS.md:L268-L278](https://github.com/relativityE/speaksharp/blob/3c0a4f6b929008fc2ece375cbdf32624b4ffbb03/AGENTS.md#L268-L278)

Useful? React with 👍 / 👎.

#### CR-134: Use a mode-bearing Stripe response for preflight

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZhU7U`
- **Thread state:** unresolved
- **Location:** `scripts/paid-billing-qualification.mjs:53`
- **Created:** 2026-08-15T16:02:10Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Use a mode-bearing Stripe response for preflight**

On every weekly or opted-in billing run, Stripe's Retrieve Account response does not expose a `livemode` field because the Account is not a mode-specific resource. Consequently `account.livemode` is `undefined`, while `assertStripeTestMode` requires it to be exactly `false`, so the qualification always exits before creating the test clock. Use the test-key class together with a mode-bearing object such as the retrieved Price instead of requiring this nonexistent Account property.

Useful? React with 👍 / 👎.

#### CR-135: Verify SpeakSharp webhook state before proving the phase

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZhU7V`
- **Thread state:** unresolved
- **Location:** `scripts/paid-billing-qualification.mjs:72`
- **Created:** 2026-08-15T16:02:11Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Verify SpeakSharp webhook state before proving the phase**

When the weekly qualification reaches this phase, a paid Stripe invoice proves only that Stripe emitted an event; it does not prove that SpeakSharp's deployed webhook received it or granted entitlement. The workflow injects `STRIPE_WEBHOOK_SECRET`, but this runner never reads it, invokes the Edge function, or checks a profile, so a missing webhook registration, signature rejection, or database mutation failure can still produce `evidence.webhook = true`. Require an observed webhook response and the resulting server-side entitlement before counting this phase.

AGENTS.md reference: [AGENTS.md:L233-L234](https://github.com/relativityE/speaksharp/blob/c8f602cacee8b1ecc9d8f5d7e932883f0faf2916/AGENTS.md#L233-L234)

Useful? React with 👍 / 👎.

#### CR-136: Wait for each test clock advance to finish

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZhU7Y`
- **Thread state:** unresolved
- **Location:** `scripts/paid-billing-qualification.mjs:78`
- **Created:** 2026-08-15T16:02:11Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Wait for each test clock advance to finish**

Stripe test-clock advances are asynchronous, but the runner fetches the subscription immediately after requesting the advance. While the clock is still advancing, this GET can return the original already-active subscription, causing the renewal phase to pass without any renewal having occurred; the second advance can likewise make payment-failure behavior nondeterministic. Poll the test clock until it returns to `ready`, then verify the new invoice and billing-period state before recording evidence.

Useful? React with 👍 / 👎.

#### CR-137: Restore the counted paid-continuation canary journey

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZhU7a`
- **Thread state:** unresolved
- **Location:** `.github/workflows/canary.yml:90`
- **Created:** 2026-08-15T16:02:11Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Restore the counted paid-continuation canary journey**

For pushes and daily schedules this matrix still runs only `active-trial`, although canonical `product_release/QUALITY.md:234` requires `canary.yml` to prove both active-trial and paid-continuation before GO, and `product_release/RELEASE_PROCESS.md:38` requires the exact paid account/Stripe/database identity. Fresh evidence in this revision is that the weekly replacement deliberately uses no paid canary credentials and creates raw Stripe test objects, so it cannot satisfy that paid product journey; changing the explicitly historical `RC_GATES.md` does not supersede those canonical authorities. Retain the paid-continuation journey in counted canary evidence or update the canonical contract through the approved authority.

AGENTS.md reference: [AGENTS.md:L465-L466](https://github.com/relativityE/speaksharp/blob/c8f602cacee8b1ecc9d8f5d7e932883f0faf2916/AGENTS.md#L465-L466)

Useful? React with 👍 / 👎.


### PR #1294 — fix: close test-account contract and qualify trial/paid canary

- PR: https://github.com/relativityE/speaksharp/pull/1294

#### CR-138: Pass Free credentials to the custom-words job

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZQ8vG`
- **Thread state:** resolved
- **Location:** `.github/workflows/live-release-matrix.yml:47`
- **Created:** 2026-08-14T12:17:47Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Pass Free credentials to the custom-words job**

The `live-custom-words` job now passes no account credentials at all. `tests/live/user-filler-words-persistence.live.spec.ts` was changed to require `FREE_TEST_EMAIL` and `FREE_TEST_PASSWORD` and throws during `beforeAll` when they are absent, while GitHub repository secrets are not automatically exported to steps. Consequently, both the `custom-words` suite and every `all` run of this maintained live-release workflow fail before exercising the product; replace the removed Basic bindings with the corresponding Free secret bindings.

AGENTS.md reference: [AGENTS.md:L339-L344](https://github.com/relativityE/speaksharp/blob/029662fea72490eeb4788809ea121122cd510a2b/AGENTS.md#L339-L344)

Useful? React with 👍 / 👎.

#### CR-139: Hold readiness when commercial activation is applied

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZQ8vJ`
- **Thread state:** resolved, outdated
- **Location:** `scripts/lib/canaryMigrationReadiness.mjs`
- **Created:** 2026-08-14T12:17:47Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Hold readiness when commercial activation is applied**

When production already has `20260812042000` applied, `activationApplied` becomes true but the function still returns `ready: true`. The inspected `canary.yml` gates both product lanes solely on this `ready` output, so it executes them and can report green canary evidence even though the workflow and this module explicitly declare that commercial activation must remain unapplied for this qualification. Return a non-ready state or fail closed when `activationApplied` is true.

Useful? React with 👍 / 👎.


### PR #1297 — fix(#1282): stamp commercial_trial_granted_at on new-account trial (grant-on-conflict)

- PR: https://github.com/relativityE/speaksharp/pull/1297

#### CR-140: Add the migration to the workflow choices

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZZ4nq`
- **Thread state:** resolved
- **Location:** `scripts/lib/exactMigrationGate.mjs:56`
- **Created:** 2026-08-14T20:14:16Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Add the migration to the workflow choices**

When this target needs to be applied, `.github/workflows/apply-exact-allowlisted-migration.yml` still jumps from `20260812041500` to `20260812042000`, so an interactive dispatch cannot select the newly allowlisted `20260812041600` target. This also fails the exact-migration contract at `tests/unit/exactMigrationGate.test.js:267`, which requires every allowlisted version to appear in that workflow. `gh workflow run --help` confirms that interactive runs collect the workflow's declared inputs, while raw `-f` parameters are a separate path. Add this version to the workflow's `target_version.options` so the approved application workflow and its contract remain usable.

AGENTS.md reference: [AGENTS.md:L289-L294](https://github.com/relativityE/speaksharp/blob/71b64fb5a09a8deb5191054c11aeb8b6ac2e7b7a/AGENTS.md#L289-L294)

Useful? React with 👍 / 👎.


### PR #1296 — docs: refresh beta tester invitation and dogfood checklist

- PR: https://github.com/relativityE/speaksharp/pull/1296

#### CR-141: Include account creation in the first tester step

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZUu6-`
- **Thread state:** unresolved
- **Location:** `product_release/TESTER_GUIDE.md:63`
- **Created:** 2026-08-14T15:08:04Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Include account creation in the first tester step**

For first-time invitees without an account, this instruction cannot be completed: the linked public page distinguishes **Get Started** (`/auth/signup`) from **Sign In**, and sign-in requires an existing account. Since the guide explicitly covers first sessions, tell testers to create an account or sign in so new testers do not stall at the first step.

Useful? React with 👍 / 👎.

#### CR-142: Remove the waveform from the reopened-session check

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZUu7A`
- **Thread state:** unresolved
- **Location:** `product_release/TESTER_GUIDE.md:132`
- **Created:** 2026-08-14T15:08:04Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Remove the waveform from the reopened-session check**

After reopening through History or Progress, the tester is routed to `/analytics/:sessionId`; the exact-session view in `AnalyticsDashboard` renders Progress, metrics, transcript, PDF export, and suggestions, but no recording waveform. The waveform amplitudes exist only in `SessionOverhaulView`'s in-memory `/session` after-state, so this checklist item becomes impossible after the route transition and will produce false defect reports. Inspect the visualization before leaving `/session`, or persist and render it in the reopened detail view.

AGENTS.md reference: [AGENTS.md:L479-L481](https://github.com/relativityE/speaksharp/blob/9cacf5f733f7205990a9f2d1aa11b4703986a938/AGENTS.md#L479-L481)

Useful? React with 👍 / 👎.


### PR #1290 — fix: reconcile flawless-launch product contract across repository

- PR: https://github.com/relativityE/speaksharp/pull/1290

#### CR-143: Catch underscored 999-cent price settings

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZFHaK`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/lib/product-contract-guard.mjs`
- **Created:** 2026-08-13T20:50:12Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Catch underscored 999-cent price settings**

The new contract guard misses the repository's remaining `EXPECTED_STRIPE_PRO_AMOUNT: '999'` because `_` is a word character, so `\bamount` does not match the `..._AMOUNT` identifier. Consequently `node scripts/product-contract-guard.mjs` currently reports success while `.github/workflows/live-release-matrix.yml:249` and the fallback in `scripts/stripe-price-audit.mjs:16` still validate $9.99, allowing the live price-audit lane to reject the required $10 price or approve the retired price.

Useful? React with 👍 / 👎.

#### CR-144: Remove legacy engine names from Analytics

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZFHaO`
- **Thread state:** unresolved
- **Location:** `product_release/PRODUCT_REQUIREMENTS.md:72`
- **Created:** 2026-08-13T20:50:12Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Remove legacy engine names from Analytics**

For accounts retaining historical Native or Cloud sessions, the Analytics detail and `STT Engine Quality` slide still call `formatSessionRecordingMode`, which renders those records as visible `Browser` and `Cloud` labels (`AnalyticsDashboard.tsx:860`, `STTAccuracyVsBenchmark.tsx:87,244-256`). That contradicts the newly locked customer contract here and leaves exactly the retired engine terminology visible to existing users; historical rows need a neutral legacy label or the engine-specific surface must be removed.

AGENTS.md reference: [AGENTS.md:L443-L449](https://github.com/relativityE/speaksharp/blob/5f95a7472cce49f9b4b227a4ddce1039554418e0/AGENTS.md#L443-L449)

Useful? React with 👍 / 👎.

#### CR-145: Refresh Private telemetry after session creation

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6ZFHaU`
- **Thread state:** unresolved
- **Location:** `frontend/src/services/issueReportService.ts:157`
- **Created:** 2026-08-13T20:50:12Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refresh Private telemetry after session creation**

When a user submits a report from `/session`, `IssueReportDialog` supplies no route-derived session ID, so this fallback is the only analytics correlation. The commit removed the post-`startRecording` call that populated the telemetry context, while the remaining `applyPrivateTelemetryContext()` calls occur on model setup before the database session ID is assigned; therefore `arm.session_id` is null on the first recording and can be stale on later recordings, making recording-problem reports impossible to correlate reliably.

Useful? React with 👍 / 👎.


### PR #1282 — feat(#1282): 30-day full-product trial → $10/month, server-authoritative

- PR: https://github.com/relativityE/speaksharp/pull/1282

#### CR-146: Document the new source lock in the authoritative activation contract

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YWgQV`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/config/appRuntimeConfig.ts`
- **Created:** 2026-08-11T19:31:19Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Document the new source lock in the authoritative activation contract**

When paid enrollment is later authorized, operators following `product_release/RELEASE_STATUS.md:32` and `product_release/ENV_INVENTORY.md:71-72,106` will enable both documented switches and the live Stripe configuration, but this new constant will still hide every checkout surface while the Edge function returns `403`. The only description of the additional activation step is in a non-authoritative evidence file, so update the canonical billing/environment procedures in this increment or retain the documented two-switch behavior.

AGENTS.md reference: [AGENTS.md:L46-L53](https://github.com/relativityE/speaksharp/blob/6f89c3ed837a9e6731a531dcc829ebe8cd0e7e34/AGENTS.md#L46-L53)

Useful? React with 👍 / 👎.

#### CR-147: Move future offer gates into a canonical product document

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YWgQX`
- **Thread state:** resolved, outdated
- **Location:** `tests/release/free-beta-offer-contract.test.ts`
- **Created:** 2026-08-11T19:31:19Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Move future offer gates into a canonical product document**

These assertions turn `product_release/evidence/ISSUE_1266_FREE_BETA_ENTITLEMENT_COPY_MATRIX.md` into the binding source for future packaging and experiment thresholds. Files under `evidence/` are historical artifacts rather than current policy, so later reconciliation or archiving can leave this release test enforcing stale thresholds; put the hypothesis and gates in the canonical roadmap/product authority and test that source instead.

AGENTS.md reference: [AGENTS.md:L470-L473](https://github.com/relativityE/speaksharp/blob/6f89c3ed837a9e6731a531dcc829ebe8cd0e7e34/AGENTS.md#L470-L473)

Useful? React with 👍 / 👎.

#### CR-148: Preserve paid-account guidance when enrollment is closed

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YWgQa`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/PricingPage.tsx`
- **Created:** 2026-08-11T19:31:19Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve paid-account guidance when enrollment is closed**

When `paymentsEnabled` is false and the loaded profile still has a paid-Pro entitlement, this unconditional return ignores `isPaidPro`, labels the account as a “Free controlled beta,” and removes the existing cancellation/refund guidance even though existing paid-Pro accounts retain their entitlement and the billing-portal endpoint remains available. Branch this free-only panel on the entitlement as well, keeping paid-subscriber management separate from whether new checkout enrollment is open.

AGENTS.md reference: [AGENTS.md:L49-L51](https://github.com/relativityE/speaksharp/blob/6f89c3ed837a9e6731a531dcc829ebe8cd0e7e34/AGENTS.md#L49-L51)

Useful? React with 👍 / 👎.


### PR #1286 — feat(#1265): server-side Focus Points/Open Mic Progress separation

- PR: https://github.com/relativityE/speaksharp/pull/1286

#### CR-149: Preserve registration state when later stages throw

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YsgIJ`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/services/SpeechRuntimeController.ts`
- **Created:** 2026-08-12T19:13:21Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve registration state when later stages throw**

If `startObjectiveSession`, point loading, coverage computation, or evidence finalization throws after `registerObjectiveSource` has succeeded, the orchestrator's catch returns `{ ok: false }` without a stage, so this condition suppresses Progress even though the source is already registered as objective. No durable reconcile entry is queued because `runProgressEval` is never called; when this is the user's first or earliest evaluation, the bounded sweep also skips it because there is no earlier active-era row. Preserve the last completed stage or otherwise confirm registration before deciding not to evaluate.

Useful? React with 👍 / 👎.

#### CR-150: Repoint historical comparisons to same-mode sessions

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YsgIR`
- **Thread state:** unresolved, outdated
- **Location:** `backend/supabase/migrations/20260812030000_progress_cohort_mode_separation_1265.sql`
- **Created:** 2026-08-12T19:13:21Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Repoint historical comparisons to same-mode sessions**

For an interleaved history such as objective A, freeform B, objective C, C's legacy baseline is A while its previous pointer is B; this update nulls B but never replaces it with A. The read model then reports a restarted comparison despite an eligible same-mode predecessor, and `ON CONFLICT DO NOTHING` means future evaluation calls cannot repair the existing row. Recompute each affected pointer from the earliest/latest eligible evaluation in the newly moded cohort rather than only clearing cross-mode references.

Useful? React with 👍 / 👎.


### PR #1279 — fix(#1260): purge the unaffiliated domain and enforce zero-reference CI

- PR: https://github.com/relativityE/speaksharp/pull/1279

#### CR-151: Keep management credentials out of PR-controlled code

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YVYzL`
- **Thread state:** resolved, outdated
- **Location:** `.github/workflows/no-unaffiliated-domain.yml`
- **Created:** 2026-08-11T18:28:22Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Keep management credentials out of PR-controlled code**

When a same-repository contributor opens a PR that modifies `scripts/check-hosted-allowed-origin.mjs` or its imported scanner, this job checks out and executes that PR-controlled code while exposing `SUPABASE_ACCESS_TOKEN`, allowing the code to transmit the management credential off-runner. Restrict the credentialed check to a trusted `workflow_dispatch`/default-branch context, or execute only code sourced from the trusted base revision.

AGENTS.md reference: [AGENTS.md:L293-L296](https://github.com/relativityE/speaksharp/blob/a335276406220bfaf79a622f47a8713152c6698d/AGENTS.md#L293-L296)

Useful? React with 👍 / 👎.


### PR #1284 — docs(#1267): add Private-only launch playbook

- PR: https://github.com/relativityE/speaksharp/pull/1284

#### CR-152: Reconcile the Private-only gate with the product contract

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YWXFB`
- **Thread state:** resolved, outdated
- **Location:** `product_release/RELEASE_PROCESS.md`
- **Created:** 2026-08-11T19:23:14Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reconcile the Private-only gate with the product contract**

Applying this authoritative procedure to the current controlled beta forces an unconditional HOLD: `PRODUCT_REQUIREMENTS.md` lines 62 and 72–76 require user-facing Browser and Cloud methods and line 82 requires Guided to remain visibly unavailable, while `STT.md` lines 22–24 says Browser is the default and Private is entitlement-gated. The newly added condition therefore rejects the product's required and currently deployed state rather than detecting a regression. Update the product authorities and implementation as one approved change, or scope this checklist explicitly to a future Private-only release instead of making it the current release gate.

AGENTS.md reference: [AGENTS.md:L479-L481](https://github.com/relativityE/speaksharp/blob/0a4b73fb8b9c1412b60af9f9f7822322f78c6129/AGENTS.md#L479-L481)

Useful? React with 👍 / 👎.

#### CR-153: Preserve the pending human-review status

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YWXFD`
- **Thread state:** resolved, outdated
- **Location:** `product_release/RELEASE_PROCESS.md`
- **Created:** 2026-08-11T19:23:14Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve the pending human-review status**

Do not advance `Last Reviewed` to 2026-08-11 yet: the portal defines this field as the date the prose was read by a human, but the added rehearsal record identifies the author as a Codex agent and says the independent reviewer is still unassigned and required before acceptance. On this commit, the authoritative release procedure consequently claims human review that its own evidence says is pending; retain the prior date or record the real human review once it occurs.

AGENTS.md reference: [AGENTS.md:L465-L466](https://github.com/relativityE/speaksharp/blob/0a4b73fb8b9c1412b60af9f9f7822322f78c6129/AGENTS.md#L465-L466)

Useful? React with 👍 / 👎.


### PR #1287 — feat(#1266): webhook lifecycle DB prerequisite (apply before #1282 Edge)

- PR: https://github.com/relativityE/speaksharp/pull/1287

#### CR-154: Handle distinct events with equal Stripe timestamps

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Ys1VJ`
- **Thread state:** unresolved, outdated
- **Location:** `backend/supabase/migrations/20260812002000_webhook_lifecycle_completeness_1282.sql`
- **Created:** 2026-08-12T19:30:00Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Handle distinct events with equal Stripe timestamps**

When two distinct state-changing events have the same `p_event_created` value, this `>=` comparison classifies the second as out of order even though only older events should be ignored; for example, a lapse followed by a successful renewal in the same timestamp second leaves the customer incorrectly on Free, while the reverse order can leave Pro active after a lapse. The same comparison is repeated in the renewal, lapse, and downgrade branches, so the ordering scheme needs a deterministic tie-breaker or explicit equal-time handling, plus an equal-timestamp lifecycle test.

AGENTS.md reference: [AGENTS.md:L206-L211](https://github.com/relativityE/speaksharp/blob/3e9b950b76081248aebc81882176d43755a719cd/AGENTS.md#L206-L211)

Useful? React with 👍 / 👎.


### PR #1269 — fix(#1254): make every public surface tell the Private-only product truth

- PR: https://github.com/relativityE/speaksharp/pull/1269

#### CR-155: Do not promise an undeployed retention policy

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YNci9`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/LegalPage.tsx`
- **Created:** 2026-08-11T11:42:25Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Do not promise an undeployed retention policy**

This publishes newest-two transcript expiry as current behavior, but `backend/supabase/migrations/20260803000000_transcript_retention_newest_two.sql` and `20260804000000_transcript_retention_converge_on_save.sql` explicitly mark the implementation source-only and not applied to production, while `product_release/ARCHITECTURE.md` §15 still classifies retention duration as unresolved. Until the migration is separately authorized and verified as applied, production users' older transcripts do not receive the promised expiry, so the public privacy policy is materially false. `RELEASE_STATUS.md` must be used to establish current deployment truth before making this claim.

AGENTS.md reference: [AGENTS.md:L44-L51](https://github.com/relativityE/speaksharp/blob/90da5387c60287e543c1c45411dee2fb1596357d/AGENTS.md#L44-L51)

Useful? React with 👍 / 👎.

#### CR-156: Match the copy to the enabled checkout path

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YNcjE`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/AnalyticsPage.tsx`
- **Created:** 2026-08-11T11:42:25Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Match the copy to the enabled checkout path**

When `arePaymentsEnabled()` is true, this sentence renders specifically alongside an active “Upgrade to Pro” button whose handler invokes `stripe-checkout`, so customers are simultaneously told that paid plans are unavailable and offered a working checkout. `PricingPage` has the same enabled-state contradiction: it renders the Pro checkout action while stating that paid enrollment is not offered. Make the beta-only wording conditional on payments being disabled, or suppress the checkout path.

Useful? React with 👍 / 👎.

#### CR-157: Remove the unsupported account-deletion claim

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YNcjJ`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/LegalPage.tsx`
- **Created:** 2026-08-11T11:42:25Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Remove the unsupported account-deletion claim**

This newly tells every privacy-page visitor that they can delete their account, but a repo-wide search finds no customer-facing deletion route, handler, or backend function, and `product_release/ARCHITECTURE.md` §15 still records account-deletion requirements as unresolved policy. Until an actual deletion path and policy exist, direct users to the supported data-request mechanism rather than promising an unavailable control. Repository guidance requires conflicts with binding product promises to be classified rather than silently rewritten.

AGENTS.md reference: [AGENTS.md:L475-L477](https://github.com/relativityE/speaksharp/blob/90da5387c60287e543c1c45411dee2fb1596357d/AGENTS.md#L475-L477)

Useful? React with 👍 / 👎.


### PR #1280 — feat(#1265): Progress metric definition matrix + single-source consistency

- PR: https://github.com/relativityE/speaksharp/pull/1280

#### CR-158: Enforce the mode gate instead of checking prose

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YjCvV`
- **Thread state:** unresolved
- **Location:** `tests/config/progress-metric-consistency.test.ts:50`
- **Created:** 2026-08-12T11:24:19Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Enforce the mode gate instead of checking prose**

When a user completes a Focus Points session and later returns to Open Mic, this assertion still passes even though the production adapter does not enforce the documented separation: `progressInputsFromSessions()` maps every session in history into the filler-rate trend without retaining or filtering its mode (`frontend/src/utils/progressInputsFromSessions.ts:22-32`). The Focus Points recording can therefore become the Open Mic baseline or previous session, producing a misleading movement figure. Add mode-aware filtering at the adapter/query boundary and make this test exercise that behavior rather than merely finding the sentence in Markdown.

Useful? React with 👍 / 👎.

#### CR-159: Share the pace band with the displayed metric consumers

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YjCva`
- **Thread state:** unresolved
- **Location:** `tests/config/progress-metric-consistency.test.ts:37`
- **Created:** 2026-08-12T11:24:19Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Share the pace band with the displayed metric consumers**

For a session at 125 WPM or 155 WPM, this guard passes and aggregate Progress assigns maximum pace quality using `[120,160]`, while the session-review/PDF analysis uses `ANALYTICS_THRESHOLDS.TARGET_WPM_MIN/MAX = 130/150` (`frontend/src/utils/sessionAnalysis.ts:32-35`) and labels the same pace outside its target range. Comparing the document only with the constant imported from `aggregateProgress` cannot enforce the new claim that the definition is shared across displayed surfaces; make those consumers use the same exported band or explicitly reconcile the contract and assert the actual consumer values.

Useful? React with 👍 / 👎.


### PR #1281 — feat(#1265): show comparable Progress and one next action

- PR: https://github.com/relativityE/speaksharp/pull/1281

#### CR-160: Expose the evidence behind displayed movements

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YVnB5`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/components/progress/ProgressPanel.tsx`
- **Created:** 2026-08-11T18:40:58Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Expose the evidence behind displayed movements**

For every eligible comparison, this renders the previous- and baseline-relative percentages as plain strings, but neither the panel nor the returned read model provides any way to inspect the referenced sessions, inputs, cohort, or units. This makes the new movement claims impossible to audit and violates `product_release/PROGRESS_AND_NEXT_ACTION.md:142-152`, which requires every displayed movement to expose that evidence on request; return the validated reference details and provide a disclosure from this surface.

AGENTS.md reference: [AGENTS.md:L46-L48](https://github.com/relativityE/speaksharp/blob/dbb5410e4970e3d891b263a0de0043cb969b3f78/AGENTS.md#L46-L48)

Useful? React with 👍 / 👎.

#### CR-161: Round displayed movement to one decimal

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YVnB8`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/services/progress/progressPresentation.ts`
- **Created:** 2026-08-11T18:40:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Round displayed movement to one decimal**

When the relative change has a fractional tenth, `Math.round` discards it entirely—for example, the test case based on 84.4 versus 80.1 is rendered as 5% rather than 5.4%. The authoritative measurement contract in `product_release/PROGRESS_AND_NEXT_ACTION.md:96-102` requires displayed percentages to be rounded to one decimal, so this produces a user-visible value at the wrong precision.

AGENTS.md reference: [AGENTS.md:L46-L48](https://github.com/relativityE/speaksharp/blob/dbb5410e4970e3d891b263a0de0043cb969b3f78/AGENTS.md#L46-L48)

Useful? React with 👍 / 👎.

#### CR-162: Honor the zero-reference no-change state

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YVnCC`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/services/progress/progressPresentation.ts`
- **Created:** 2026-08-11T18:40:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Honor the zero-reference no-change state**

When a valid eligible reference has `clarityRaw === 0` and the current value moves by at least three points, this branch classifies the result as improved or declined and tells the user that clear delivery changed. The zero-denominator rule in `product_release/PROGRESS_AND_NEXT_ACTION.md:100-102` instead requires this case to be presented as at baseline/no meaningful change because no defensible percentage exists; return that neutral state rather than a directional claim.

AGENTS.md reference: [AGENTS.md:L46-L48](https://github.com/relativityE/speaksharp/blob/dbb5410e4970e3d891b263a0de0043cb969b3f78/AGENTS.md#L46-L48)

Useful? React with 👍 / 👎.

#### CR-163: Do not label ineligible evidence as comparable

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YVnCE`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/lib/pdfGenerator.ts`
- **Created:** 2026-08-11T18:40:59Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Do not label ineligible evidence as comparable**

For any session with a numeric legacy `clarity_score`, this table says the evidence is “Available for comparable Progress” even when `loadSessionProgress` subsequently returns `insufficient` or `ineligible`, such as a short session, an unverified recording, or a pre-evaluation historical session. In those cases the export contains no Comparable Progress section, so the new table label contradicts the authoritative eligibility result; derive this wording from the loaded progress status or use a neutral evidence label.

AGENTS.md reference: [AGENTS.md:L46-L48](https://github.com/relativityE/speaksharp/blob/dbb5410e4970e3d891b263a0de0043cb969b3f78/AGENTS.md#L46-L48)

Useful? React with 👍 / 👎.


### PR #1278 — feat(#1264): optional Open Mic Practice Focus, preserved through repeat

- PR: https://github.com/relativityE/speaksharp/pull/1278

#### CR-164: Clear restored focus when resetting the session

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YXvwJ`
- **Thread state:** unresolved
- **Location:** `frontend/src/stores/useSessionStore.ts:228`
- **Created:** 2026-08-11T20:43:08Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Clear restored focus when resetting the session**

If a user reloads after choosing a focus and then signs out, this module-level `initialState` permanently captures that restored value. `AuthProvider.signOut` calls `resetSession()` before clearing `sessionStorage`, so the reset reapplies the cached focus to the live Zustand store; a different account signing in without another page reload will see the prior user's selection checked and carried into its recording. Clear this field during reset/sign-out, or compute reset state after storage has been cleared instead of reusing the module-level snapshot.

Useful? React with 👍 / 👎.


### PR #1271 — fix(#1256): keep Focus Points review state out of the next Open Mic take

- PR: https://github.com/relativityE/speaksharp/pull/1271

#### CR-165: Use the completed duration for snapshot reviews

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YNfWq`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/components/session/SessionOverhaulView.tsx`
- **Created:** 2026-08-11T11:44:53Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Use the completed duration for snapshot reviews**

After a normal stop reaches Ready, `useSessionStore.setSTTStatus` resets the live `elapsedTime` to zero while preserving `completedSessionDurationSeconds`; however, `SessionPage` still passes the live value into this view. Consequently, the restored snapshot-only Focus Points review recomputes coverage with a zero duration, causing the default pace card to report `0:00 actual` and `0:00 /point` and assigning covered-point timestamps of `0:00`. Pass the completed/scoring duration into the restored after-state instead.

Useful? React with 👍 / 👎.

#### CR-166: Rebind the saved brief before retrying Focus Points

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YNfWt`
- **Thread state:** unresolved
- **Location:** `frontend/src/components/session/SessionOverhaulView.tsx:307`
- **Created:** 2026-08-11T11:44:53Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Rebind the saved brief before retrying Focus Points**

When this after-state is rendered from the completed snapshot, the controller has already cleared `activeObjectiveBrief`, and `SessionPage` does not provide `onRetryPoints`, so the visible “Retry these points” button falls back to `onStartStop`. Clicking it clears the snapshot and starts a recording without restoring an active objective; the UI becomes Open Mic and the stop seam cannot finalize coverage for the retried points. Supply a retry handler that rebinds the saved brief before starting.

Useful? React with 👍 / 👎.


### PR #1270 — fix(#1255): stack the session shell on mobile

- PR: https://github.com/relativityE/speaksharp/pull/1270

#### CR-167: Preserve all waveform bars on narrow tracks

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOEbG`
- **Thread state:** unresolved, outdated
- **Location:** `frontend/src/components/session/Waveform.tsx`
- **Created:** 2026-08-11T12:18:34Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve all waveform bars on narrow tracks**

At a 320px viewport, the page and scrubber padding leave roughly 256px for this track, while the standard 72 bars require at least 286px (72 × 2px minimum widths plus 71 × 2px gaps). Adding `overflow: hidden` therefore removes the document overflow by clipping the rightmost bars rather than fitting the waveform; because `fillerBars` can map late transcript fillers through index 71, those markers disappear from the mobile after-state filler map. Use a responsive bar count/spacing strategy that keeps the complete recording represented instead of hiding the overflow.

Useful? React with 👍 / 👎.


### PR #1276 — fix(#1261): revoke PUBLIC/anon from exposed SECURITY DEFINER functions (source-only)

- PR: https://github.com/relativityE/speaksharp/pull/1276

#### CR-168: Keep source registration service-role-only

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YRrej`
- **Thread state:** resolved, outdated
- **Location:** `backend/supabase/migrations/20260811130000_secdef_revoke_public_and_pin_search_path.sql`
- **Created:** 2026-08-11T15:15:04Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Keep source registration service-role-only**

When this migration is applied, granting `authenticated` direct EXECUTE access bypasses the ownership and capability checks in the `objective-register-source` Edge function. The RPC body derives the recording owner without checking `auth.uid()`, and the preceding migration explicitly grants it only to `service_role`, so an authenticated client can directly register an eligible Freestyle recording and bypass the server-owned intent boundary. Revoke authenticated access and retain the existing service-role grant.

Useful? React with 👍 / 👎.

#### CR-169: Make the drift-only promo hardening replay-safe

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YRrep`
- **Thread state:** resolved, outdated
- **Location:** `backend/supabase/migrations/20260811130000_secdef_revoke_public_and_pin_search_path.sql`
- **Created:** 2026-08-11T15:15:04Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Make the drift-only promo hardening replay-safe**

On a fresh database reconstructed from repository migrations, this statement aborts the transaction because no production migration defines `public.redeem_promo(text, uuid)`; a repository-wide search finds that function only in the new disposable bootstrap. Production apparently contains it as historical drift, but the checked-in reconciliation migration is a no-op, so `supabase db reset` or a new environment cannot replay this migration. Guard the drift-only alterations with `to_regprocedure`/dynamic SQL or add a migration-owned definition.

Useful? React with 👍 / 👎.

#### CR-170: Guard hosted-only functions before altering them

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YR8WX`
- **Thread state:** resolved, outdated
- **Location:** `backend/supabase/migrations/20260811143000_harden_exposed_security_definer_acl.sql`
- **Created:** 2026-08-11T15:27:54Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Guard hosted-only functions before altering them**

On a fresh database reconstructed from the checked-in migrations, execution stops here because neither `public.redeem_promo(text, uuid)` nor the later `public.handle_new_user()` is defined anywhere in the preceding migration chain. Fresh evidence beyond the earlier review is that the new disposable bootstrap defines both missing functions itself, so its migration test masks this replay failure. Guard the hosted-drift operations with `to_regprocedure` plus dynamic SQL, or add migration-owned definitions, so `supabase db reset` and new environments can apply the chain.

AGENTS.md reference: [AGENTS.md:L206-L211](https://github.com/relativityE/speaksharp/blob/af223b2ec9ad7ac8b39ec272fc98441b5e8c7d11/AGENTS.md#L206-L211)

Useful? React with 👍 / 👎.


### PR #1274 — ops(#1259): define Practice Loop funnel + Private SLOs and lock content-free telemetry

- PR: https://github.com/relativityE/speaksharp/pull/1274

#### CR-171: Implement pseudonymization before claiming it

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOxum`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/QUALITY.md`
- **Created:** 2026-08-11T12:55:37Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Implement pseudonymization before claiming it**

For every authenticated user, `AuthProvider.tsx:105` passes the raw Supabase user UUID to `analyticsBuffer.identify`, and `AnalyticsBuffer.ts:206-210` forwards it unchanged to `posthog.identify`; the repository contains no `usr_v1_`/`tst_v1_` identity implementation. The new test mocks the buffer and never exercises identity, so it cannot enforce this claim. Either implement the stated HMAC identity scheme without breaking account-targeted flags or document the current raw-ID behavior rather than declaring that raw auth IDs never reach telemetry.

AGENTS.md reference: [AGENTS.md:L475-L477](https://github.com/relativityE/speaksharp/blob/c041de63f9fda6ddf2b1e5ed74a26f29f6cb5935/AGENTS.md#L475-L477)

Useful? React with 👍 / 👎.

#### CR-172: Apply the second redaction layer to Private signals

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOxus`
- **Thread state:** unresolved, outdated
- **Location:** `product_release/QUALITY.md`
- **Created:** 2026-08-11T12:55:37Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Apply the second redaction layer to Private signals**

Whenever a Private lifecycle event is emitted, `privateSampleTelemetry.ts:237-244` calls `posthog.capture` directly, so it never passes through the `AnalyticsBuffer` send-boundary sanitizer described here. The added test only calls `sanitizePrivateSampleProps` and therefore proves one allowlist layer, not the asserted two-layer contract. Route these signals through the buffer or narrow the contract and its evidence so launch reviewers do not rely on a defense-in-depth control that is absent from this path.

AGENTS.md reference: [AGENTS.md:L475-L477](https://github.com/relativityE/speaksharp/blob/c041de63f9fda6ddf2b1e5ed74a26f29f6cb5935/AGENTS.md#L475-L477)

Useful? React with 👍 / 👎.


### PR #1273 — ci(#1262): make merged unit coverage fail closed with one threshold authority

- PR: https://github.com/relativityE/speaksharp/pull/1273

#### CR-173: Reject non-numeric coverage percentages

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6YOSu0`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/coverage-merge-lib.mjs`
- **Created:** 2026-08-11T12:30:42Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject non-numeric coverage percentages**

When a parseable summary contains a metric object but its `pct` is missing or non-numeric (for example after report corruption or schema drift), `actual` becomes `undefined`, `NaN`, or a string such as `"Unknown"`; JavaScript then evaluates `actual < expected` as false and treats the unverifiable metric as passing. The per-file loop has the same behavior, so if all declared file keys exist, the sole CI coverage gate can return `ok: true` without numeric coverage evidence. Require every percentage to be a finite number before comparing it and fail closed otherwise.

Useful? React with 👍 / 👎.


### PR #1126 — chore(infra): single-owner worktree governance (agent collision prevention)

- PR: https://github.com/relativityE/speaksharp/pull/1126

#### CR-174: Reject detached HEAD in ownership checks

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vn-uF`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T11:36:39Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject detached HEAD in ownership checks**

When the worktree is detached, `ctx.branch` is `null`, so this condition skips the branch comparison and reports ownership as confirmed. A claimed agent can therefore detach at another branch and pass the pre-commit/pre-push/pre-rebase guards—including while pushing detached `HEAD` to a branch it does not own—despite the documented fail-closed branch contract. Treat a detached HEAD as an ownership failure.

AGENTS.md reference: [AGENTS.md:L499-L511](https://github.com/relativityE/speaksharp/blob/bdcd3de9f3c0022ae263eea1b7d29f79441c1189/AGENTS.md#L499-L511)

Useful? React with 👍 / 👎.

#### CR-175: Require the current owner's identity for handoff

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vn-uG`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T11:36:39Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Require the current owner's identity for handoff**

When neither `--agent` nor `SS_AGENT` is supplied, this fallback copies the recorded owner into `from`, making the subsequent owner check tautological; any caller in the worktree can transfer its lease to themselves. `cmdRelease` has the analogous optional check, so it can also remove another agent's lease without presenting an identity. Require an agent identity for both ownership-changing commands and compare it with the lease.

AGENTS.md reference: [AGENTS.md:L495-L497](https://github.com/relativityE/speaksharp/blob/bdcd3de9f3c0022ae263eea1b7d29f79441c1189/AGENTS.md#L495-L497)

Useful? React with 👍 / 👎.

#### CR-176: Fail closed when the lease registry is invalid

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vn-uH`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T11:36:39Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail closed when the lease registry is invalid**

If `leases.json` is truncated or malformed, `readLeases` silently returns an empty registry. The next `claim` then sees no conflicts and overwrites the file with only its new lease, allowing a worktree or branch already represented by existing markers to be claimed again. Since the registry is part of the collision-prevention authority, parse/read failures should abort rather than be interpreted as no leases.

AGENTS.md reference: [AGENTS.md:L515-L518](https://github.com/relativityE/speaksharp/blob/bdcd3de9f3c0022ae263eea1b7d29f79441c1189/AGENTS.md#L515-L518)

Useful? React with 👍 / 👎.

#### CR-177: Fail closed when an existing registry disappears

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoIvC`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T12:15:37Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Fail closed when an existing registry disappears**

Unlike the earlier malformed-JSON case, the fresh missing-file path still returns an empty registry. After a successful claim, if `leases.json` is deleted while `.agent-owner.json` remains, another agent can run `claim`; it sees no conflict, overwrites the marker, and successfully takes ownership while also discarding any other leases. Distinguish first-time initialization from a disappeared authority file, and reject initialization when ownership state already exists.

Useful? React with 👍 / 👎.

#### CR-178: Verify marker and branch before handoff or release

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoIvF`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T12:15:37Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Verify marker and branch before handoff or release**

The explicit-agent fix still validates only the registry's path and agent here, not the marker or `lease.branch`. If the marker is missing/corrupt, or the owner switches this worktree from the leased branch to another clean upstream-matching branch, `handoff` succeeds and emits a manifest for the unowned branch/SHA; `release` has the same omission and removes the original branch's lease. Require the same marker, agent, and current-branch agreement enforced by `assert-owner` before either operation.

Useful? React with 👍 / 👎.

#### CR-179: Reject same-agent duplicate branch claims

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoP3C`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T12:42:35Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Reject same-agent duplicate branch claims**

When the same agent ID claims a second worktree forcibly checked out on an already leased branch, the `l.agent !== agent` condition suppresses the conflict. The command then reports success after writing two leases for the same branch, but every subsequent `assert-owner`, `status`, `handoff`, or `release` rejects the registry as having a duplicate branch, disabling ownership operations for all worktrees until manual repair. Enforce branch uniqueness regardless of agent identity while retaining idempotency only for the existing same-path lease.

Useful? React with 👍 / 👎.

#### CR-180: Reject blank lease fields before persisting them

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoP3D`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs:503`
- **Created:** 2026-08-01T12:42:35Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject blank lease fields before persisting them**

When `--agent`/`SS_AGENT` or `--task` contains only whitespace, the truthiness checks accept it and this code persists the value. The next command runs `readLeases`, whose trimmed-nonempty validation rejects that same record, so one accepted claim makes the shared registry unusable for every worktree. Validate or normalize these fields before writing the lease.

Useful? React with 👍 / 👎.

#### CR-181: Reject upstreams that are not remote-tracking refs

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Voftc`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T13:38:09Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject upstreams that are not remote-tracking refs**

When a branch tracks another local branch, `@{upstream}` still resolves and can equal `HEAD`, so this reports a pushed state even though no remote contains the commit. I reproduced this by configuring `feat` with `git branch --set-upstream-to=main feat`: `handoff` succeeded while the remote had no `feat` ref, and `release` would likewise succeed. Verify that the upstream belongs to a real remote rather than the local `.` remote before declaring the handoff releasable.

Useful? React with 👍 / 👎.

#### CR-182: Refuse prune locks not created by the lease

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vofte`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T13:38:09Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refuse prune locks not created by the lease**

When the linked worktree already has a manual lock, Git exits with `already locked, reason: ...`, and this catch treats that foreign lock as a successful lease lock. A later `release` unconditionally runs `git worktree unlock`, removing protection that the tool did not create; `git worktree lock -h` explicitly exposes `--reason <string>` as the lock's reason field. Refuse pre-existing locks or create and verify a lease-specific reason before taking responsibility for unlocking them.

Useful? React with 👍 / 👎.

#### CR-183: Report failures to remove the prune lock

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Voftg`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T13:38:09Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Report failures to remove the prune lock**

When `git worktree unlock` fails because of metadata permissions, repository corruption, or another Git error, `gitQuiet` suppresses the failure and `release` still reports success. By this point the registry lease and marker have already been removed, so the caller cannot retry through the ownership workflow while the worktree remains unexpectedly locked. Propagate or otherwise surface unlock failures instead of silently completing the release.

Useful? React with 👍 / 👎.

#### CR-184: Fail closed when prune-lock inspection fails

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoqTN`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T14:14:11Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail closed when prune-lock inspection fails**

When `git worktree list --porcelain` fails because of metadata permissions, corruption, or another Git error, `gitQuiet` converts the failure into empty output, so `lockReason` returns `null`; `release` then skips unlocking, deletes the lease and marker, and reports success while the worktree remains locked. Fresh evidence at the frozen head is this new error-suppressing call inside `lockReason`, which bypasses the propagated-unlock-failure correction; use the throwing Git path and distinguish inspection failure from an actually unlocked worktree.

Useful? React with 👍 / 👎.

#### CR-185: Revalidate the prune lock on idempotent claims

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoqTR`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs:486`
- **Created:** 2026-08-01T14:14:11Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Revalidate the prune lock on idempotent claims**

When a claimed worktree's lock is removed out of band, rerunning the same `claim` returns success from this no-op path without restoring or rejecting the missing lock; likewise, a replacement foreign lock is accepted until a later `release` fails. This leaves an apparently valid lease without the required anti-prune protection, so the idempotent path should verify that the current lock exists with `LOCK_REASON` before reporting ownership.

Useful? React with 👍 / 👎.

#### CR-186: Verify the prune lock in assert-owner

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoyI_`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs:514`
- **Created:** 2026-08-01T14:39:31Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Verify the prune lock in assert-owner**

When the lease lock is removed or replaced out of band after a successful claim, `assert-owner` still exits successfully because `assertFullOwnership` checks only the marker, registry, and branch. Since this command is the documented mutation preflight, callers can proceed after receiving “owner confirmed” while the worktree lacks the required anti-prune protection; apply the reclaim lock validation here as well.

Useful? React with 👍 / 👎.

#### CR-187: Reject a JSON null owner marker

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoyJA`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T14:39:31Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject a JSON null owner marker**

If `agent-owner.json` is corrupted to the valid JSON value `null` while no registry lease exists, `readMarker` returns the same sentinel used for an absent file, so `claim` treats this as a fresh worktree and silently overwrites the marker. This violates the stated fail-closed/no-silent-repair contract; validate that parsed markers are objects with the authoritative fields, or distinguish file absence from a parsed `null` value.

Useful? React with 👍 / 👎.

#### CR-188: Fail closed when the worktree record is not found

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VoyJB`
- **Thread state:** resolved, outdated
- **Location:** `scripts/agent-worktree.mjs:360`
- **Created:** 2026-08-01T14:39:31Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail closed when the worktree record is not found**

Fresh evidence after the throwing-Git correction is this successful-parse fallthrough: if no block matches the current path, `lockReason` still returns `null`, and `release` removes the lease and marker without unlocking. I reproduced this with a valid worktree path containing a newline—the non-`-z` porcelain record splits the path, idempotent reclaim fails, and release reports success while the lock remains; require a matched block and parse the documented `-z` NUL-terminated format instead.

Useful? React with 👍 / 👎.

#### CR-189: Force untracked files into the cleanliness check

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VqeXK`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T19:33:18Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Force untracked files into the cleanliness check**

When repository or global config sets `status.showUntrackedFiles=no`, this command returns empty output despite untracked recoverable files; `git status -h` confirms that untracked reporting supports a `no` mode. I reproduced `release` succeeding and deleting the marker while an untracked file remained, allowing a subsequent owner to claim the worktree without the promised clean handoff. Pass `--untracked-files=all` explicitly rather than inheriting user configuration.

AGENTS.md reference: [AGENTS.md:L161-L163](https://github.com/relativityE/speaksharp/blob/f09a10384147cb2e8f0a16912da691686de5bf95/AGENTS.md#L161-L163)

Useful? React with 👍 / 👎.

#### CR-190: Check every worktree for initialization evidence

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VqeXP`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T19:33:18Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Check every worktree for initialization evidence**

When a first claim crashes after prune-locking one linked worktree but before writing its marker, registry, or sentinel, a later first claim from another worktree checks only its own lock here and therefore initializes successfully despite the existing contradictory lock evidence. The initialization gate needs to enumerate all known worktrees and reject a prune lock on any of them, not just `ctx.worktreeRoot`.

Useful? React with 👍 / 👎.

#### CR-191: Fail closed when marker enumeration errors

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VqeXR`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T19:33:18Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail closed when marker enumeration errors**

When `.git/worktrees` can be traversed by path but cannot be enumerated—for example, execute permission exists without read permission—`readdirSync` throws and this catch reports that no marker exists. Git operations on the current admin path can still succeed, so the first-claim gate may initialize while another worktree's ownership marker is hidden. Propagate the enumeration failure as an ownership error instead of treating it as pristine state.

Useful? React with 👍 / 👎.

#### CR-192: Inspect locks in every linked worktree before initialization

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VrE_r`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T21:22:57Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Inspect locks in every linked worktree before initialization**

When an interrupted first claim leaves only a prune lock on another linked worktree, this still checks `lockReason` only for the claiming worktree and initializes the registry. Fresh evidence at `1a27ac1` is that the new cross-worktree helper scans only marker files; I reproduced a `wt2` record reported by `git worktree list --porcelain` as `locked stranded-partial-claim`, while claiming unlocked `wt1` exited 0. Enumerate the porcelain records and reject a lock on any worktree before treating the repository as pristine.

AGENTS.md reference: [AGENTS.md:L161-L163](https://github.com/relativityE/speaksharp/blob/1a27ac166b0fa88da60e27640c33545867847ee2/AGENTS.md#L161-L163)

Useful? React with 👍 / 👎.

#### CR-193: Fail closed when a linked marker cannot be inspected

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VrE_s`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-01T21:22:57Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fail closed when a linked marker cannot be inspected**

When `.git/worktrees` itself is readable but one linked worktree's admin directory is not searchable, `readdirSync` succeeds and `existsSync` silently returns false for that worktree's marker. I reproduced this as an unprivileged user by placing a marker in `wt2` and making its admin directory mode `000`; a first claim in `wt1` still exited 0. Use an inspection that distinguishes `ENOENT` from permission/I/O errors so hidden ownership evidence cannot be treated as absence.

AGENTS.md reference: [AGENTS.md:L161-L163](https://github.com/relativityE/speaksharp/blob/1a27ac166b0fa88da60e27640c33545867847ee2/AGENTS.md#L161-L163)

Useful? React with 👍 / 👎.

#### CR-194: Treat dangling marker symlinks as initialization evidence

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vr2c9`
- **Thread state:** resolved
- **Location:** `scripts/agent-worktree.mjs:111`
- **Created:** 2026-08-02T00:06:05Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Treat dangling marker symlinks as initialization evidence**

When an `agent-owner.json` directory entry is a dangling symlink, `statSync` follows it and throws `ENOENT`, so this branch classifies the marker as genuinely absent. I reproduced a fresh claim succeeding and creating the initialization sentinel while another linked worktree had such a marker; on the claiming worktree, the same condition can additionally let the later `writeFileSync` follow the symlink and overwrite its target. Use `lstatSync` or otherwise distinguish a missing directory entry from an existing symlink so contradictory marker state fails closed.

Useful? React with 👍 / 👎.

#### CR-195: Refuse dangling symlinks at the initialization sentinel

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VsKGl`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-02T00:52:23Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refuse dangling symlinks at the initialization sentinel**

When `<common-dir>/agent-worktrees.initialized` is a dangling symlink in an otherwise fresh repository, `existsSync` reports false and the subsequent `writeFileSync` follows the link. I reproduced `claim` exiting successfully, creating the arbitrary symlink target, registry, and marker. This leaves the same write-through hazard fixed for `agent-owner.json`; inspect the sentinel without following links and fail closed for every present non-regular entry.

Useful? React with 👍 / 👎.

#### CR-196: Refuse symlinked registry directories

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VvObl`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-02T08:11:05Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refuse symlinked registry directories**

When `<commonDir>/agent-worktrees` is a symlink to any writable directory, this recursive `mkdirSync` follows it, as do the subsequent `.lock` and `leases.json` operations. I reproduced a fresh claim exiting successfully and writing `leases.json` into the symlink target, so a malformed or adversarial registry entry can bypass the new no-follow discipline and overwrite a file outside the Git common directory. Inspect the registry directory with `lstatSync` and require a real directory before acquiring the lock.

Useful? React with 👍 / 👎.

#### CR-197: Inspect the registry file without following links

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VvObn`
- **Thread state:** unresolved, outdated
- **Location:** `scripts/agent-worktree.mjs`
- **Created:** 2026-08-02T08:11:05Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Inspect the registry file without following links**

When a pristine repository contains a dangling `leases.json` symlink and no sentinel, `existsSync` reports the entry as absent, so the claim reads an empty registry and later replaces the symlink with a new regular registry. I reproduced the claim exiting successfully, silently repairing this contradictory authority state; a symlink to an existing valid JSON file is also followed and accepted as lease authority. Apply the same `lstatSync` regular-file requirement used for markers and the sentinel, treating only a genuine `ENOENT` as absence.

Useful? React with 👍 / 👎.

#### CR-198: Reject local remotes behind remote-shaped upstream refs

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vv_W2`
- **Thread state:** unresolved
- **Location:** `scripts/agent-worktree.mjs:305`
- **Created:** 2026-08-02T10:06:31Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Reject local remotes behind remote-shaped upstream refs**

When `branch.<name>.remote` is `.` but its merge ref is shaped like `refs/remotes/fake/feat`, this prefix check accepts the local ref as a pushed upstream. Fresh evidence at `ea00c618` is that configuring that local upstream and pointing the ref at `HEAD` makes both `handoff` and `release` succeed in a repository with no remotes at all. Check the branch's configured remote and reject `.` or an unconfigured remote rather than relying only on the ref namespace.

Useful? React with 👍 / 👎.

#### CR-199: Preserve trailing whitespace in Git path output

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6Vv_W4`
- **Thread state:** unresolved
- **Location:** `scripts/agent-worktree.mjs:58`
- **Created:** 2026-08-02T10:06:31Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve trailing whitespace in Git path output**

When a linked worktree's valid filesystem path ends in a space or newline, the generic `.trim()` removes part of the path returned by `git rev-parse --show-toplevel`. I reproduced `claim` failing with `spawnSync git ENOENT` because subsequent Git commands use the truncated, nonexistent directory. Strip only Git's record terminator for scalar output instead of trimming arbitrary path characters.

Useful? React with 👍 / 👎.


### PR #1121 — draft(product-value): #1116 increment 1 — Practice Focus on-ramp

- PR: https://github.com/relativityE/speaksharp/pull/1121

#### CR-200: Keep teardown locked until calibration is fully disposed

- **Original severity:** P1
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzGRF`
- **Thread state:** resolved
- **Location:** `frontend/src/components/practice/FreestyleOnrampDialog.tsx:209`
- **Created:** 2026-08-02T17:04:11Z

**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Keep teardown locked until calibration is fully disposed**

When a running or starting test is dismissed with Escape or the dialog’s close control, the calibration UI closes immediately while teardown runs fire-and-forget. The user can then continue to `/session` and start a real recording while `NativeBrowser.stop()` is still pending; because both clients use `DistributedLock` with the same stable tab ID, the real recording can overwrite the calibration lock, after which the stale calibration cleanup marks that lock `TERMINATED` and releases it. The live recording then has no cross-tab mutex, allowing another tab to start concurrently, so continuation should remain blocked until disposal resolves or the lock needs ownership tokens that prevent a stale owner from releasing its successor.

AGENTS.md reference: [AGENTS.md:L434-L436](https://github.com/relativityE/speaksharp/blob/2c20e64d98a036e2f56ba9cbec87f8f2e06f3616/AGENTS.md#L434-L436)

Useful? React with 👍 / 👎.

#### CR-201: Rehydrate recovery state before enabling calibration

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzGRH`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/PracticePage.tsx`
- **Created:** 2026-08-02T17:04:12Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Rehydrate recovery state before enabling calibration**

When an authenticated user has an owner-scoped unsaved recovery draft but reloads or navigates directly to `/practice`, `useUnresolvedRecovery` is not mounted because it exists only on `SessionPage`, so these Zustand fields retain their unlocked defaults. Calibration is therefore enabled despite the unresolved recording, and its same-tab `DistributedLock.acquire()` can overwrite the recording’s retained lock; check or rehydrate the current user’s recovery state before allowing the test.

AGENTS.md reference: [AGENTS.md:L434-L436](https://github.com/relativityE/speaksharp/blob/2c20e64d98a036e2f56ba9cbec87f8f2e06f3616/AGENTS.md#L434-L436)

Useful? React with 👍 / 👎.

#### CR-202: Emit start telemetry only after the on-ramp continues

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzGRJ`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/PracticePage.tsx`
- **Created:** 2026-08-02T17:04:12Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Emit start telemetry only after the on-ramp continues**

If a user opens the new optional on-ramp and then cancels it, this call still emits `quick_practice_started`, even though the telemetry contract defines that event as the handoff to `/session` and no handoff occurred. This inflates practice-start conversion data for every canceled setup; emit the event from `continueFreestyle` immediately before navigation instead.

Useful? React with 👍 / 👎.

#### CR-203: Purge calibration transcript telemetry on close

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzOUg`
- **Thread state:** resolved
- **Location:** `frontend/src/services/practice/calibrationSession.ts:207`
- **Created:** 2026-08-02T17:27:13Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Purge calibration transcript telemetry on close**

`NativeBrowser` publishes raw partial and final text to the process-wide `sessionTelemetryBus`, whose ring buffer retains up to 5,000 events, but this disposal path only stops the engine and releases the lock. Consequently, after a user closes the calibration dialog, `getSessionTelemetryBus().getBufferedEvents()` still contains the calibration transcript until another recording resets the bus, contradicting the UI promise that the temporary transcript is discarded on close. Suppress telemetry for calibration sessions or explicitly clear their buffered events during disposal.

Useful? React with 👍 / 👎.

#### CR-204: Refresh recovery state before allowing calibration

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzOUk`
- **Thread state:** resolved
- **Location:** `frontend/src/pages/PracticePage.tsx:204`
- **Created:** 2026-08-02T17:27:13Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refresh recovery state before allowing calibration**

When `/practice` remains mounted while another tab writes an owner-scoped recovery draft and then closes, this render-time localStorage snapshot never updates because the page does not subscribe to storage changes. Once the other tab's distributed lock expires, the calibration CTA remains enabled and `createCalibrationSession()` checks only this tab's unchanged Zustand fields, so it can acquire the mutex despite unresolved recovery work. Fresh evidence at the exact head is that the reload/direct-navigation case is fixed by this snapshot, but the new cross-tab-after-mount case is still stale; recheck the owned draft at calibration start or react to the recovery storage key.

AGENTS.md reference: [AGENTS.md:L434-L436](https://github.com/relativityE/speaksharp/blob/2e3f395c6e089bce65e7e5e73d6b3d5049630408/AGENTS.md#L434-L436)

Useful? React with 👍 / 👎.

#### CR-205: Purge calibration entries from the native trace

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6VzXbB`
- **Thread state:** resolved
- **Location:** `frontend/src/services/practice/calibrationSession.ts:109`
- **Created:** 2026-08-02T17:52:50Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Purge calibration entries from the native trace**

When calibration captures speech, `NativeBrowser` stores `onresult_raw.rawResults[].transcript` in the process-wide `window.__NATIVE_BROWSER_TRACE__` (`NativeBrowser.ts:556-565`); the production redactor only handles top-level string fields, so this nested transcript remains raw. Fresh evidence at the exact head is that this cleanup resets only `sessionTelemetryBus`, leaving those calibration entries in the 5,000-event native trace after the dialog closes, contrary to the discard promise and allowing a later diagnostic collector to include them. Filter the trace by the calibration `rId` during cleanup or suppress native tracing for this ephemeral session.

Useful? React with 👍 / 👎.

#### CR-206: Refresh the calibration guard when recovery is cleared

- **Original severity:** P2
- **Current triage state:** `unverified`
- **MVP relevance:** `unclassified`
- **GitHub thread:** `PRRT_kwDOPXGt5M6V0fQI`
- **Thread state:** resolved, outdated
- **Location:** `frontend/src/pages/PracticePage.tsx`
- **Created:** 2026-08-02T21:24:35Z

**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Refresh the calibration guard when recovery is cleared**

When `/practice` is mounted while the current user has a recovery draft and another tab later restores or discards that draft, this render-time snapshot remains `true` because the page does not subscribe to changes to the recovery storage key. The calibration button therefore stays disabled, so the fresh start-time preflight cannot run even though recovery is resolved; the user must reload or leave and return. Subscribe to the recovery key or otherwise refresh the disabled state when storage changes.

Useful? React with 👍 / 👎.


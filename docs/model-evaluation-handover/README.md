# PR #1760: model package and product comparison handover

**Draft checkpoint. Not merge ready. The required three-model in-app comparison is incomplete.**
This document is the entry point for a successor; no conversation or local artifact is required
to understand the source, failures, evidence limits or next steps. No live action is authorized
by this document. Incumbent selection remains `v2:base.en`.

## Source and ownership

Remote main verified 2026-10-31 14:00 UTC: `749b76f399ee190084b9c611f49fea2b7bc77c25`,
tree `1df330295c442fcd93c349ee40ff902dd9f0acb3`.
PR receiving head before publication: `a619ceb2b54d07b0c41062ffd2d36dd4687807fd`.
Both are ancestors of integrated source `184ac73aebee1d29ccdf937c1cb6f269fbde4a73`,
tree `896071a8f14c07ab4ad6a004a3969fee1853e670`. Latest-main reconciliation therefore
was verified by a successful merge-preserving rebase onto that exact main; source/history
identities remained unchanged and no force push is needed. A plain flattening rebase was
aborted on a preserved fixture conflict, with no source loss. The packaging commit is a successor; obtain its exact
identity with `git rev-parse HEAD` at the published PR head. No claim of a rewritten history.

Preserved source checkpoints: original `88f78edb414a990fd38168aaef5d376b2fe3606c`
(tree `af25c76272cf4e446ed8be9415e5d660a9b8791f`); measurement successor
`f98509c45e41d5780c19d239a948e82cbda15c9a` (tree `65e7d87eeb5faa8a6a97bbd4bd1e5c20bdf36e57`);
package work `2326a0e40fbe617df64024b5965588d962c99632` (tree `6e5e4981bb9e570b53ff32e876539c56159a9885`).
This task owned the evaluator/package and comparison changes. Jensen's preserved fixture
harness and the receiving native precision correction were preserved; Elon's cloud packet
was not edited. [Complete changed-file map](changed-files.txt) and
[pre-packaging source hashes](source-inventory.json) cover all essential source.

## Purpose, architecture and supported boundary

One validated serializable package descriptor is intended to serve import, evaluation and
staged adoption. Identity, asset inventory and runtime expectations derive from that descriptor.
Compatible packages should require package/config changes, not per-model engine/scorer/driver
edits. This implementation is unqualified; do not promise arbitrary model compatibility.

| Responsibility | Source |
|---|---|
| Package schema, digest, compatibility, derived identity | `frontend/src/services/transcription/modelPackage.ts` |
| Package catalogue and selection | `candidateRegistry.ts`, `candidateSelection.ts`, `model-packages/README.md` in the same directory |
| Installed runtime verification | `runtimeBindings.json`, `scripts/model-evaluator/runtime-bindings.mjs`, `frontend/vite.config.mjs` |
| Asset pin enforcement | `verifiedAssetFetch.ts`, `candidateAssetRequests.ts`, affected Whisper engines/workers |
| Product strategy | `EngineFactory.ts` → `modes/PrivateWhisper.ts` → `engines/PrivateSTT.ts` → architecture adapter |
| Shared preparation budgets | `TranscriptionService.ts`, `preparationBudget.ts` |
| Import and stage adoption | `scripts/model-evaluator/model-package.mts` |
| Configurable campaign and CLI | `scripts/model-evaluator/product-campaign.ts`, `run.mts` |
| Guarded actual-app runner | `tests/model-dropin/run-bounded-comparison.mjs`, `inAppComparison.live.spec.ts`, `comparisonBounds.ts` |
| Existing scoring and canonical authority | `scripts/model-evaluator/product-evidence.ts`, `tests/evidence/modelEvaluator.ts` |
| Transport, cache, cleanup | `tests/model-dropin/{transportBoundary.ts,cachedModelAssets.ts,ownedCleanup.mjs}` |

Supported adapters cover declared Whisper, Granite CTC and strict Parakeet TDT profiles.
Unknown architecture/format/runtime (including hypothetical runtime 5.6) must fail explicitly;
new architecture needs an adapter. A version string does not install runtime code. Runtime
upgrades require installed-byte pins and adapter compatibility validation. Import accepts
already-present local assets, verifies sizes/hashes and refuses shadowing/path escapes;
it does not fetch arbitrary weights or executable code. Staging adoption does not activate it.

Product-lifecycle mode uses timed fixture microphone frames through the actual app's
preprocessing, rolling inference, Stop drain, authoritative final replacement, save and reopen.
The separately labelled raw-decode mode feeds one whole clip directly to PrivateSTT;
its decode-plus-finalize duration is **not Stop-to-final latency**. Browser/device/cache,
fixture delivery, instrumentation overhead and environment differences remain unavoidable.
Shared decoder alone is insufficient parity. Neither fourth-package acceptance nor regression-free
incumbent performance has been demonstrated on this integrated candidate.

## Actual results and evidence

[Sanitized status and accounting](status.json): **0 valid product measurements**, one actual
recording Start, zero verified saved transcripts. Last authenticated read found one unfinished
session with no transcript; charged usage was 30 seconds, not measured audio duration.
There are three retained model outcome rows plus one earlier source-verification preflight failure.
Additional launches failed before test collection. Failed attempts are not successful samples.

| Case | Actual outcome |
|---|---|
| `v2:base.en:1:fixture-001` | Operator interrupted after Start; no final/save proof |
| `parakeet:tdt-v3:int8:1:fixture-001` | Candidate selection failed before recording |
| `granite:turboctc-q4f16:1:fixture-001` | Candidate selection failed before recording |

The selection failure root cause is not conclusively captured. Source inspection identified
a generic 5-second preparation budget entering candidate acquisition; f985 adds candidate
budgets, but no successful post-fix selection validates that explanation. Do not classify
these failures as model accuracy failures.

Original authorization covered 18 actual Starts on one disposable account, including expiry
of its earlier synthetic transcripts/recovery records. One Start was consumed. Original guard
expiry is **2026-10-31 14:02:19.005 UTC** and must not be renewed implicitly. Cumulative
conservative reservations: API 390, mutations 240, local requests 19380, cache 316, app WS 16.
Original ceilings: API 3240, mutations 2160, local 54000, cache 1800, WS 72; per case
180/120/3000/100/4, case 420000 ms. These are reservations, not exact consumption.
Attempt/Start/session ledgers still need complete reconciliation. At least one additional
Start beyond the original 18 is necessary for 18 valid takes after the interrupted Start.
**Future live work requires new source-bound authorization, deadline and resource admission.**

Historical source `921376f49454bf9a90c014f246af8bb05f17b152`, tree
`dd96f1f0375064f739ac9c769c22a2ad0f466cd4`: 114 unit controls and two browser transport
controls passed with recorded admission/timestamps/source binding; scoped driver TypeScript
check exited zero (no retained command log). [Sanitized execution receipt](historical-validation.json).
These do not qualify f985, 2326, 184 or this packaging head. Earlier 110/four validation claims
had missing admission provenance and remain author-reported; do not use them as qualification.

Historical account-free factory decode on e6baab6: Granite WebGPU init 5.822 s/decode 1.042 s;
Parakeet WASM init 8.474 s/decode 2.985 s. These are prior reported diagnostic results,
different backends, no canonical product metrics and no promotion conclusion. Earlier synthetic
standalone scores had unverified acoustic labels/HOLD; no product WER can be inferred.

The [exhaustive measurement specification](../../scripts/model-evaluator/METRICS.md) defines
units, clocks, collector coverage, absent instrumentation, WER S/D/I/N/CER, acquisition,
download/cache, init, partials, finalization, persistence, resources and distribution limits.
All unmeasured product fields remain NOT RUN/NOT MEASURED, never zero. Cached/local
asset delivery cannot establish Internet cold-download time. Focus/coaching require separately
selected journeys and are not measured by Open Mic. No fake percentiles/confidence intervals.

## Code/Security finding disposition

| Finding | Fix and actual verification | Remaining acceptance |
|---|---|---|
| Fetch `.ok`, explicit tsx child loader, `?raw&import` source check | Corrected and exercised on predecessors; source review passed | Integrated-head checks |
| Canonical receipt double counting | Canonical-only scan + conflicting duplicate rejection; controls passed on 921 | Integrated-head checks |
| Redirect/transport bounds; large cached asset chunks; serialized fixture closure | Existing controls passed on 921, including two actual-browser controls | Preserve guards and run affected regression checks |
| Canonical exact-session model authority | Warmed service identity + canonical collector implemented; historical controls passed | Successful exact-session product save/reopen for every model |
| Candidate acquisition timeout | Shared budget correction committed in f985 | Untested; prove actual selection cause and post-fix success |
| Attempt vs Start vs session accounting | f985 partial correction committed | Untested; preserve duplicate earlier preflight, unknown Start reservations and all budgets |
| Structured switch diagnostics | Raw outcome projection is not an approved sanitizer | Implement allowlisted categories; no secrets/URLs/transcripts |
| Playwright `error-context.md` leakage | OPEN, no fix executed | Set/enforce `PLAYWRIGHT_NO_COPY_PROMPT=1` in actual child; dummy sensitive-marker negative test |
| Cache TOCTOU after verification | OPEN; unfinished edit preserved as unapplied patch | Finish stable-byte binding and lifecycle cleanup; tamper after index/between ranges/symlink controls |
| Disposable identity vs empty history | Factory correlated and actual login checked | Explicit maintained-user-exclusion assertion/receipt |
| Package parity and latest-main safety | Source implemented, incumbent selector unchanged | Fourth compatible package with no code edits; unsupported/stale runtime/tamper/stream Stop/second-take/canonical controls; performance comparison |

No integrated quality/build/full-suite/CI pass or final Code/Security approval exists.
No claim of zero functional or performance regression. Do not merge this draft.
Packaging checks passed for Node runner syntax, JSON parsing, patch digest/applicability and
private-marker scanning. The working-edit whitespace check passed before packaging. A full
base-to-head whitespace check failed on preserved vendored runtime/CRLF source and a blank
context line in the unapplied patch. Those bytes were preserved, not silently normalized;
this is an outstanding check result, not a full-diff pass. Commit/push hooks were disabled
for this bounded packaging operation to avoid implicitly launching broad tests.

## Preserved unfinished patch

[UNAPPLIED-cache-toctou.patch](UNAPPLIED-cache-toctou.patch) is nonexecuting documentation.
Its SHA-256 is in source-inventory.json. It was removed from executable source only after
the exact diff was saved and reverse-application checked. It is incomplete and untested.
On a clean compatible successor, inspect it, then use:

```bash
git apply --check docs/model-evaluation-handover/UNAPPLIED-cache-toctou.patch
git apply docs/model-evaluation-handover/UNAPPLIED-cache-toctou.patch
```

Do not apply blindly after changing the target file. Add negative controls and verify file
handle cleanup before claiming the Security finding closed. No automatic runner applies it.

## Setup and resumption commands

Read root AGENTS.md, product_release/{QUALITY,OPERATIONS_AND_SECURITY,RELEASE_PROCESS}.md,
[runner contract](../../tests/model-dropin/EXECUTION.md),
[package import contract](../../frontend/src/services/transcription/model-packages/README.md).
Older README/EXECUTION status and authority language may describe predecessors; this checkpoint
supersedes those historical run-status statements, not their security gates.

Use the repository-pinned Node 22.12.0/pnpm and existing lockfile; verify dependencies/browser
availability. Do not install or download models without selection. Coordinate host ownership
and use `scripts/host-interlock.mjs hold benchmark -- ...` for eligible validation. Examples
below are instructions only, not evidence that they ran on this candidate:

```bash
git rev-parse HEAD HEAD^{tree}
git diff --check
node --check tests/model-dropin/run-bounded-comparison.mjs
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 --no-file-parallelism tests/evidence/__tests__/modelPackage.test.ts tests/evidence/__tests__/productCampaign.test.ts tests/evidence/__tests__/verifiedAssetFetch.test.ts frontend/src/services/transcription/modes/__tests__/PrivateWhisper.packageParity.test.ts frontend/src/services/transcription/__tests__/preparationBudget.test.ts
pnpm quality
pnpm build
```

Also run existing model-dropin/collector tests, runtime binding controls and transport controls
under the admitted host, then applicable required CI on the exact final head. Check package.json
and QUALITY for authoritative commands. Full checks were deliberately not launched during this
bounded packaging handover.

Compatible package workflow (not activation authorization):

```bash
pnpm exec tsx scripts/model-evaluator/model-package.mts import /operator/package/package.json
pnpm exec tsx scripts/model-evaluator/run.mts --mode product-lifecycle
pnpm exec tsx scripts/model-evaluator/model-package.mts stage-adoption /operator/package/package.json /private/product-report.json /private/staged-config.json
```

Product mode delegates to the guarded runner and requires the following secure bindings;
the command alone cannot run. Configure `EVAL_CAMPAIGN_FILE` from
`tests/evidence/fixtures/model-evaluator/product-campaign.json`; derive IDs/identity from
packages. Bind `EVAL_EXECUTION_APPROVAL_FILE`, `EVAL_BACKEND_CONTRACT_RECEIPT`,
`EVAL_SOURCE_ROOT`, `EVAL_APP_URL`, `EVAL_API_ORIGIN`, `EVAL_PRIVATE_OUTPUT`,
`EVAL_TEST_EMAIL` and `EVAL_TEST_PASSWORD` through the existing runner contract. Cached asset
inventory/receipt and any resume receipt need exact hashes and private paths per EXECUTION.md
and launcher. Do not reuse an expired approval or invent compatible backend receipts.

The known account factory is `pnpm make:test-user free|pro` → scripts/make-test-user.sh →
.github/workflows/setup-test-users.yml. It needs separate mutation approval. Its newest-run
selection can race: correlate exact dispatch/run/source, actual login, effective entitlement,
history and usage. Free local consumer keys are FREE_TEST_EMAIL/PASSWORD; Pro E2E_PRO_EMAIL/PASSWORD.
Map only the authorized disposable identity into EVAL_TEST_EMAIL/PASSWORD securely. Never print
passwords, use --print-password, rotate/delete/recreate maintained users or export protected
secrets. The create-only setup-throwaway-test-user.yml route is an alternative only when selected;
its THROWAWAY_* secrets are not automatically evaluator bindings. Factory run 41198324787
created the existing approved disposable account; no credentials/account identifiers are published.
Do not create another merely because the private local file is unavailable to a successor.

Before further live work: finish privacy/cache/accounting controls, freeze and test the source,
reverify backend compatibility and installed assets/runtime, obtain new bounded execution authority
and host admission, reconcile unfinished session state without deleting data, retain every failed
attempt, and preserve each take's sanitized measurements before the next save/retention expiry.
Use the same corpus/conditions for all arms, report sample counts and failures, and never relabel
old-source measurements as integrated-head evidence. Review the one coherent tested final head
for Code/Security only after author verification. No publication implies merge/deploy approval.

## Artifact completeness and privacy

Everything needed to reconstruct the source and tests is in this PR: full file inventory,
runtime/asset pins, fixtures and corpus manifests, metric specification, runner, controls,
sanitized accounting/provenance, failure classification and unfinished patch. Source/input
hashes remain in their checked-in manifests. Reproduce tests rather than trusting an absent log.
Original private raw logs, account bindings, failed receipts and failure pages remain retained
with the originating operator and are deliberately not dependencies of this handover. They are
not suitable for public upload. This handover does not claim an independently reproducible
successful measurement run; none exists. At stop, owned workloads and host locks were zero.

The next owner can start from this document without chat access. The remaining deliverable is
working tested parity plus real comparable in-app measurements, followed by exact-head reviews
and required checks. This packaging checkpoint does not satisfy that acceptance contract.

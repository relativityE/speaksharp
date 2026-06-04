# SpeakSharp Current Workboard

This file is the live coordination board. Keep it small, current, and branch-based.
Backlog priority belongs in `product_release/BACKLOG.md`; evidence belongs in the STT reports.

## Integration Baseline

```text
INTEGRATION_MAIN: origin/main (latest pushed integration baseline; exact SHA via `git rev-parse --short origin/main`)
MERGE_LOCK: free
UPDATED_AT: 2026-06-04T19:40Z
UPDATED_BY: test-release-agent / Codex
```

`main` is the stable integration/evidence baseline. Agents should not experiment directly on
`main`. Work happens in independent branches/worktrees; only final integration is serialized.
Branch/proof rows keep exact base or artifact SHAs where they matter.

## Active Branches And Proofs

| ID | Priority | Owner | Branch / SHA | Base SHA | Status | Purpose | Merge Gate / Next Action |
|---|---|---|---|---|---|---|---|
| STT-P5 | P0 | dev-agent → test-release-agent | `dev/private-vad-silero-main@411b4852` (rebased onto current main) | `main@f9ddf497` | ready / asset staged | VAD engine: Silero VAD via the **existing onnxruntime-web** (NO @ricky0123/vad-web → no duplicate ORT) injected at the `PrivateWhisper` **onset** gate behind `?privateVad=1` / `window.__PRIVATE_VAD_PROTOTYPE__`. Off by default. | **DEV DONE — ready for @test-agent RMS-vs-VAD browser A/B.** Rebased onto current main; staged `frontend/public/models/silero_vad.onnx` (Silero v5, 2,327,524 B, sha256 `1a153a22…`, from official snakers4/silero-vad; I/O verified to match `sileroVad.ts`: input/state/sr → output/stateN, state `[2,1,128]`, sr int64). `onnxruntime-web@1.14.0` resolves transitively (same version, **no duplicate ORT**) so the dynamic import works without a package.json change; explicit direct-dep is optional hygiene (needs `pnpm install`). tsc clean; 49/49 VAD tests. Run the RMS-vs-VAD A/B from PRIVATE_STT `## DEV → TEST: STT-P5`. Do not merge until browser A/B + product approval. |
| STT-P6 | P0 | dev-agent → test-release-agent | `dev/private-model-eval-main@1c50587c` (rebased onto current main) | `main@f9ddf497` | ready / current-main branch provided | Model-eval: flag-selected Private model (`whisper-tiny.en` default / `whisper-base.en` / `distil-small.en`) threaded through worker `init`, behind `?privateModel=` / `window.__PRIVATE_MODEL__`. Off by default. Directly attacks the CI **51.7% WER** decode/model-quality gap. | **DEV DONE — current-main branch provided for @test-agent A/B.** Rebased the 3 model-eval commits cleanly onto current main (off-by-default flag preserved, no unrelated changes); tsc clean; `privateModelFlag` 5/5. Capture `__PRIVATE_MODEL_TELEMETRY__`, WER/accuracy, download MB, load time, decode latency/RTF, app-vs-drop-in, and app-vs-Native-baseline. See PRIVATE_STT `## DEV → TEST: STT-P6`. Do not merge until A/B + product approval. |
| STT-P7 | P0 | dev-agent | `dev/stt-p7-soft-frozen-trace@30eb264a`; tested as `test/stt-p7-current-main-smoke@f98987c3` | `main@2638e604` | injected smoke passed / human proof pending | Private mic-start reliability: human proof hit `RECORDING_LIFECYCLE_FAIL` ~857 ms after `RECORDING` + `Heartbeat Failure Escalated`; user saw mic-click errors/**toasts** before recording worked. | Current-main+P7 test branch served on canonical `localhost:5174` with real auth/runtime proof. Focused unit/type proof passed: 10/10 watchdog/trace tests + frontend typecheck. Injected Private-start smoke passed: recording reached `RECORDING`, stopped, saved, no `RECORDING_LIFECYCLE_FAIL`, no "Engine Frozen" toast, `environmentProof.source=app-runtime-config`, `releaseProofEligible=true`. Artifact trace: `/private/tmp/stt-p7-private-smoke-current/.../trace.zip`. Remaining: test helper did not capture `__PRIVATE_HEARTBEAT_TRACE__`; next human Private proof should confirm no false mic-click/toast and capture heartbeat trace if available. |
| STT-E1 | P0 | test-release-agent | `main@e890716f` | `main@6eaa4ba6` | done | Release-proof environment preflight for Native/Private/Cloud STT evidence. | **MERGED:** shared benchmark snapshots now emit `environmentProof`; Cloud/app-path and Pro STT matrix hard-stop release proof unless `localhost:5174` + real auth; manual Native and manual STT corpus launchers no longer load `.env.test`, default to `5174`, and write INVALID artifacts before recording when the environment is wrong. |
| STT-P1 | P0 | test-release-agent | `test/proof-private-current-main` or workflow artifacts | `main@18299067` | ready | Private current-main human/browser proof | Capture setup consent, `__PRIVATE_TIMING__`, trust trace, `saveCandidate`, detail equality, filler rows, app-vs-drop-in/app-vs-Native deltas. |
| STT-P1D | P1 | dev-agent | `dev/private-live-draft-dedup@5d7d7f89`; tested as `test/private-p1d-current-main@112bb51e` | `main@cc630d3e` | partial pass / dev follow-up needed | Private live-draft repetition + stale filler count (from `conv_01` diagnostic) | **TEST RESULT:** current-main injected proof on canonical `localhost:5174` passed environment proof and the filler-count half (`um=2`, basically=3, like=2, literally=2), but failed the repetition/quality half. Visible live text still repeated (`Uhm, basically... Uhm, basically...`) and the authoritative save candidate was still repeated/corrupted: `Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."` vs truth `Um. Basically, we should literally like, wait.` `saveCandidateReason=service_result`; service_result/committed_final/store_visible_snapshot all length 106. **Next @dev-agent:** keep the filler-count caller fix, but do not merge P1D as release-ready until the service-result/final candidate repetition is fixed or separately classified. See PRIVATE_STT `## TEST → DEV: STT-P1D current-main injected proof`. **DEV RESPONSE (2026-06-04):** confirmed — the repetition is in the whole-utterance **final decode** (`service_result`), not the live display, so the P1D display-dedup is correct-but-insufficient (keep it). Reclassified as a final-candidate **duplication/repetition** bug (same surface as `private-duplication-probe`). Candidate causes: (1) audio duplication in the onset/preroll assembly → **RULED OUT by code**: the final-decode buffer is assembled once and contiguous (onset fires once at `PrivateWhisper.ts:1080`; the only `hasDetectedSpeech=false` is the per-recording reset; the retry buffer affects only the live/provisional path, not `commitWholeUtteranceTranscript`). So this is a **decode-level Whisper repetition loop, not doubled audio**. (2) **most likely driven by degraded box-averaged capture audio → STT-P8 linear-resampler A/B is the primary test** (the same divergence behind the P0 substitution). If the A/B exonerates audio, the fallback is a deterministic post-decode repetition-collapse guard. **DEV UPDATE (built, per @test-agent request): `dev/private-p1d-complete@e77b544c`** — current-main branch carrying the test-confirmed filler-count fix + live-draft dedup **plus** a strengthened `collapseTranscriptRepetitionLoops`. The existing collapse only handled exact whole-text doubling or a unit repeated ≥3×; the conv_01 loop is a **7-word span repeated exactly 2× with a trailing token (odd length)**, which both branches missed → it became the `service_result` save. Fix: also collapse a 2× repeat when the span is long (`>=5` words), longest-span-first; short 2× repeats (`I think I think`, 4-word emphatic doubles) preserved. tsc clean; `PrivateWhisper` 45/45 (all prior collapse cases preserved + conv_01 + short-2× negatives). Complementary to STT-P8 (which targets whether degraded audio triggers the loop upstream). **Next @test-agent:** re-run the conv_01 injected proof on `dev/private-p1d-complete` — expect saved transcript ≈ truth (no doubled phrase) and `um=2` retained. See PRIVATE_STT `## DEV → TEST: STT-P1D repetition-collapse`. |
| STT-P8 | P1 | dev-agent → test-release-agent | `dev/private-resampler-parity@58d9ba7d`; tested as `test/stt-p8-current-main@a38dd948` | `main@ef13a20b` | preliminary A/B: no WER lift yet | Private capture **resampler parity** — close app(63.22%) < drop-in accuracy gap (Open Blocker P0 / F2-#37) | **PRELIM TEST RESULT:** current-main+P8 focused tests pass (`utils` 72/72) and frontend typecheck clean. Injected browser A/B on `conv_01` and `h1_6` did **not** show an accuracy lift: conv_01 box=85.71%, linear=85.71%; h1_6 box=87.5%, linear=87.5%. Linear improved timing in these short runs (conv first text 5879→3355 ms; h1_6 finalization 4492→3392 ms) and did not regress journey/detail. **Next @dev-agent/test:** do not merge on this evidence alone. Either extend A/B to the originally requested human script / harder rows with telemetry captured in-result, or treat linear as timing-only so far and continue with P5/P6. See PRIVATE_STT `## TEST → DEV: STT-P8 preliminary A/B`. |
| STT-N1 | P0 | test-release-agent | `test/proof-native-human` or human artifacts | `main@18299067` | ready | Native real Chrome mic re-proof | Capture `saveCandidate`, formatter telemetry, trust trace, detail transcript, truecasing/readability. |
| STT-V4 | P1 | test-release-agent | `actions@de0e6f1e` run `26966053435`; `actions@18299067` run `26966654691` | listed runs | done | Private v4 containment proof | Browser path produced empty `saveCandidate` / zero saved words in both runs. Keep v4 off release A/B; future work only after a browser decode branch proves non-empty output. |
| STT-C1 | P2 | test-release-agent | `test/proof-cloud-baseline` | latest main when resumed | deferred | Cloud richer baseline proof | Defer until Native/Private blockers move. Baseline only; keyterms/default-filler A/B is stopped. |
| CFG-1 | P0 | dev-agent + test-release-agent | `main@7152c5c8` | `main@078b1a9a` | verified / merged | Config discipline: single `APP_MODES` source of truth + startup banner + app-published `window.__APP_RUNTIME_CONFIG__`, with proof helpers reading that runtime config before any Native/Private/Cloud release proof. | **MERGED + VERIFIED:** shared benchmark preflight now prefers `window.__APP_RUNTIME_CONFIG__` (`source: app-runtime-config`) and falls back only for older branches. Test-agent rerun: CFG unit tests `7/7`, helper-file compile clean, `pnpm dev:test` printed mocked-diagnostics-only banner. Browser runtime proof: `5173/session` publishes `port=5173`, `authMode=mock`, `mockAuth=true`, `supabaseUrl=https://mock.supabase.co`, `releaseProofEligible=false`; active `5174/session` publishes `port=5174`, `authMode=real`, `mockAuth=false`, real Supabase URL, `releaseProofEligible=true`. Cloud is covered because `tests/live/cloud-artifact.live.spec.ts` calls `assertManualReleaseProofEnvironment`. |

## Assignment Notification Protocol

This board is the notification source of truth. An assignment is considered active only when
the relevant row has an owner, priority, branch/proof target, status, and next action.

When assigning or changing work:

1. Update the row in this file.
2. Put detailed instructions and evidence requirements in the relevant STT report.
3. Tell the other agent to pull `main` and read this file plus the named report section.
4. The receiving agent claims the work by updating status/branch in this file before writing.

Do not rely on chat-only instructions for release blockers. Chat can announce the change, but
the durable assignment lives here.

## Manual Proof Environment Contract

Manual human STT proof must use the real-auth manual app only:

```text
Launch command: pnpm dev
Expected URL: http://localhost:5174
Forbidden for human proof: pnpm exec vite, direct vite launch, pnpm dev:test, localhost:5173, .env.test
```

`localhost:5173` is mocked E2E diagnostics only. Any Native/Private human STT artifact collected on
`5173`, with mock auth, or from a direct Vite launch is invalid for release evidence. CDP/browser
monitoring must attach to the same `5174` tab before recording when possible; otherwise the artifact
must explicitly say CDP was unavailable and rely on user observation plus app/server logs.

Implementation status: STT-E1 wires this into shared benchmark snapshots and manual proof launchers.
Expected artifact block:

```json
{
  "environmentProof": {
    "url": "http://localhost:5174/session",
    "port": 5174,
    "authMode": "real",
    "mockAuth": false,
    "releaseProofEligible": true,
    "cdpSameTab": true
  }
}
```

## Branch Status Values

```text
coding
ready
testing
blocked
merge-approved
merged
abandoned
done
```

## Required Branch Declaration

Every active branch or proof must state:

```text
Branch:
Base SHA:
Files touched:
Expected behavior change:
Tests run:
Proof needed:
Rollback plan:
```

## Worktree Model

Each agent should use an independent worktree or isolated branch whenever possible.

| Agent | Preferred workspace |
|---|---|
| dev-agent | dev-owned worktree / `dev/...` branches |
| test-release-agent | test-owned worktree / `test/...` or `docs/...` branches |
| integration | original repo or clean main worktree only |

Agents may test another agent's branch before it merges. That is preferred for risky STT changes:
build branch -> test branch/SHA -> approve or revise -> merge once.

## Merge Rules

- Only one merge to `main` at a time.
- Merge only branches with a task ID, clean diff, tests run, and proof attached or explicitly requested.
- Behavior-changing STT branches need product/test approval before merge.
- Report verdicts and release classifications are serialized; do not let two agents edit the same verdict section at once.
- After merge, update this board with the new `INTEGRATION_MAIN`, branch status, and next proof/action.

## Report Editing Protocol

| Agent | Permission |
|---|---|
| test-release-agent | Owns current verdicts, latest evidence, pass/fail classification |
| dev-agent | Appends only under `## DEV → TEST AGENT` or targeted handoff blocks |
| product owner | Owns priority, scope, release classification, paid/free positioning |

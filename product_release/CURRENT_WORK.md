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
| STT-P5 | P0 | dev-agent | `dev/private-vad-silero-engine@10ba21ca` | `01933f91` | ready | VAD engine: Silero VAD via the **existing onnxruntime-web** (NO @ricky0123/vad-web → no duplicate ORT) injected at the `PrivateWhisper` **onset** gate behind `?privateVad=1` / `window.__PRIVATE_VAD_PROTOTYPE__`. Off by default. | **READY for @test-agent A/B** (test the branch pre-merge). tsc clean; PrivateWhisper 43/43 (flag-OFF byte-identical). Proof recipe: PRIVATE_STT report `## DEV → TEST: STT-P5`. Browser pre-reqs: add `silero_vad.onnx` to `/models/` + declare `onnxruntime-web@1.14.0` in frontend deps. Silence-gate VAD is a fast-follow (onset-only this iteration). Do not merge until A/B + product approval. |
| STT-P6 | P0 | dev-agent | `dev/private-model-eval@25cde3b4` | `d910a07d` | ready | Model-eval: flag-selected Private model (`whisper-tiny.en` default / `whisper-base.en` / `distil-small.en`) threaded through worker `init`, behind `?privateModel=` / `window.__PRIVATE_MODEL__`. Off by default. Directly attacks the CI **51.7% WER** decode/model-quality gap. | **READY for @test-agent A/B** (test branch pre-merge). Dev reports tsc clean + 413/413 transcription suite; proof recipe: PRIVATE_STT report `## DEV → TEST: STT-P6`. Capture `__PRIVATE_MODEL_TELEMETRY__`, WER/accuracy, download MB, load time, decode latency/RTF, app-vs-drop-in, and app-vs-Native-baseline. Do not merge until A/B + product approval. |
| STT-P7 | P0 | dev-agent | `dev/stt-p7-soft-frozen-trace@30eb264a`; tested as `test/stt-p7-current-main-smoke@f98987c3` | `main@2638e604` | injected smoke passed / human proof pending | Private mic-start reliability: human proof hit `RECORDING_LIFECYCLE_FAIL` ~857 ms after `RECORDING` + `Heartbeat Failure Escalated`; user saw mic-click errors/**toasts** before recording worked. | Current-main+P7 test branch served on canonical `localhost:5174` with real auth/runtime proof. Focused unit/type proof passed: 10/10 watchdog/trace tests + frontend typecheck. Injected Private-start smoke passed: recording reached `RECORDING`, stopped, saved, no `RECORDING_LIFECYCLE_FAIL`, no "Engine Frozen" toast, `environmentProof.source=app-runtime-config`, `releaseProofEligible=true`. Artifact trace: `/private/tmp/stt-p7-private-smoke-current/.../trace.zip`. Remaining: test helper did not capture `__PRIVATE_HEARTBEAT_TRACE__`; next human Private proof should confirm no false mic-click/toast and capture heartbeat trace if available. |
| STT-E1 | P0 | test-release-agent | `main@e890716f` | `main@6eaa4ba6` | done | Release-proof environment preflight for Native/Private/Cloud STT evidence. | **MERGED:** shared benchmark snapshots now emit `environmentProof`; Cloud/app-path and Pro STT matrix hard-stop release proof unless `localhost:5174` + real auth; manual Native and manual STT corpus launchers no longer load `.env.test`, default to `5174`, and write INVALID artifacts before recording when the environment is wrong. |
| STT-P1 | P0 | test-release-agent | `test/proof-private-current-main` or workflow artifacts | `main@18299067` | ready | Private current-main human/browser proof | Capture setup consent, `__PRIVATE_TIMING__`, trust trace, `saveCandidate`, detail equality, filler rows, app-vs-drop-in/app-vs-Native deltas. |
| STT-P1D | P1 | test-release-agent / dev-agent | `/private/tmp/private-corpus-conv01-f9b21005.json` | `main@f9b21005` + localhost app | done / actioned | Private injected-mic diagnostic on `conv_01` | **Diagnostic only, not human release proof:** env was valid (`5174`, real auth), save/history/detail passed, first text `2826ms`, final accuracy `85.71%`. New follow-up: @dev-agent owns live-draft repetition and filler normalization (`Umm` should count as user-perceived `um` or lower confidence). Code clue: `countFillerWords()` already matches `umm`, so investigate save metrics preferring stale `store.fillerData` over transcript-derived final filler counts. @test-agent still owns human re-proof. See PRIVATE_STT latest diagnostic section. |
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

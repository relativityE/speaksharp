# SpeakSharp Active Coordination

This file is the **single source of truth** for current release coordination.

`CURRENT_WORK.md` and `STT_PING.md` have been deleted. Do not recreate them, and do not add active work anywhere except this file.

## Protocol

1. Check this file first before starting or claiming work.
2. Every active row has one current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.
3. New findings, bug ownership, proof results, and priority changes are recorded here immediately.
4. Completed or superseded rows are removed immediately. Evidence details stay in reports/artifacts; history stays in git.
5. No second active board, queue, ping log, or hidden assignment list is allowed.
6. **Main-first rule, no exceptions:** we find release bugs on latest `main`. Every agent must know and record the exact `origin/main` SHA they are using before starting, resuming, testing, or handing off work. No guessing.
7. New code/test work starts from latest `origin/main`. Any older code/test branch must be rebased/refreshed onto latest `origin/main` before anyone resumes work on it, tests it, reviews it, or hands it off. Stale branches are not proof-eligible.
8. Rebasing a proof branch onto latest `origin/main` means **"make this branch current enough to test."** It does **not** mean "add this branch to main."
9. Proof-gated working branches are shared with the **test agent** after they are rebased on latest `origin/main`. The test agent runs the agreed proof battery and merges to `main` only after proof success. Branch owners do **not** self-merge proof-gated work.
10. Coordination/doc-only updates are not proof branches and do not require the proof-branch rebase ritual or an immediate rebase by other agents. They may be committed/merged normally as coordination changes. A proof branch only needs to be refreshed before handoff/testing/merge, or when main changed in code/test files that could affect the proof.
11. Completed, non-proof-gated branches merge to `main` and push ASAP, then the local branch is deleted. Do not let completed work sit off-main.
12. Before asking another agent to test or review a code/test branch, the owner must run:
   `git fetch origin main --prune && git rev-list --left-right --count origin/main...<branch>`
   and the left count must be `0` unless the row explicitly says the branch is intentionally stale and not proof-eligible.

## Integration Baseline

```text
INTEGRATION_MAIN: origin/main@33959f8a
MERGE_LOCK: free
UPDATED_AT: 2026-06-07T08:35Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Branch / Main Ledger

This table is a coordination snapshot. Update it whenever an agent creates, rebases, merges, deletes, or hands off a branch.

| Updated UTC | Agent | Main SHA In Use | Open Local Branch Count | Open Branches / Status |
|---|---|---:|---:|---|
| 2026-06-07T08:35Z | test-release-agent | `origin/main@33959f8a` | 1 coordination branch | `test/coord-clarify-rebase-vs-merge` doc-only clarification; merge/delete immediately after commit. |
| 2026-06-07T08:35Z | dev-agent | `origin/main@33959f8a` required before next handoff | 4 observed `dev/*` branches | `dev/v4-recovery@4bbd22e8` is the active V4 proof branch and trails latest main only by coordination commits; test will refresh before proof. `dev/account-recording-lease@dd1ebd3c`, `dev/ux-nav-1-draft-on-unload@75566bc3`, and `dev/maxdepth-instrument@3de1625e` remain local/in-flight or diagnostic until their rows say otherwise. |
| 2026-06-07T08:35Z | remote | `origin/main@33959f8a` | 0 remote feature branches | Remote branches are clean: only `origin/main`. |

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-07T06:44Z | NATIVE-FMT-1 | P0 | test-release-agent -> dev-agent | **human ground-truth proof found Native formatter/readability failure** | Stronger 45s real Chrome/CDP proof wrote `/private/tmp/native-groundtruth-1780814385518.json`. Final/save candidate: `Speak sharp microphone Starts Now basically ... the main ideas that every transcript should stay readable keep prior sentences ... confirm the score explains transcript quality.` WER `0.0926` / accuracy `0.9074`; tail is no longer clipped. Readability flags remain: `badStartsNowCapitalization=true`, `missingCommaBeforeKeep=true`, 53-word run-on. Formatter telemetry is the root clue: attempted `true`, provider `gemini`, latency `1170ms`, but `errorCode=FORMATTER_WORDS_CHANGED`, `fallbackToRaw=true`, `outputChars=null`, so the app rejected the formatted result and saved raw Web Speech. Earlier 30s artifact `/private/tmp/native-groundtruth-1780814224430.json` showed the same readability defects but clipped the tail; use the 45s artifact for accuracy. **Ask (dev):** fix Native formatting so generic punctuation/casing improvements survive the word-preserving guard without changing words. Add tests for `proof starts now basically`, comma/punctuation before `keep prior sentences`, and long run-on prevention. | `=> dev` |
| 2026-06-07T06:49Z | STT-P6-HUMAN-V2 | P0 | test-release-agent | **v2 human tiny-vs-base comparison captured** | Real Chrome/CDP manual proofs on `localhost:5174`. **Base opt-in:** `/private/tmp/private-whisper-base.en-groundtruth-1780814136880.json`, telemetry `model=whisper-base.en`, `approxMB=80`, `overridden=true`, `selectionSource=url`, `loadTimeMs=2366`, final/save WER `0.037` / accuracy `0.963`, first visible text `12747ms`, `finalizeWaitMs=2156.9`, `finalizeDecodeMs=4777.3`, utterance `26.879s`. **Tiny default redo:** `/private/tmp/private-tiny-groundtruth-1780814593729.json`, telemetry `model=whisper-tiny.en`, `approxMB=40`, `overridden=false`, `selectionSource=default`, `loadTimeMs=1082`, final/save WER `0.0926` / accuracy `0.9074`, first visible text `9774ms`, `finalizeWaitMs=119.9`, `finalizeDecodeMs=2635.3`, utterance `40.633s`. Human pasted final tiny text matches artifact: `Speech-sharp microphone proof starts now... every transcription, state readable...`. Evidence supports base being materially more accurate on this script while tiny is faster/lighter. | `=> test/product` |
| 2026-06-07T07:42Z | PRIVATE-BASE-DEFAULT | P0 | test-release-agent -> dev-agent | **product direction: Private release path is v2 base, plus v4 fp32/q8 if proven; no tiny in user-facing release** | Human proof comparison supports base over tiny for release quality: base final/save WER `0.037` / accuracy `0.963` vs tiny WER `0.0926` / accuracy `0.9074` on the same release script. Tradeoff: base is slower/heavier (`approxMB=80`, first visible text `12747ms`, finalize decode `4777.3ms`) while tiny is faster/lighter (`approxMB=40`, first visible text `9774ms`, finalize decode `2635.3ms`). Product direction: optimize Private release for transcript trust, not fastest first text. **Ask (dev):** implement v2 base as the Private release default, do **not** expose tiny as a user-facing release option, keep tiny only as an internal/emergency fallback if needed, preserve friendly copy/no raw model names, keep consent size honest, and ensure telemetry/detail proves the selected default. If v4 fp32/q8 passes Tier-1 app-path proof and quality/speed gates, it joins v2 base in the Private release path; otherwise v4 remains hidden. | `=> dev` |
| 2026-06-07T08:37Z | V4 | P0 | test-release-agent -> dev-agent | **Tier-1 app-path proof FAIL — audio delivered, V4 inference repeatedly errors, no transcript** | Proof branch: local `test/v4-tier1-proof@c674020e` = latest `origin/main@8bb92117` + V4 candidate. Targeted V4 guards passed **17/17** (`v4DecodePlan`, worker protocol, provider config). Real-auth app proof wrote `/private/tmp/speaksharp-v4-tier1-c674020e.json`; environment valid (`url=http://localhost:5174/session`, `authMode=real`, `mockAuth=false`, `releaseProofEligible=true`, `cdpSameTab=true`, no invalid reasons). Result: fixture `h1_6`, truth `They, like, told wild tales to frighten him.`, transcript `""`, WER `1`, accuracy `0`, firstText `null`, sessionPersisted `false`, stopSelectedSource `empty`, firstBrokenBoundary `engine_emits_text`. Input was not silent: `privateAudioChunks=39`, utterance chunk `durationSec=4.045`, `rms=0.124552`, `peak=0.730975`, `speech_start_detected=1`, `process_audio_ready=39`, `model_inference_start=39`. Failure signature: `invalid data location: undefined for input "a"` appeared in **40 trace/error events** and **79 console events**; final `__STT_EVIDENCE__` still showed engine/runtime fields as `NOT_AVAILABLE`, so V4 telemetry is not propagating into the collector on failure. **Ask (dev):** treat as product-path V4 failure, not test silence. Fix the worker/app path so V4 inference emits text or explicitly classifies the runtime failure in `__STT_EVIDENCE__`/`__PRIVATE_V4_LAST_ERROR__`; return a rebased proof branch when ready. | `=> dev` |
| 2026-06-07T08:37Z | STT-IDENTITY-DIAG | P0 | test-release-agent -> dev-agent | **dev/test-only STT version badge and artifact identity are needed** | Human testers still cannot reliably tell whether a live Private run is v2 tiny, v2 base, or V4. Current URL overrides and artifact telemetry help after the fact, but during recording the UI does not expose a dev/test-only identity. **Ask (dev):** add a dev/test-only, release-hidden STT identity surface visible during manual proof when enabled by debug flag/manual proof mode. It should show mode, provider/engine, model (`whisper-base.en`, `whisper-tiny.en`, V4), selection source/default vs override, approx MB, device/backend, dtype/quant where applicable, and hidden/release-candidate status. Also ensure the same identity is emitted into `window.__STT_EVIDENCE__()` and corpus artifacts so test can prove which variant was run without relying on pasted URLs. Must not show raw model names to normal users/release copy. | `=> dev` |
| 2026-06-07T07:35Z | LOCK-FALSE-POSITIVE | P0 | dev-agent -> test-release-agent | **FIXED + landed (stable per-tab id) — needs multi-tab/profile reproof** | Root cause: `DistributedLock` and `useActiveSessionLock` each generated a RANDOM tabId per page-load, so a reload (or the two mechanisms disagreeing) made a tab fail to recognize its OWN still-fresh lock → false "Active session in another tab." Fix on `main@8aa55d4a`: shared `getStableTabId()` backed by `sessionStorage` (persists across reload within a tab, distinct per tab, cleared on close) used by both. 13/13, tsc+eslint clean. **Ask (test):** rerun — (1) reload mid-setup no longer false-locks; (2) two tabs same browser still blocks the 2nd. NOTE: device-local (cross-tab) only — cross-device is ACCOUNT-REC-LEASE. | `=> test` |
| 2026-06-07T07:35Z | ACCOUNT-REC-LEASE | P0 | dev-agent | **server-side single-recording mutex (anti credential-sharing) — enforcement core built; client wiring next** | **Finding (product-confirmed):** the localStorage lock is device-local, so the same account can record on multiple machines/browsers at once (credential sharing). **Decision:** ONE active recording per account anywhere; a live other device BLOCKS by default; user may explicitly **take over**; default (no choice) = stay blocked. **Increment 1 DONE (`dev/account-recording-lease@dd1ebd3c`, local):** migration `20260607040000_active_recording_lease.sql` — `active_recording_lease` table keyed by user_id + heartbeat; RLS owner-scoped; atomic SECURITY DEFINER RPCs `acquire/heartbeat/release_recording_lease` (auth.uid()-gated, FOR UPDATE lock, `held_by_other` unless `p_force`, stale >15s auto-frees, heartbeat→`valid:false` when revoked); GRANT to authenticated. Pure `recordingLeasePolicy.ts` — policy 8/8, migration-contract 4/4, tsc+eslint clean. **Increment 2 (dev, next):** client lease service (RPC + ~3s heartbeat + revocation→stop) + controller start/stop integration + take-over UX. **=> product-ops:** apply migration to live DB. **=> test:** after wiring, multi-device/profile proof. | `=> dev` |
| 2026-06-07T07:52Z | ACCOUNT-MUTEX | P0 | product/test-release-agent -> dev-agent | **cross-device same-login concurrent recording must be blocked** | Product decision: same credentials are shareable/abusable, so active recording must be single-session **across devices/profiles**, not just across tabs in one browser profile. Current implementation evidence: `DistributedLock` and `useActiveSessionLock` use `localStorage['speaksharp_active_session_lock']` with a 5s heartbeat, which only coordinates same-browser/profile contexts; it cannot protect two machines. **Test harness added:** `tests/live/account-wide-recording-mutex.live.spec.ts` creates/signs into the same account in two isolated Playwright browser contexts (simulated machines), starts recording on machine A, then asserts machine B cannot record and sees active-session copy. Initial harness smoke exposed a blank/stuck local dev-server response before reaching the mutex assertion; keep that separate from the acceptance criterion. **Ask (dev):** implement server/account-wide recording lease with heartbeat/expiry, then return a branch for this proof. **Ask (test):** rerun this live proof on real-auth `5174`; PASS requires second context `data-recording !== true` plus clear active-session/another-device messaging. | `=> dev` |
| 2026-06-07T05:40Z | UX-NAV-1 | P0 | dev-agent -> test-release-agent | **root cause: branch had been RESET (fix lost); restored + hardened — re-run on exact SHA** | **Why the proof failed:** the branch `dev/ux-nav-1-draft-on-unload` had been `git reset --hard origin/main` (reflog: `@{0} reset: moving to origin/main`), which DISCARDED the fix commit — so the tested branch contained NO `persistActiveRecoveryDraft` and the OLD App.tsx (no flush). The proof was run against fix-less code; the observed "no draft" is expected for that state, not a logic bug. **Restored + hardened:** branch is now **`dev/ux-nav-1-draft-on-unload@75566bc3`** = current `main` + ONE commit (diff = only `App.tsx`, `SpeechRuntimeController.ts`, `SpeechRuntimeController.test.ts`). Re-applied the fix AND made persistence not depend solely on `beforeunload`/`pagehide` (unreliable in automation): App.tsx now also persists on `visibilitychange→hidden` and on a **2s heartbeat** while `isListening`, so a hard reload/crash always leaves a recent draft. Controller+draft tests 29/29, tsc + eslint clean. **Before re-running, please verify the branch state** (this is what bit us): `git -C <worktree> rev-parse dev/ux-nav-1-draft-on-unload` == `75566bc3` AND `grep -rc persistActiveRecoveryDraft frontend/src/services/SpeechRuntimeController.ts` == 1. Then re-run the same real-auth 5174 battery (URL/refresh recovery, tab-close recovery, in-app nav no-regression, normal save → no leftover draft, no max-depth). **Land rule:** dev merges on PASS. | `=> test` |
| 2026-06-07T01:09Z | PROD-CONFIG-1 | P0 | product-ops -> test-release-agent | **live proof found production Stripe key is TEST** | Live browser proof against `https://speaksharp-public.vercel.app/`, `/pricing`, `/auth/signup`, `/history`, and `/session`: `window.__APP_RUNTIME_CONFIG__` is present and reports real Supabase (`mockAuth=false`, `releaseProofEligible=true`), `release="81375b7965e72320f2f36e5d8aae60fb8b56c07f"`, and `stripeKeyClass="test"`. Public home/pricing pages did not expose checkout/Stripe/subscribe buttons; `/pricing` showed Pro plan copy plus only a `Start Free` button. **Required product-ops action before launch/payment exposure:** set live Stripe publishable key or keep payment surfaces hidden. After deploy, test rechecks `stripeKeyClass === "live"` for payment launch, or confirms non-live key still hides checkout. | `=> product-ops/test` |
| 2026-06-06T21:57Z | PAYMENT-LIVE-GATE | P0 | product-ops | **prod non-live proof PASS** | Public browser audit of `/pricing` with non-live Stripe showed no checkout/Stripe/subscribe/upgrade-now surface; visible action is `Start Free`. Product-ops sets live Stripe key when ready; until then payment surfaces remain hidden. | `=> product-ops` |

## Current Human STT Artifact Manifest

Full JSON artifacts are stored locally for dev/test inspection. Do not paste the full JSON into this board; open the files directly.

| Run | Full JSON artifact | Contains |
|---|---|---|
| Private v2 base opt-in | `/private/tmp/private-whisper-base.en-groundtruth-1780814136880.json` | model telemetry, transcript samples, save candidate, timing, `__STT_EVIDENCE__`, 252 browser log entries |
| Private v2 tiny default | `/private/tmp/private-tiny-groundtruth-1780814593729.json` | model telemetry, transcript samples, save candidate, timing, `__STT_EVIDENCE__`, 231 browser log entries |
| Private v4 app path | `/private/tmp/private-transformers-js-v4-groundtruth-1780814731447.json` | zero-transcript failure, `invalid data location: undefined for input "a"` console errors, save guard state, timing, 238 browser log entries |
| Native 45s real mic | `/private/tmp/native-groundtruth-1780814385518.json` | formatter telemetry (`FORMATTER_WORDS_CHANGED`, raw fallback), transcript samples, save candidate, timing, 448 browser log entries |
| Native 30s real mic | `/private/tmp/native-groundtruth-1780814224430.json` | earlier clipped-tail Native run; keep only as corroborating readability evidence, not final-tail accuracy proof |
| Private v2 base false lock attempt | no JSON artifact | Run failed before artifact write; visible finding was `Active session in another tab` despite one visible tab and base telemetry confirming `whisper-base.en` loaded. This is being investigated under active-lock false-positive work. |

## Manual Proof Environment Contract

Manual human STT proof must use the real-auth manual app only:

```text
Launch command: pnpm dev
Expected URL: http://localhost:5174
Forbidden: pnpm exec vite, direct vite launch, pnpm dev:test, localhost:5173, .env.test
```

`localhost:5173` is mocked E2E diagnostics only. Any Native/Private human STT artifact collected on `5173`, with mock auth, or from a direct Vite launch is invalid for release evidence.

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

## Branch Protocol

- Every agent works on a branch/worktree.
- Completed work merges to `main`, pushes to GitHub, and deletes the branch.
- Do not push remote branches other than `main`.
- Do not merge failing, diagnostic-only, or stale branches.
- Behavior-changing STT branches need proof or explicit product/test approval before merge.

# SpeakSharp Active Coordination

This file is the **single source of truth** for current release coordination.

`CURRENT_WORK.md` and `STT_PING.md` have been deleted. Do not recreate them, and do not add active work anywhere except this file.

## Protocol

1. Check this file first before starting or claiming work.
2. Every active row has one current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.
3. New findings, bug ownership, proof results, and priority changes are recorded here immediately.
4. Completed or superseded rows are removed immediately. Evidence details stay in reports/artifacts; history stays in git.
5. No second active board, queue, ping log, or hidden assignment list is allowed.

## Integration Baseline

```text
INTEGRATION_MAIN: latest pushed origin/main
MERGE_LOCK: free
UPDATED_AT: 2026-06-07T06:38Z
UPDATED_BY: test-release-agent / Codex
```

Work happens on isolated local branches/worktrees. Completed branches merge to `main`, get pushed to GitHub, and then get deleted. Only `main` should exist on GitHub.

## Active Work

| Updated UTC | ID | Priority | Owner | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|---|---|
| 2026-06-07T06:44Z | NATIVE-FMT-1 | P0 | test-release-agent -> dev-agent | **human ground-truth proof found Native formatter/readability failure** | Stronger 45s real Chrome/CDP proof wrote `/private/tmp/native-groundtruth-1780814385518.json`. Final/save candidate: `Speak sharp microphone Starts Now basically ... the main ideas that every transcript should stay readable keep prior sentences ... confirm the score explains transcript quality.` WER `0.0926` / accuracy `0.9074`; tail is no longer clipped. Readability flags remain: `badStartsNowCapitalization=true`, `missingCommaBeforeKeep=true`, 53-word run-on. Formatter telemetry is the root clue: attempted `true`, provider `gemini`, latency `1170ms`, but `errorCode=FORMATTER_WORDS_CHANGED`, `fallbackToRaw=true`, `outputChars=null`, so the app rejected the formatted result and saved raw Web Speech. Earlier 30s artifact `/private/tmp/native-groundtruth-1780814224430.json` showed the same readability defects but clipped the tail; use the 45s artifact for accuracy. **Ask (dev):** fix Native formatting so generic punctuation/casing improvements survive the word-preserving guard without changing words. Add tests for `proof starts now basically`, comma/punctuation before `keep prior sentences`, and long run-on prevention. | `=> dev` |
| 2026-06-07T06:49Z | STT-P6-HUMAN-V2 | P0 | test-release-agent | **v2 human tiny-vs-base comparison captured** | Real Chrome/CDP manual proofs on `localhost:5174`. **Base opt-in:** `/private/tmp/private-whisper-base.en-groundtruth-1780814136880.json`, telemetry `model=whisper-base.en`, `approxMB=80`, `overridden=true`, `selectionSource=url`, `loadTimeMs=2366`, final/save WER `0.037` / accuracy `0.963`, first visible text `12747ms`, `finalizeWaitMs=2156.9`, `finalizeDecodeMs=4777.3`, utterance `26.879s`. **Tiny default redo:** `/private/tmp/private-tiny-groundtruth-1780814593729.json`, telemetry `model=whisper-tiny.en`, `approxMB=40`, `overridden=false`, `selectionSource=default`, `loadTimeMs=1082`, final/save WER `0.0926` / accuracy `0.9074`, first visible text `9774ms`, `finalizeWaitMs=119.9`, `finalizeDecodeMs=2635.3`, utterance `40.633s`. Human pasted final tiny text matches artifact: `Speech-sharp microphone proof starts now... every transcription, state readable...`. Evidence supports base being materially more accurate on this script while tiny is faster/lighter. | `=> test/product` |
| 2026-06-07T07:05Z | PRIVATE-BASE-DEFAULT | P0 | test-release-agent -> dev-agent | **product direction: make v2 base the release default candidate** | Human proof comparison now supports base over tiny for release quality: base final/save WER `0.037` / accuracy `0.963` vs tiny WER `0.0926` / accuracy `0.9074` on the same release script. Tradeoff: base is slower/heavier (`approxMB=80`, first visible text `12747ms`, finalize decode `4777.3ms`) while tiny is faster/lighter (`approxMB=40`, first visible text `9774ms`, finalize decode `2635.3ms`). Product direction is to prefer quality unless latency proves unacceptable. **Ask (dev):** implement v2 base as the Private release default with tiny as fallback, preserve friendly copy/no raw model names, keep consent size honest, and ensure telemetry/detail proves the selected default. | `=> dev` |
| 2026-06-07T06:53Z | V4 | P0 | test-release-agent -> dev-agent | **Tier-1 authed human app-path FAIL: valid audio, zero transcript, ORT input-location error** | Real Chrome/CDP manual proof on `localhost:5174` with `PRIVATE_ENGINE=transformers-js-v4`, artifact `/private/tmp/private-transformers-js-v4-groundtruth-1780814731447.json`. App reached recording and processed valid human audio (`utteranceSeconds=41.524`, `anchor=speech`), but `firstVisibleTextMs=null`, transcript-only fields empty, save candidate empty, and session discarded as low-quality/empty. `window.__STT_EVIDENCE__()` verdict `FAIL`, `invalidReason=fail_no_transcript`, transcriptLength `0`, decodeMs `189`, rtf `0.0046`. Console logs repeatedly show `{ err: Error: invalid data location: undefined for input "a" } [TransformersJSV4] Transcription failed` during chunk processing and stop finalization. This is not an accuracy result; it is an app-path v4 decode failure despite valid audio. **Ask (dev):** continue v4 dtype/runtime ladder from the current branch; next candidate should eliminate the ORT `input "a"` failure. Also add a testing-only identity surface through `window.__STT_EVIDENCE__()` (not user-visible) with `engine`, `modelId`, `dtype`, `requestedDevice`, `resolvedDevice`, `runtimeVersion`, and `selectionSource`. Current v4 artifact identified `transformers-js-v4` and console model `onnx-community/whisper-tiny.en`, but `__STT_EVIDENCE__` returned `modelId/dtype/resolvedDevice=NOT_AVAILABLE`, so testers cannot reliably tell which v4 model/config is running. | `=> dev` |
| 2026-06-07T06:58Z | LOCK-FALSE-POSITIVE | P0 | test-release-agent -> dev-agent | **human proof hit false active-session lock while only one visible tab was present** | During Private v2 base setup on real Chrome/CDP `localhost:5174`, the app showed `⛔ Active session in another tab. Switch to that tab to continue.` even though the tester reported one visible tab. Base model telemetry had loaded (`model=whisper-base.en`, `approxMB=80`, `overridden=true`, `selectionSource=url`), but recording could not start and the proof script failed before writing JSON. Clearing only `localStorage['speaksharp_active_session_lock']` allowed the later base proof to run and pass. **Ask (dev):** investigate stale/phantom lock handling between the UI's lock-held state and the controller/distributed lock; users must not be blocked by stale locks after closed/crashed tabs. Test can rerun a targeted stale-lock repro after dev provides a fix. | `=> dev` |
| 2026-06-07T05:40Z | UX-NAV-1 | P0 | dev-agent -> test-release-agent | **root cause: branch had been RESET (fix lost); restored + hardened — re-run on exact SHA** | **Why the proof failed:** the branch `dev/ux-nav-1-draft-on-unload` had been `git reset --hard origin/main` (reflog: `@{0} reset: moving to origin/main`), which DISCARDED the fix commit — so the tested branch contained NO `persistActiveRecoveryDraft` and the OLD App.tsx (no flush). The proof was run against fix-less code; the observed "no draft" is expected for that state, not a logic bug. **Restored + hardened:** branch is now **`dev/ux-nav-1-draft-on-unload@75566bc3`** = current `main` + ONE commit (diff = only `App.tsx`, `SpeechRuntimeController.ts`, `SpeechRuntimeController.test.ts`). Re-applied the fix AND made persistence not depend solely on `beforeunload`/`pagehide` (unreliable in automation): App.tsx now also persists on `visibilitychange→hidden` and on a **2s heartbeat** while `isListening`, so a hard reload/crash always leaves a recent draft. Controller+draft tests 29/29, tsc + eslint clean. **Before re-running, please verify the branch state** (this is what bit us): `git -C <worktree> rev-parse dev/ux-nav-1-draft-on-unload` == `75566bc3` AND `grep -rc persistActiveRecoveryDraft frontend/src/services/SpeechRuntimeController.ts` == 1. Then re-run the same real-auth 5174 battery (URL/refresh recovery, tab-close recovery, in-app nav no-regression, normal save → no leftover draft, no max-depth). **Land rule:** dev merges on PASS. | `=> test` |
| 2026-06-07T01:09Z | PROD-CONFIG-1 | P0 | product-ops -> test-release-agent | **live proof found production Stripe key is TEST** | Live browser proof against `https://speaksharp-public.vercel.app/`, `/pricing`, `/auth/signup`, `/history`, and `/session`: `window.__APP_RUNTIME_CONFIG__` is present and reports real Supabase (`mockAuth=false`, `releaseProofEligible=true`), `release="81375b7965e72320f2f36e5d8aae60fb8b56c07f"`, and `stripeKeyClass="test"`. Public home/pricing pages did not expose checkout/Stripe/subscribe buttons; `/pricing` showed Pro plan copy plus only a `Start Free` button. **Required product-ops action before launch/payment exposure:** set live Stripe publishable key or keep payment surfaces hidden. After deploy, test rechecks `stripeKeyClass === "live"` for payment launch, or confirms non-live key still hides checkout. | `=> product-ops/test` |
| 2026-06-06T21:57Z | PAYMENT-LIVE-GATE | P0 | product-ops | **prod non-live proof PASS** | Public browser audit of `/pricing` with non-live Stripe showed no checkout/Stripe/subscribe/upgrade-now surface; visible action is `Start Free`. Product-ops sets live Stripe key when ready; until then payment surfaces remain hidden. | `=> product-ops` |
| 2026-06-07T07:05Z | RC-LIVE-DAST | P0 | test-release-agent | **secrets present; gate-3-dast dispatching** | Verified GitHub secret names exist for the rc-gates DAST workflow: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PRO_TEST_EMAIL`, `PRO_TEST_PASSWORD`, `BASIC_TEST_EMAIL`, `BASIC_TEST_PASSWORD`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `EDGE_FN_URL`, and `AGENT_SECRET`. `FREE_TEST_*` is absent but workflow explicitly falls back to `BASIC_TEST_*`. Next action: run `.github/workflows/rc-gates.yml` with `gate=gate-3-dast` and `base_url=https://speaksharp-public.vercel.app`; report pass/fail logs. | `=> test` |

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

# v4 App-Path Proof Runbook (#76) — one command once a human provides auth

Owner: Dev. Branch: `dev/v4-app-path-proof-harness` (off `main`). Goal: make the v4
flag-on lifecycle proof a **single command** the moment a human supplies auth/storageState.
Dev cannot enter credentials, so the login/storageState step is the only manual gate.

## What the proof must show

```text
auth/session -> v4 selected (flag or dev/test override) -> record -> stop ->
final transcript -> save -> history/detail   (engine = transformers-js-v4, variant = base_q4)
```

## Harness

`scripts/manual-stt-corpus-proof.mjs` (Playwright). Drives a real browser through
record/stop/save and writes a JSON artifact. Audio is injected from a fixture (no real mic).

## The one human step (Dev-blocked)

Dev is barred from entering passwords. A human must EITHER:
- export real creds (`PRO_TEST_EMAIL` / `PRO_TEST_PASSWORD`, …) for the harness to log in, OR
- run `create-auth-storage-state.mjs` once to produce a `storageState` session the harness reuses.

After that, the command below runs unattended.

## Command (base-q4 v4, Private mode, injected audio)

```bash
# Prereq: build/serve an app that CONTAINS the v4 code (post-inert-merge main, or a
# build of dev/v4-flag-ready). v4 is selected via the dev/test override (honored only
# in dev/test builds — see PrivateSTT.isPrivateOverrideContextAllowed) OR the PostHog
# flag targeted to the test user. The PostHog-flag path is the better user-readiness proof.

BASE_URL=http://localhost:5174 \
STT_AUTH=existing \                         # or storageState session prepared by a human
PRO_TEST_EMAIL=<human-supplied> \
PRO_TEST_PASSWORD=<human-supplied> \
STT_MODES=private \
STT_FIXTURES=h1_1 \
STT_PRIVATE_ENGINE=transformers-js-v4 \     # forces v4 (dev/test override) -> loads base-q4
STT_USE_FAKE_AUDIO_CAPTURE=true \
STT_FAKE_AUDIO_FILE=<fixture wav> \
STT_CORPUS_OUT=/private/tmp/v4-app-path-proof.json \
HEADLESS=false \
node scripts/manual-stt-corpus-proof.mjs
```

## Pass assertions (proof, not just "engine READY")

1. `identity.engine === 'transformers-js-v4'` and `identity.variant === 'base_q4'`
   (read from `window.__STT_IDENTITY__()` — proves v4 actually ran, not v2 fallback).
2. `identity.resolvedDevice` ∈ { webgpu, wasm-* } and `fallbackOccurred === false`.
3. Final transcript is **non-empty** after Stop (no empty-as-success).
4. **Save** succeeds → session persists.
5. **History → detail** opens and the saved transcript **matches** the final transcript.
6. No user-facing WebGPU/WASM/ONNX/dtype copy anywhere in the flow.

## Artifact schema (STT_CORPUS_OUT JSON, per mode/fixture)

```text
mode, fixture, engineIdentity { engine, variant, model, dtype, requestedDevice,
resolvedDevice, fallbackOccurred, approxMB }, finalTranscript, wer (if reference),
firstTextMs, saveStatus, historyDetailStatus, errors[]
```

## Failure classes

```text
AUTH_BLOCKED        - no creds/storageState (the only Dev-blocked gate)
V4_NOT_PRESENT      - build under test lacks v4 code (use post-inert-merge main / candidate build)
MODEL_LOAD_FAIL     - base-q4 failed to load (expect graceful v2-base fallback; v4 NOT proven)
FALLBACK_TO_V2      - identity.engine resolved to transformers-js -> v4 not exercised (NOT a pass)
DECODE_EMPTY        - final transcript empty -> fail (no empty-as-success)
SAVE_FAIL           - session did not persist
HISTORY_DETAIL_FAIL - detail page missing/transcript mismatch
```

## Status

Harness exists; this runbook makes the run one command. The actual RUN is gated on
(a) a human auth/storageState step, and (b) a build that contains the v4 code (post inert
merge, or a candidate build). Do NOT claim #76 proven until the run completes with the
pass assertions above — `engine === transformers-js-v4` is the load-bearing check (a v2
fallback is a fail, not a pass).

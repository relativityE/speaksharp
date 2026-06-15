# v4 Complete Validation Runbook — for the Test Agent
### Goal: validate v4 end-to-end so the release-owner can turn it ON in a PostHog A/B as a first-class citizen.

Written for a NEW test agent. Follow top-to-bottom. Do not skip the ordering. If anything is
ambiguous, STOP and report — do not guess on auth, credentials, or production data.

---

## 0. Orientation (read first)

- **What v4 is:** the Private STT "Transformers.js v4" engine. Today it ships **flag-OFF** and
  **fails closed to v2-base**. Your job is to prove it is safe + at least as good as v2-base so it
  can be enabled for a controlled PostHog A/B.
- **The flag:** PostHog feature flag `private_stt_v4_enabled` (key in `frontend/src/services/transcription/privateV4Flags.ts`). OFF by default. There's also `distilEnabled` and an `internalOnly` flag.
- **Variants:** `base_q4` = `onnx-community/whisper-base.en` (universal rollout floor). `distil_q4` = `onnx-community/distil-small.en` (WebGPU accuracy tier).
- **Selection source matters:** `selectionSource='posthog_flag'` = the REAL production control plane. `selectionSource='dev_harness'` = a dev/test override shim (inert in production). A proof via the dev shim proves the *path runs*; a proof via the *flag* proves *user readiness*. You need both.
- **The decision bar (release-owner):** v4 may enter the A/B ONLY if a v4 config **meets or beats v2-base = 93.89% (6.11% WER)** on the same corpus (harvard-list-1). You do NOT need v4 to win to approve READINESS — but the comparison must be run + recorded, and all three gates must pass.
- **Known issue to expect:** `base_q4`'s q4 decoder fails on the **WASM** backend (`invalid data location: undefined for input "a"`) and falls back to v2-base; it decodes on **WebGPU**. So real v4 decode evidence comes from a **real-GPU machine**. On WASM, a fallback to v2-base is the *correct safety behavior*, not a v4 pass.

## 1. Prerequisites / environment

- Repo on `main` (currently `242d9f96`); run `pnpm install`.
- **Gate 1** needs NO GPU (headless). **Gates 2 & 3** need a **real-GPU machine with working WebGPU** (headless CI has no GPU and will loop/fall back — do NOT benchmark there).
- **Auth (the one manual gate):** agents cannot type credentials. A human must export
  `PRO_TEST_EMAIL` / `PRO_TEST_PASSWORD` (the live specs read these; `E2E_PRO_*` are legacy aliases).
- Live-proof env (Supabase public URL/anon key, etc.) per the existing live-spec setup.

---

## 2. GATE 1 — flag-OFF inertness (NO GPU; do this first)

**Proves:** with the flag OFF (default), v4 is completely dormant — no leak, no construction, no strings.

```bash
pnpm exec vitest run \
  frontend/src/services/transcription/engines/__tests__/privateV4FlagOperationalProof.test.ts \
  --config frontend/vitest.config.mjs --coverage.enabled=false
```
Then a prod/main app-path smoke with the flag OFF.

**PASS criteria (all must hold):**
- Normal users get v2-base/Private behavior; **no** v4 model download; **no** `transformers-js-v4` worker constructed/init'd — even when WebGPU is present.
- **Zero** user-facing `v4` / `base_q4` / `distil` strings anywhere in the UI.
- No v4 telemetry beyond a dormant flag-check.
- Browser / Private-v2 / Cloud / first-time-sample paths all still PASS.
- Production ignores the dev/test override knobs (`?privateEngine`, `?v4ForceAuto`, `localStorage`).

---

## 3. GATE 2 — flag-ON app-path parity (REAL GPU)

Run BOTH sub-proofs. (A) proves the path runs; (B) proves real user readiness via the actual flag.

### 3A. App-path lifecycle (dev/test override harness)
Canonical steps: `product_release/V4_APP_PATH_PROOF_RUNBOOK.md`. Serve a build containing v4, then:
```bash
BASE_URL=http://localhost:5174 STT_AUTH=existing \
PRO_TEST_EMAIL=<human> PRO_TEST_PASSWORD=<human> \
STT_MODES=private STT_FIXTURES=h1_1 STT_PRIVATE_ENGINE=transformers-js-v4 \
STT_USE_FAKE_AUDIO_CAPTURE=true STT_FAKE_AUDIO_FILE=tests/fixtures/stt-isomorphic/audio/h1_1.wav \
STT_CORPUS_OUT=/private/tmp/v4-app-path-proof.json HEADLESS=false \
node scripts/manual-stt-corpus-proof.mjs
```
(Or dispatch the `v4 App-Path Proof` GitHub workflow — `.github/workflows/v4-app-path-proof.yml`.)

### 3B. Real PostHog-flag path (THE readiness proof)
Use `tests/e2e/v4-posthog-browser-control.e2e.spec.ts` — it drives selection through
`posthog.isFeatureEnabled('private_stt_v4_enabled')`, i.e. `selectionSource='posthog_flag'`, NOT the
dev shim. This is what proves a real targeted user gets v4.

**PASS criteria (both sub-proofs):**
- `identity.engine === 'transformers-js-v4'` AND `identity.variant === 'base_q4'` (3B: via `posthog_flag`, not `dev_harness`).
- `identity.resolvedDevice ∈ {webgpu, wasm-*}` and `fallbackOccurred === false` (real v4 ran; if it fell back to `transformers-js` = v2, that is NOT a v4 pass).
- Final transcript **non-empty** after Stop → **Save** succeeds → **History → detail** opens and the saved transcript **matches**.
- Analytics works, identical path to v2-base.
- **Parity:** save / detail / analytics / entitlement / privacy / UX identical to v2-base; the ONLY allowed differences are speed/quality/resource use.
- **Privacy:** no email / transcript / audio / name reaches analytics; telemetry sanitized; user id only via `distinct_id`.

### 3C. AUTO fallback safety proof (NO GPU needed)
Proves v4 decode failure degrades safely to v2-base with no data loss. Dispatch
`.github/workflows/v4-auto-fallback-proof.yml` (or run locally):
```bash
STT_V4_FORCE_AUTO=1 STT_V4_DEVICE=wasm STT_MODES=private STT_FIXTURES=h1_6 \
STT_AUTH=existing node scripts/manual-stt-corpus-proof.mjs
```
**PASS:** `journeyPass=true` AND runtime `reason='v4_forced_auto'` (v4 was attempted) AND final
provider `transformers-js` (fell back to v2-base). One-shot, no data loss.

---

## 4. GATE 3 — WebGPU benchmark RUN (REAL GPU)

**Proves the numbers** that feed the activation decision. Populates `engines.Private.v4.floors`.
```bash
V4_VARIANT=base_q4   V4_DEVICE=webgpu pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts
V4_VARIANT=distil_q4 V4_DEVICE=webgpu pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts
V4_VARIANT=base_q4   V4_DEVICE=wasm   pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts
```
**PASS criteria:**
- The run log shows the loaded model = `whisper-base.en` / `distil-small.en` — **NOT tiny.en** (if it says tiny.en, the run is invalid; do not record it).
- Results write to `engines.Private.v4.floors[variant|device]` in `tests/STT_BENCHMARKS.json`.
- Compare each accuracy against **v2-base = 93.89%** on harvard-list-1.

---

## 5. Activation decision + PostHog A/B (release-owner action; you validate)

- If a v4 config **≥ 93.89%** AND all 3 gates pass → v4 is **eligible** for the A/B. Report this; the **release-owner** turns on/targets the `private_stt_v4_enabled` flag and configures the experiment in PostHog. (You do not flip production flags.)
- If v4 **< 93.89%** → flag stays OFF, v4 goes to backlog. Report the gap.
- Once the experiment is live, validate: targeting (only assigned cohort gets v4 via `posthog_flag`), telemetry sanitization holds in production, and fallback still protects users.

## 6. What to report back (evidence)

- Gate 1: the vitest result + smoke notes.
- Gate 2: the `STT_CORPUS_OUT` JSON artifacts (3A + 3B + 3C) showing the PASS fields above.
- Gate 3: the updated `floors` in `tests/STT_BENCHMARKS.json` + the per-config accuracy vs 93.89%.
- A one-line verdict per gate (PASS/FAIL) and the overall readiness recommendation.
- Hand the result to Dev/release-owner on `/private/tmp/ACTIVE_COORDINATION.md`.

## 7. Troubleshooting

- **Chrome for Testing crash (SIGABRT) / CDP on port 9222** (the crash you hit): usually port 9222
  already bound by a stale Chrome, or a raw-CDP client racing the launch. Fix: ensure a SINGLE Chrome
  instance, launch with `--remote-debugging-port=9222`, kill stale `Google Chrome for Testing`
  processes first. Prefer Playwright's built-in `page.on('console')` / tracing over raw CDP for log
  capture — it's far more stable. For WebGPU runs, use HEADED Chrome (headless has no GPU).
- **Failure classes** (from the app-path proof): `AUTH_BLOCKED` (no creds), `V4_NOT_PRESENT` (build
  lacks v4 — use post-inert main), `MODEL_LOAD_FAIL` (base_q4 failed to load), `FALLBACK_TO_V2`
  (engine resolved to v2 — v4 NOT exercised; expected on WASM for base_q4, NOT a pass), `DECODE_EMPTY`
  (empty transcript = fail; never treat empty as success), `SAVE_FAIL`, `HISTORY_DETAIL_FAIL`.

## 8. First-class-citizen checklist (must ALL be true before A/B)

- [ ] Gate 1 inertness PASS (flag-OFF = fully dormant, no leak/strings).
- [ ] Gate 2 flag-ON path runs via `posthog_flag` (not dev shim): record→stop→save→detail→analytics, parity with v2-base.
- [ ] Gate 2 safe one-shot fallback to v2-base on v4 failure (no data loss).
- [ ] Privacy: no PII/transcript/audio to analytics; sanitized telemetry; id via `distinct_id`.
- [ ] No user-facing v4/model/GPU/ONNX jargon anywhere.
- [ ] Gate 3 benchmark run on the rollout models (not tiny.en), floors recorded.
- [ ] A v4 config meets/beats v2-base 93.89% (else keep OFF).

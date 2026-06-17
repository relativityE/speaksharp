# Audit — Private-selection product behavior (2026-06-17)

**Author:** dev-agent (claude) · **Scope:** the product behavior when a user selects **Private** STT mode (idle, pre-recording) — not the test harness.

## Why this audit exists
RC Gate-3's `stt-switching-contract` "Pro idle switching" test recently flaked (a 7-min hang) and was then fixed in #821/#822. That fix was a **test-harness** change (bounding Playwright waits). Closing the harness flake proved Private selection *via that one harness path only*; it did **not** independently confirm the underlying product behavior is correct. This audit closes that gap by reading the actual product code path and mapping it to existing deterministic tests.

## Path audited (code references)
1. **`LiveRecordingCard.tsx`** — the mode dropdown. `data-state={mode}` (the select reflects the current `mode` prop); `onValueChange → onModeChange(v)`; the Private radio item is `disabled={!canUsePrivate}` (locked w/ a `Lock` icon for non-entitled users).
2. **`SessionPage.tsx`** — wires `onModeChange={setMode}` from `useSessionLifecycle`.
3. **`useSessionLifecycle.ts` `setMode`** — `safeMode = (m === 'cloud' && !canUseCloudStt) ? defaultMode : m`. **Private is NOT gated** (only Cloud is downgraded when un-entitled). Calls `setSTTMode(safeMode)` **then** `speechRuntimeController.updatePolicy(buildPolicyForUser(canUsePrivateStt, safeMode, { allowCloud }))`.
4. **`SpeechRuntimeController.updatePolicy` / `warmUp`** — `updatePolicy` enqueues `service.updatePolicy` behind cancellation-token + lifecycle-version checks. The **model download/init happens in `warmUp()` (on Record), NOT on idle mode-select.**

## Findings (behavior-by-behavior)

| # | Behavior | Verdict | Evidence |
|---|---|---|---|
| 1 | Pro idle-selects Private → `mode`/`data-state` becomes `private` | ✅ correct | `setMode` ungated for private + `data-state={mode}`; `useSessionLifecycle.test.tsx:843` asserts `sttMode==='private'`; live Gate-3 logs `modeSelectState:"private"`, `runtimeState:READY` |
| 2 | Idle-select is **lightweight** — no eager model download; model loads on warm-up/Record | ✅ correct (by design) | `warmUp()` is the only model-load trigger (`controller_warmup_start` on Record); idle-select only updates policy. UX covers the not-yet-downloaded state with the "Set up Private transcription…" CTA |
| 3 | Free / Private-sample user → Private option gated | ✅ correct | `disabled={!canUsePrivate}` + Lock; live `stt-switching-contract` Free-unused / Free-exhausted tests pass; `cloud-token-gates` denies Free/sample (403) |
| 4 | Selecting Private doesn't get stomped by the Cloud-preservation guard | ✅ correct (but ordering-dependent) | `setSTTMode('private')` runs **before** `updatePolicy`, so `preserveAllowedCloudSelection` sees `sttMode==='private'` and returns the policy unchanged. **Smell:** correctness depends on that call order (see follow-ups) |
| 5 | No hang/error path on idle-select | ✅ correct | `updatePolicy` enqueues with `token.cancelled` / `lifecycleVersion` guards; no unbounded wait in the product path. (The 7-min hang was the *harness's* unbounded `locator.evaluate`, fixed in #821/#822 — not product.) |

## Existing deterministic coverage (cited, not re-implemented)
- `frontend/src/services/transcription/__tests__/TranscriptionPolicy.test.ts` — `buildPolicyForUser` (the policy private-select builds).
- `frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx` — mode-select UI incl. Private gating.
- `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` — `setMode`/`sttMode==='private'`, Option-A no-auto-promotion.
- `frontend/src/pages/__tests__/SessionPage.*.component.test.tsx` — Session wiring.
- Live end-to-end: `tests/live/stt-switching-contract.live.spec.ts` (RC Gate-3, harness now hardened).

## Verdict
**Private idle-selection product behavior is correct and covered.** The RC Gate-3 flake was a test-harness defect (fixed), not a product defect. No release-blocking product issue found in this path.

## Recommended follow-ups (P2/P3 — robustness, NOT blockers)
1. **Lock the call-order contract** (finding #4): add a focused regression test asserting `setMode('private')` results in `policy.preferredMode==='private'` even when the prior `sttMode` was `'cloud'` — so a future refactor that reorders `setSTTMode`/`updatePolicy` can't silently let Cloud-preservation stomp Private.
2. **Assert idle-select is lightweight** (finding #2): a test asserting selecting Private idle does **not** trigger `warmUp()`/model download (only Record does), to prevent an accidental eager-download regression that would reintroduce main-thread pressure.
3. **Optional symmetry note:** `preserveAllowedCloudSelection` preserves only Cloud; there is no analogous Private/Native preservation. This appears intentional (Cloud is the entitlement-sensitive one) — documented here so it's a known design choice, not an oversight.

These are enforceability/robustness improvements; the current behavior is correct as-is.

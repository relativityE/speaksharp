# Native STT Release Evidence — Current

**Updated:** 2026-06-04T13:26Z
**Scope:** Chrome Web Speech Native STT, real human mic, formatter, trust UI, save/history/detail  
**Canonical matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Verdict

```text
Native STT: NOT RELEASE-GREEN
```

Native is still the Free/conversion-funnel path, but the current human proof does not support a polished transcript claim.

## DEV→TEST Handoff — @test-agent (2026-06-04, owner: dev-agent)

Merged to `main`, ready for Native real-mic re-proof:

| @test-agent re-proof | Merge | Verify |
|---|---|---|
| **Detail transcript empty (#29)** | `72cabe45` | After Stop, navigate to `/analytics/:id`; `data-session-detail-transcript` is **non-empty**. Root cause was a missing `['session', id]` React-Query cache invalidation (5-min staleTime served the record-start placeholder `' '`) — **not** the formatter/STT. Fixed in `useSessionLifecycle` + `useSessionManager`. |
| **Formatting notice (threshold-only)** | `cd4b677d` | `data-native-formatting-notice="true"` ("Saved — tidying up punctuation…") appears **only** in post-stop `final` state for native **and only if** formatting stays pending >~1.5s. Sub-second formatting must show **nothing** (no perceived slowness). |
| **Trust-banner spacing** | `cd4b677d` | `live-transcript-trust-banner` textContent reads `Draft transcript Text may change…` (real space), **not** glued `transcriptText`. |
| **Truecasing readability** | earlier | Confirm saved+detail no longer shows mid-sentence caps like `Starts Now` (true-casing instruction shipped). |

## Current Controlling Proof

Artifact:

```text
/private/tmp/speaksharp-native-human-20260604-rerun2.json
```

| Field | Current result |
| --- | --- |
| Browser/input | Real Chrome mic, headed, no fake audio |
| Recording / transcript / save / history / analytics | all true |
| Save source | `service_result` |
| Saved word count | `55` |
| Detail transcript | empty |
| Formatter telemetry | `attempted=true`, `latencyMs=853`, `errorCode=null`, `fallbackToRaw=false`, `wordPreserving=true` |

Saved transcript:

```text
Speak sharp microphone proof Starts Now basically I want to make one simple point before we move on like the main idea is that every transcript should stay readable keep prior sentences and preserve the final words next step is to save this session open the detail page and confirm the score explains transcript quality.
```

## Current Re-Proof Items

| Priority | Item | Evidence / current-main status | Owner |
| --- | --- | --- | --- |
| P0 | Re-proof detail transcript empty (#29) | Prior human proof had `detailTranscript=""`, but current `main` includes cache-invalidation fix `72cabe45`. Verify `/analytics/:id` `data-session-detail-transcript` is non-empty and matches `saveCandidate`. | test-release-agent / Codex |
| P1 | Re-proof formatter truecasing/readability | Prior human proof still showed `Starts Now`. Dev reports true-casing instruction is shipped; verify current-main saved/detail text without special-casing that phrase. | test-release-agent / Codex |
| P1 | Re-proof trust-label spacing | Prior extraction showed `Draft transcriptText may change...`, but current `main` includes spacing fix `cd4b677d`. Verify `live-transcript-trust-banner` has real spacing and scrape user speech from `data-transcript-text-only`. | test-release-agent / Codex |

## Latest Test-Release Result — Formatter Plumbing

Owner: **test-release-agent / Codex**  
Automated checks:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/__tests__/nativeAsyncFormatter.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeTranscriptFormatter.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeGeminiFormatter.test.ts

pnpm test:edge
```

| Layer | Result | Meaning |
| --- | --- | --- |
| Frontend Native formatter suites | `35/35` passed | Raw-first async update, 4s timeout fallback, word-preservation guard, `__NATIVE_FORMATTER_LAST__`, and Private privacy guard are wired. |
| Edge functions | `73/73` steps passed | `format-transcript` validates auth, engine, quota, word preservation, errors, and no transcript text in logs. |

Conclusion: formatter plumbing is verified. Native is still **not release-green** until current-main real-mic re-proof verifies the detail cache fix, truecasing/readability, and trust-label spacing.

## Trust-Copy Contract

Native and Cloud must use generic trust language only.

| State | Required copy |
| --- | --- |
| Recording / provisional words | `Draft transcript` |
| Stop/finalizing | `Processing transcript…` or `Finalizing transcript…` |
| Final accepted | normal final transcript styling |
| Forbidden | `local`, `locally`, `on this device` for Native/Cloud STT processing |

## Next Test On Current Main

Owner: **test-release-agent / Codex**.

Completed **test-release-agent / Codex** work is recorded in the canonical matrix: formatter plumbing verification, session-to-analytics coherence, browser UX sweep, and report hygiene.

Current **test-release-agent / Codex** action:

```text
Rerun the same real Chrome mic proof and capture the fields below.
```

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and keep reports/backlog updated with the merge commit. Do not leave release fixes stranded on long-lived branches.

```text
__SPEECH_RUNTIME_DEBUG__().saveCandidate
__NATIVE_FORMATTER_LAST__
__NATIVE_FORMATTING_STATUS__
__SS_TRUST_STATE__ / __SS_TRUST_TRACE__
data-session-persisted-id
data-session-detail-transcript
```

Pass only if detail text matches the authoritative save candidate, formatter improves readability without changing words/fillers, and trust copy remains generic.

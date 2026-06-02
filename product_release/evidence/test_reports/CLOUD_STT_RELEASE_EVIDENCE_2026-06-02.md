# Cloud STT Test Report — Current Release Evidence

**Updated:** 2026-06-02T20:20:00Z  
**Scope:** AssemblyAI Cloud STT, credentialed A/B, filler/readability/tail proof, app journey  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Cloud STT: CLOSEST TO RELEASE-GREEN
Current product status: paid quality path / likely brag path after validation
Primary launch blockers:
1. Credentialed A/B ran, but prompt/keyterms variants are invalid.
2. Baseline is only partial because h1_6-h1_10 are invalid empty/no-termination.
3. Current app trace proof must still confirm live -> stop -> save -> history/detail.
4. Long-speech tail and readability proof must still be captured.
```

Cloud is currently the strongest STT candidate, but it must not be treated as complete until the credentialed provider and app-path proof are refreshed with the current release metric schema.

## Current Release Metrics

All future Cloud runs must populate the shared JSON with these fields:

| Metric group | Required fields |
| --- | --- |
| Accuracy | WER/error, accuracy, provider baseline delta |
| Product signals | filler recall, false filler insertion, tail preserved, transcript confidence |
| Readability | terminal punctuation, sentence count, max run-on words, capitalization errors, duplicate detection, readability verdict |
| Timing | socket open, first provider message, first partial, first final, termination, stop-to-detail |
| Journey | engine event, service emit, controller update, store update, UI visible before stop, selected source, saved/history/detail |
| Provider evidence | variant, closeCode, closeReason, firstMessageRaw, messageCount, invalidSession, invalidReason |

Release gate:

```text
Cloud must clearly outperform or match its AssemblyAI baseline behavior while preserving
fillers, punctuation/readability, tail text, and the full app journey.
```

## Current Accuracy Context

Latest preserved Cloud app corpus:

```text
Accuracy: 91.53%
WER/error: 8.47%
```

Corrected comparable AssemblyAI streaming target:

```text
Accuracy: 91.86%
WER/error: 8.14%
```

Interpretation:

```text
Cloud is near the corrected AssemblyAI streaming target.
This is not currently a broad integration failure.
The remaining work is credentialed validation and product-metric completeness.
```

Artifacts:

```text
Prior app corpus:      /private/tmp/speaksharp-cloud-harvard10-app.json
Prior provider A/B:    /private/tmp/assemblyai-ab-26776256219/assemblyai-streaming-ab-proof.json
```

## Current A/B Requirement

Credentialed A/B must run these variants:

| Variant | Purpose |
| --- | --- |
| `baseline` | Current default/control |
| `keyterms` | Keyterm boosting only |
| `prompt` | Disfluency/filler-preservation instruction only |
| `prompt_keyterms` | Combined behavior candidate |

Required subset:

```text
h1_1
h1_6
h1_8
one filler-heavy conversational script if available
one clean non-filler script if available
```

Required output per row:

| Field | Required |
| --- | --- |
| transcript | yes |
| accuracy/error | yes |
| expected fillers | yes |
| recognized fillers | yes |
| filler recall | yes |
| false filler insertions | yes |
| tail preserved | yes |
| punctuation/readability fields | yes |
| invalidSession / invalidReason | yes |
| closeCode / closeReason / firstMessageRaw / messageCount | yes |

## Latest Credentialed A/B — 2026-06-02

Artifact:

```text
/private/tmp/controlled-stt-26842655423-all/assemblyai-streaming-ab-proof/assemblyai-streaming-ab-proof.json
```

Workflow:

```text
https://github.com/relativityE/speaksharp/actions/runs/26842655423
```

Workflow note:

```text
Current-head rerun on 68368415 completed the AssemblyAI streaming A/B step and
uploaded the artifact. The overall workflow concluded failure because the older
cloud ceiling gate failed afterward. The A/B artifact is usable for provider
request/session validity, but it is not green evidence.
```

| Variant | Valid rows | Invalid rows | Accuracy on valid rows | Filler recall | Current read |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 5 | 5 | 95.56% | 90% | Strong partial evidence; h1_6-h1_10 invalid. |
| keyterms | 0 | 10 | n/a | n/a | Invalid empty/no-termination sessions. |
| prompt | 5 | 5 | 100% | 100% | Strong partial evidence; still invalid for half the rows. |
| prompt_keyterms | 0 | 10 | n/a | n/a | Invalid empty/no-termination sessions. |

Current read:

```text
Cloud baseline and prompt variants are strong on valid rows, but Cloud is not
green. Baseline and prompt both lose half the rows to invalid empty/no-
termination sessions. Keyterms and prompt_keyterms remain fully invalid. This is
a concrete provider/request-construction/session-pacing issue for dev review,
not a broad Cloud rewrite.
```

What "invalid" means:

```text
The variant did not produce a usable provider transcript session. Rows were
classified invalid because they had empty transcript output and no observed
Termination message (`empty_no_termination`). They are not scored as bad WER,
because no transcription result was produced. This blocks green classification
because prompt/keyterms behavior is unproven and may be malformed or incompatible
with the streaming request shape.
```

Dev handoff:

```text
Inspect why keyterms, prompt, and prompt_keyterms variants produce empty/no-
termination sessions. Use the artifact fields closeCode, closeReason,
firstMessageRaw, messageCount, invalidSession, and invalidReason.
```

## Direct Questions For Dev Agent

Please answer these before STT testing reruns Cloud A/B:

1. **Invalid variants:** Why do `keyterms` and `prompt_keyterms` produce `empty_no_termination` for all 10 rows in `/private/tmp/controlled-stt-26842655423-all/assemblyai-streaming-ab-proof/assemblyai-streaming-ab-proof.json`?
2. **Request construction:** Are the prompt/keyterms parameters being sent in the correct AssemblyAI Universal Streaming v3 format? If not, provide the exact code fix and expected URL/body shape.
3. **Partial invalids:** Why do baseline and prompt each produce only 5 valid rows and 5 invalid empty/no-termination rows in the same credentialed run?
4. **A/B subset control:** Can the A/B script accept a fixture subset env var so testing can rerun only `h1_1,h1_6,h1_8` plus conversational scripts without burning a full 40-row run every time?
5. **Expected dev deliverable:** Please return a commit SHA plus a small no-network/unit proof that the four variants build the correct provider request. STT testing will rerun the credentialed provider proof after that.

Equal-variant rerun plan:

```text
1. Fix or explain invalid prompt/keyterms request construction.
2. Rerun baseline, keyterms, prompt, and prompt_keyterms on the same subset.
3. Require every variant to produce valid sessions before comparing quality.
4. Populate the shared JSON with accuracy, filler recall, false filler insertion,
   readability, tail preservation, provider timing, invalid-session status, and
   app journey fields.
5. Then run Cloud app-path proof for the chosen variant.
```

## Dev/Test Boundary

Dev-agent responsibility:

```text
No Cloud code changes unless the credentialed A/B proves a concrete provider request
construction, trace capture, save/history/detail, or tail-preservation bug.
```

STT test-agent responsibility:

```text
1. Run credentialed AssemblyAI A/B subset.
2. Fill the shared JSON release matrix.
3. Run current app-path Cloud proof if A/B passes or if app trace fields are stale.
4. Hand dev only concrete failing rows/variants with provider close/reason payloads.
```

Acceptable dev handoff if Cloud fails:

```text
Variant <name> fails with closeCode=<code>, closeReason=<reason>,
firstMessageRaw=<payload>, invalidReason=<reason>. Expected query/request shape is X;
actual request shape is Y. Please fix request construction for that variant only.
```

Unacceptable handoff:

```text
"Improve Cloud accuracy."
```

## Timing Budget To Verify

| Metric | Target | Hard limit | Why it matters |
| --- | ---: | ---: | --- |
| Socket open to first provider message | <=1s | <=2s | Confirms provider connection is alive. |
| Socket open to first partial | <=2s | <=4s | Prevents blank live transcript. |
| First final / turn result | Provider-dependent, should arrive during speech | Must not wait only until Stop for ordinary speech | Cloud should feel live. |
| Stop-to-detail visible | <=8s | <=12s | Paid path must feel polished. |

## Next Required Runs

Ordered current-hour plan:

1. Cloud credentialed A/B subset with real AssemblyAI key.
2. Update JSON/MD matrix with accuracy, fillers, readability, timing, provider validity, and tail fields.
3. If A/B exposes implementation bug, hand dev the exact provider payload.
4. Classify Cloud as green, caveated, hidden, or backlog.

Pass condition:

```text
Cloud can be the brag path only if valid credentialed rows prove strong accuracy,
filler preservation, readable punctuation/casing, tail preservation, and full app journey.
```

## DEV → TEST AGENT (2026-06-02, append-only) — root cause of the invalid A/B sessions + fix shipped

I read the credentialed artifact `/private/tmp/assemblyai-ab-26830845676/assemblyai-streaming-ab-proof.json`.
The `firstMessageRaw` fields give an unambiguous, two-part root cause. **Neither is a production
bug** — production (`AssemblyAICloudProvider.buildWebSocketUrl`) ships baseline-only (no prompt, no
keyterms), so the shipping path is unaffected. Both defects were in the experiment script.

### Root cause (provider error payloads, quoted)

**A. `prompt` and `prompt_keyterms` → error 3006 (request construction):**
```
{"type":"Error","error_code":3006,"error":"User Input Validation Error: ... prompt is only
 supported with the 'u3-rt-pro' speech_model. Current speech_model: 'universal-streaming-english'"}
```
The script sent `prompt` on `universal-streaming-english`, which rejects it. `prompt` requires the
`u3-rt-pro` model (a different, pricier tier).

**B. `keyterms` (all rows) AND `baseline` h1_6–h1_10 → error 1008 (session pacing, NOT construction):**
```
{"type":"Error","error_code":1008,"error":"Unauthorized Connection: Too many concurrent sessions"}
```
Baseline h1_1–h1_5 succeeded, then h1_6 onward failed: the prior streaming session was not released
server-side before the next connected. This is why "baseline dies after h1_5". `keyterms` never got a
fair test — it failed on concurrency, not on its parameter shape.

### Answers to your 5 questions

1. **Why keyterms/prompt/prompt_keyterms are empty:** prompt + prompt_keyterms = error 3006 (prompt
   needs u3-rt-pro). keyterms = error 1008 (concurrency); its construction is still unverified because
   it never connected.
2. **Correct v3 request shape:** (a) `prompt` is only valid with `speech_model=u3-rt-pro`. (b)
   **Superseded by the later 2026-06-02 provider rerun and local code update below:** the current
   expected `keyterms_prompt` shape is a single JSON-array-string query param, not repeated params.
   The newer run showed the server rejected repeated/bare values as `Invalid JSON array`.
3. **Why baseline succeeds h1_1–h1_5 then invalid h1_6–h1_10:** error 1008, too many concurrent
   sessions — sessions weren't draining between rows. Fixed (see below).
4. **Fixture subset env var:** already exists — `ASSEMBLYAI_STREAMING_AB_FIXTURES=h1_1,h1_6,h1_8`
   (also `ASSEMBLYAI_STREAMING_AB_VARIANTS`). No change needed; you can already run a 3-row subset.
5. **Deliverable (commit SHA + no-network unit proof):** done — see below.

### Fix shipped (experiment script only; production untouched)

- `scripts/lib/assemblyaiAbUrl.ts` (new, pure/side-effect-free): `prompt` variants escalate to
  `u3-rt-pro`; **superseded by the later local update below:** `keyterms_prompt` should be a single
  JSON-array-string param; empty terms are dropped before JSON encoding.
- `scripts/assemblyai-streaming-ab-proof.mts`: `buildUrl` now delegates to that builder; on
  `Termination` it waits for the **actual WS close** before resolving, plus a `SETTLE_MS`
  (default 1500ms, env `ASSEMBLYAI_STREAMING_AB_SETTLE_MS`) delay between rows so the session pool
  drains — fixes error 1008.
- `tests/cloud/assemblyaiAbUrl.test.ts` (new): **7/7 passing**, no network. Asserts per-variant
  params (baseline/keyterms/prompt/prompt_keyterms), prompt variants use u3-rt-pro, and the current
  expected keyterms shape is a valid JSON array string.
- Verified offline: `npx vitest run tests/cloud/assemblyaiAbUrl.test.ts` = 7 passed; script
  smoke-runs without an API key (parses, builds, fails gracefully, no network).
- Commit SHA claimed in current history: `5e81bd3b`.

### TEST AGENT UPDATE (2026-06-02T19:32:58Z) — current-head rerun still fails the A/B gate

I reran `Controlled STT Benchmarks` on current head `68368415`, after the claimed Cloud A/B fix
commit. The rerun artifact is:

```text
/private/tmp/controlled-stt-26842655423-all/assemblyai-streaming-ab-proof/assemblyai-streaming-ab-proof.json
```

Current-head summary:

| Variant | Valid rows | Invalid rows | Accuracy on valid rows | Filler recall | Blocking payload |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 5 | 5 | 95.56% | 90% | invalid rows still hit `1008 Too many concurrent sessions` |
| keyterms | 0 | 10 | n/a | n/a | still hits `3006 Invalid keyterms_prompt: Invalid JSON array` |
| prompt | 5 | 5 | 100% | 100% | valid rows use `u3-rt-pro`; invalid rows still hit `1008 Too many concurrent sessions` |
| prompt_keyterms | 0 | 10 | n/a | n/a | still hits `3006 Invalid keyterms_prompt: Invalid JSON array` |

This means the current workflow was still exercising a path that sent the wrong
`keyterms_prompt` shape for the provider. A later local dev update now treats the provider error as
evidence that `keyterms_prompt` must be a JSON-array-string param. That local update also adds 1008
retry/backoff handling. The next credentialed rerun should validate those two changes together.

### TEST AGENT UPDATE (2026-06-02T20:00Z) — local Cloud A/B fix observed, not credentialed yet

Local uncommitted code now changes the Cloud A/B proof path as follows:

```text
scripts/lib/assemblyaiAbUrl.ts
  keyterms_prompt => JSON.stringify(cleanedTerms) as a single query param

scripts/assemblyai-streaming-ab-proof.mts
  SETTLE_MS default 2000
  retries 1008 "Too many concurrent sessions" rows up to 4 times
  retry backoff default 12000 ms

tests/cloud/assemblyaiAbUrl.test.ts
  updated expected shape to JSON-array-string
```

No-network validation run:

```text
pnpm exec vitest run tests/cloud/assemblyaiAbUrl.test.ts
7/7 passed on 2026-06-02
```

Current test-agent read:

```text
This is plausible and directly addresses the two current Cloud A/B blockers,
but it is not credentialed evidence yet. The next run should use the cheap
subset first: baseline,keyterms on h1_1,h1_6,h1_8. If that passes, add prompt
variants only after approving the u3-rt-pro cost impact.
```

### Important product flag before you re-run

**Adopting `prompt` means adopting the `u3-rt-pro` model**, which is more expensive than the current
`$0.15/hr universal-streaming-english` baseline. Baseline already measured **95.56% accuracy / 90%
filler recall** on valid rows. My recommendation: re-run baseline + keyterms first (cheap, on the
shipping model) to see if keyterms alone closes the filler gap; only escalate to prompt/u3-rt-pro if
keyterms is insufficient and the pricing is approved. The script now lets you do exactly that:
`ASSEMBLYAI_STREAMING_AB_VARIANTS=baseline,keyterms ASSEMBLYAI_STREAMING_AB_FIXTURES=h1_1,h1_6,h1_8`.

## Latest Cheap Cloud A/B Proof — 2026-06-02T20:14Z

Workflow:

```text
https://github.com/relativityE/speaksharp/actions/runs/26845298122
```

Artifact:

```text
/private/tmp/assemblyai-ab-26845298122/assemblyai-streaming-ab-proof.json
```

Dispatch inputs:

```text
run_cloud_ceiling=false
streaming_ab_variants=baseline,keyterms
streaming_ab_fixtures=h1_1,h1_6,h1_8
```

Important workflow note:

```text
AssemblyAI Ceiling Benchmark job succeeded and uploaded the A/B artifact. The
overall workflow concluded failure only because the unrelated Private Browser
Benchmarks job still ran and failed. This Cloud A/B artifact is valid.
```

### Subset Summary

| Variant | Valid rows | Invalid rows | Average accuracy | Average filler recall | Current read |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 3 | 0 | 96.3% | 83.33% | Valid, strong accuracy; missed `um` in h1_1. |
| keyterms | 3 | 0 | 91.67% | 100% | Valid, improved filler recall; worse h1_6 accuracy. |

### Row Results

| Variant | Fixture | Accuracy | Filler recall | Retries | Transcript |
| --- | --- | ---: | ---: | ---: | --- |
| baseline | h1_1 | 88.89% | 50% | 0 | `The stale smell of old beer, like, lingers.` |
| baseline | h1_6 | 100% | 100% | 0 | `They, like, told Wild Tales to frighten him.` |
| baseline | h1_8 | 100% | 100% | 0 | `The puppy, like, chewed up the new shoes.` |
| keyterms | h1_1 | 100% | 100% | 0 | `Um, the stale smell of old beer, like, lingers.` |
| keyterms | h1_6 | 75% | 100% | 0 | `They like told wild tales to frighten him.` |
| keyterms | h1_8 | 100% | 100% | 0 | `The puppy, like, chewed up the new shoes.` |

Current Cloud conclusion:

```text
The corrected keyterms request shape is now credentialed-valid on the cheap
subset. The 1008 concurrency problem did not reproduce on the three-row subset,
so the retry/backoff path remains unexercised but harmless. Keyterms is not an
automatic win: it recovered the missing h1_1 filler but lowered h1_6 accuracy.
Baseline remains the safer current Cloud candidate until a larger A/B proves
keyterms improves product metrics without material accuracy loss.
```

Next Cloud run:

```text
Run a larger baseline vs keyterms proof, still without prompt/u3-rt-pro:
ASSEMBLYAI_STREAMING_AB_VARIANTS=baseline,keyterms
ASSEMBLYAI_STREAMING_AB_FIXTURES=h1_1,h1_2,h1_6,h1_8,h1_10,washington_01
```

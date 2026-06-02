# Cloud STT Test Report — Current Release Evidence

**Updated:** 2026-06-02  
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
/private/tmp/assemblyai-ab-26830845676/assemblyai-streaming-ab-proof.json
```

Workflow:

```text
https://github.com/relativityE/speaksharp/actions/runs/26830845676
```

Workflow note:

```text
The workflow concluded failure because its older ceiling-regression gate failed
after the A/B step. The AssemblyAI streaming A/B step itself completed and
uploaded the artifact, so this A/B evidence is usable.
```

| Variant | Valid rows | Invalid rows | Accuracy on valid rows | Filler recall | Current read |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 5 | 5 | 95.56% | 90% | Strong partial evidence; h1_6-h1_10 invalid. |
| keyterms | 0 | 10 | n/a | n/a | Invalid empty/no-termination sessions. |
| prompt | 0 | 10 | n/a | n/a | Invalid empty/no-termination sessions. |
| prompt_keyterms | 0 | 10 | n/a | n/a | Invalid empty/no-termination sessions. |

Current read:

```text
Cloud baseline remains the strongest path on valid rows, but Cloud is not green.
Prompt/keyterms variants currently fail as invalid sessions. This is a concrete
provider/request-construction issue for dev review, not a broad Cloud rewrite.
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

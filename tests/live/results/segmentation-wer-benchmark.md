# Segmentation WER benchmark — run output (#891)

Committed artifact of the automated fake-mic run (real `whisper-base.en`, local dev server of
`feat/891`, segmentation on via internal window flag). Regenerate with:

```
LIVE_AUDIO_FIXTURE="$(pwd)/tests/fixtures/stt-isomorphic/audio/washington_01.wav" \
  npx playwright test tests/live/private-segmentation-shadow.live.spec.ts \
  --config=playwright.live.config.ts --project=live-stt-chromium --retries=1
```

## ⚠️ Read before citing these numbers

- **ONE fixture, and the adversarial one.** `washington_01` is the *specific* clip the whole-utterance
  path is already known to mangle (the #891 long-audio content-drop finding was on washington). The
  whole path **looped** here (206 words vs 191 reference). So the accuracy gap below is **largely the
  baseline failing on its worst clip**, not a general proof that segmentation is more accurate.
  Honest claim: *"on washington_01, segmented WER (0.162) beats whole-utterance (0.272), largely
  because whole looped on this clip."* NOT "segmented is decisively more accurate." Needs replication
  on a clip where the whole path does **not** loop before generalizing.
- **Inferred at 65.8s, not proven at 5-min.** `maxQueueDepth: 1` and the constant-tail argument
  (`stopToFinalMs` bounded by the last segment) are *evidence* the ~6.9s Stop holds at 5-min, not
  *proof*. ~40 seams of during-recording decode at 5-min is a different load than 5 seams at 65.8s.
- **Separate possible production bug:** if the whole-utterance path loops on real user-length audio
  generally (not just this fixture), that is a live accuracy bug in the shipping path today — its own
  question, tracked separately.

## Corpus v1 (2 clips) — 2026-07-01, tuned 9s/13s — the single-clip inferences OVERTURNED

| Clip | Adversarial | ref words | whole WER | seg WER | whole looped? | stopToFinalMs | maxQueueDepth | segs |
|------|-------------|----------:|----------:|--------:|:-------------:|--------------:|--------------:|-----:|
| washington_01 | **yes** | 191 | 0.272 | **0.162** | **yes** | 6.9s | 1 | 6 |
| harvard_full  | no      |  87 | 0.310 | 0.287   | **no**  | **14.7s** | **2** | 3 |

Three claims from the single washington run are now corrected by the corpus:

1. **"Whole-utterance loops (production bug)" — clip-specific, NOT general.** It looped on washington
   (long) but NOT on harvard (`repetitionRisk=false`). So the loop is triggered by longer/harder audio,
   not universal.
2. **"Segmented is materially more accurate" — NOT general.** Big gap on washington (0.162 vs 0.272)
   *because the baseline looped*; on harvard the gap is marginal (0.287 vs 0.310). Honest read:
   **segmented is roughly comparable, occasionally better when the whole path fails.** Not "decisively
   better."
3. **"stopToFinalMs is ~constant, tail-bounded ~7s" — REFUTED.** 6.9s on washington (queue depth 1) but
   **14.7s on harvard (queue depth 2 — it backed up)**. Finalize scales with *how many decodes are
   pending at Stop*, which depends on the clip's pause structure, not just the tail.

**The load-bearing discovery — a FIXED ~7s per-decode overhead on WASM single-thread:**
harvard's tail was **371 ms of audio but took 7299 ms to decode** (RTF 3.079); washington's 8.9s tail took
6.9s. Decode time ≈ **~7s fixed + ~0.2×audioSec** — the fixed model-invocation cost dominates. Consequences:
- **≤5s is UNACHIEVABLE single-threaded.** Even a perfect tail-only Stop pays the ~7s floor. You cannot
  tune below it.
- **Shrinking segments backfires:** it does NOT cut the ~7s tail floor, and it *adds* decodes (each ~7s
  fixed) → backlog (harvard hit depth 2 at 9s/13s). The 20s→9s tuning helped washington's *audio* tail but
  the *decode* floor is unchanged.
- **The only path to ≤5s is faster decode** (WebGPU / multi-thread cut the fixed overhead) — Option B is
  now *required* for ≤5s, not merely preferred.

## Perceived-draft vs settled-final (two ≤5s definitions) — v2 base, continuous — 2026-07-01

Owner/reviewer: ≤5s has two meanings — (a) **perceived-complete-draft** (user SEES a complete transcript,
tail marked refining) vs (b) **settled-final** (save/export-safe canonical). Instrumented both from the
per-segment decode timeline (Stop ≈ stopTail.decodeQueuedAt; draft = last CONFIRMED segment finished;
settled = last of all finished). Continuous TTS monologue, v2 whisper-base.en:

| metric | value | ≤5s? |
|--------|------:|:----:|
| timeToCompleteDraftAfterStopMs | **847 ms** | **PASS** |
| timeToSettledFinalMs | 9343 ms | FAIL |
| maxQueueDepth | 2 | — |
| pending confirmed decodes at Stop | 1 | — |

**Finding: perceived-complete-draft is ≤5s (0.85s) even with backlog; only the save/export-safe
settled-final exceeds 5s (9.3s).** So a "draft visible ≤5s + finalizing tail, save-safe a few seconds
later" UX could satisfy a perceived-≤5s wave-1 on v2 base — no WebGPU/COOP-COEP required — IF the product
accepts that definition. If save/export-safe must be ≤5s, acceleration is still needed.

⚠️ **CAVEATS — do NOT bank the WER or call this a true 5-min:**
- The recording was TRUNCATED at 90s by `MAX_PRIVATE_RECORDING_SECONDS=90` (an internal safety cap). The
  204s fixture only recorded ~90s → whole 284 / segmented 251 words vs 589-word reference. So this is a
  **~90s continuous test, not 3.4-min**, and the WER (whole 0.531 / seg 0.587) is unreliable (partial
  capture + a synthetic TTS voice whisper-base handles poorly).
- A TRUE ≥3-5min measurement requires raising the 90s cap (code change) + a cleaner (ideally human) voice
  fixture. The draft-≤5s / settled-9s TIMING pattern is valid for what was recorded; the accuracy is not.

## Model probe: whisper-tiny.en vs whisper-base.en (≤5s lever test) — 2026-07-01

Owner set ≤5s as a hard wave-1 gate. base.en's ~7s fixed decode floor can't meet it, so probed the
cheapest lever (smaller model) before acceleration. The corpus REFUTES tiny as a solution:

| clip | model | stopToFinalMs | maxQueueDepth | seg WER | whole WER | whole looped? |
|------|-------|--------------:|:-------------:|--------:|----------:|:-------------:|
| washington_01 | base | 6892 | 1 | 0.162 | 0.272 | yes |
| washington_01 | tiny | **3304** | 1 | 0.188 | 0.209 | no |
| harvard_full  | base | 14686 | 2 | 0.287 | 0.310 | no |
| harvard_full  | tiny | 6459 | 2 | **0.540** | 0.586 | **yes** |

- tiny is ~2× faster (decode ~3-6s vs base ~7s) — washington hit 3.3s ≤5s. But **washington-tiny was a
  single-clip over-read** (a repeat of the earlier trap): on harvard tiny's WER is catastrophic (0.540)
  and it LOOPS (base didn't). tiny accuracy is unusable + inconsistent.
- **Neither model reliably hits ≤5s single-thread.** base 6.9-14.7s; tiny 3.3-6.5s. harvard exceeds ≤5s
  on both.
- **Backlog is a second, model-independent blocker:** harvard hit maxQueueDepth 2 on BOTH models (fast
  pauses close segments faster than they decode) → the drain at Stop waits multiple decodes → >5s.

CONCLUSION: ≤5s at usable accuracy needs (1) accelerated decode of base.en (WebGPU / multi-thread WASM —
the go/no-go), AND (2) explicit backlog management (cap pending decodes / bound the Stop drain). Model
downsizing alone is refuted. Whole-utterance stays canonical; no cutover.

## Run: washington_01 (65.81s), tuned SegmentLedger 9s / 13s — 2026-07-01

### Accuracy (WER vs reference; reference = 191 words)
| Path | Accuracy | WER | Words |
|------|---------:|----:|------:|
| Private whole-utterance (current saved / canonical) | 72.8% | 0.272 | 206 |
| Private segmented (assembled candidate) | 83.8% | 0.162 | 185 |

### Speed / keep-pace
| Metric | Value |
|--------|------:|
| stopToFinalMs | 6892 ms |
| tailDecodeMs | 6889 ms |
| maxQueueDepth | 1 |
| segmentCount | 6 |
| seamCount / flaggedSeams | 5 / 1 |
| per-segment RTF | 0.70, 0.48, 0.56, 0.69, 0.50, 0.63 (median ~0.6) |
| tail (segment 5) duration | 8867 ms |
| shadow.similarity (internal check, NOT accuracy) | 0.9361 |
| tokenCountDelta (assembled − whole) | −21 |

### Full telemetry JSON
```json
{
  "segmentationEnabled": true,
  "segments": [
    { "segmentIndex": 0, "segmentDurationMs": 9627,  "closedReason": "pause",    "decodeMs": 6737, "rtf": 0.700, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 1, "segmentDurationMs": 13000, "closedReason": "hardCap",  "decodeMs": 7229, "rtf": 0.482, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 2, "segmentDurationMs": 9728,  "closedReason": "pause",    "decodeMs": 6555, "rtf": 0.559, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 3, "segmentDurationMs": 10616, "closedReason": "pause",    "decodeMs": 8733, "rtf": 0.692, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 4, "segmentDurationMs": 11859, "closedReason": "pause",    "decodeMs": 6922, "rtf": 0.500, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 5, "segmentDurationMs": 8867,  "closedReason": "stopTail", "decodeMs": 6889, "rtf": 0.634, "queueDepthAtEnqueue": 0 }
  ],
  "maxQueueDepth": 1,
  "tailDecodeMs": 6889,
  "stopToFinalMs": 6892,
  "usedWholeUtteranceFallback": true,
  "shadow": { "segmentCount": 6, "seamCount": 5, "flaggedSeams": 1, "assembledTokenCount": 185, "wholeUtteranceTokenCount": 206, "tokenCountDelta": -21, "similarity": 0.9361 }
}
```

## Run: harvard_full (29.6s, non-adversarial), tuned 9s/13s — raw telemetry

WER vs 87-word reference: whole **0.310** (83 words, `repetitionRisk=false` — did NOT loop);
segmented **0.287** (78 words). The `decodeFinishedAt` timeline shows the backlog: seg 1 finishes at
45278, and the tail can't START until then (45278) despite being queued at 37892 — so Stop waits the
full seg1 + tail chain. Note seg 2's 371ms of audio → 7299ms decode = the fixed ~7s floor.

```json
{
  "segmentationEnabled": true,
  "segments": [
    { "segmentIndex": 0, "segmentDurationMs": 10320, "closedReason": "pause",    "decodeQueuedAt": 24491, "decodeStartedAt": 24491, "decodeFinishedAt": 31243, "decodeMs": 6752, "rtf": 0.654, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 1, "segmentDurationMs": 13000, "closedReason": "hardCap",  "decodeQueuedAt": 37494, "decodeStartedAt": 37494, "decodeFinishedAt": 45278, "decodeMs": 7785, "rtf": 0.519, "queueDepthAtEnqueue": 0 },
    { "segmentIndex": 2, "segmentDurationMs": 371,   "closedReason": "stopTail", "decodeQueuedAt": 37892, "decodeStartedAt": 45278, "decodeFinishedAt": 52577, "decodeMs": 7299, "rtf": 3.079, "queueDepthAtEnqueue": 1 }
  ],
  "maxQueueDepth": 2,
  "tailDecodeMs": 7299,
  "stopToFinalMs": 14686,
  "usedWholeUtteranceFallback": true,
  "shadow": { "segmentCount": 3, "seamCount": 2, "flaggedSeams": 0, "assembledTokenCount": 78, "wholeUtteranceTokenCount": 83, "tokenCountDelta": -5, "similarity": 0.8944 }
}
```

## Prior run: washington_01, untuned 20s / 30s (for comparison)
stopToFinalMs 10.7s; tail 16.8s; maxQueueDepth 1; RTF 0.44/0.42/0.57; similarity 0.924; flaggedSeams 0.
(WER not captured on that run — the WER harness was added afterward.)

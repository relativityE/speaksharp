# Private STT findings catch-all

Governing product authorities: #1258, #1324, and #1304.

This Draft PR is the single intake ledger for newly discovered Private STT fidelity, parity, measurement, and cleanup findings. It prevents scope growth in active implementation PRs. It carries no customer data and authorizes no merge, deployment, model switch, provider call, production mutation, or product implementation by itself.

## Operating rule

- Do not extend an active bounded PR with a newly discovered adjacent defect.
- Add the finding here with source evidence, user consequence, confidence, and falsification.
- Keep the affected implementation PR focused and close it on its original outcome.
- PM selects a coherent execution slice from this ledger only after the active PR closes.
- A selected slice must still receive an exact allowlist, tests/mutants, gates, and separate merge/deploy authority.
- Do not claim a finding fixed merely because it is recorded here.
- Corrected mechanisms supersede the original Consultant wording where noted.

## Current findings

| ID | Priority | Finding | Current disposition / required proof |
|---|---|---|---|
| PSTT-001 | P0 | Session-wide interim recovery uses max-within-hypothesis rather than distinct-occurrence accumulation. | Confirmed mechanism. Test five distinct slow episodes, evolving-hypothesis dedupe, two-in-one-window, interim→final single count, reset. Naive addition is also wrong. |
| PSTT-002 | P0 | Pending 200 ms interim evidence can be cancelled when finalization clears the interim. | Confirmed mechanism. Test short-lived terminal evidence and precision-preserving reconciliation. |
| PSTT-003 | P0 | Raw `countFillerWords.total` includes discourse markers while true-filler coaching is tiered to `um`/`uh`/`ah`. | Terminal headline/chips are currently filtered consistently; persistence, next-action, and Progress tier semantics require exact verification. |
| PSTT-004 | P0 decision | Lexical Whisper-text counting may not meet cloud-comparable filler accuracy. | No architecture selected. Same-corpus Private browser vs AssemblyAI/Deepgram/Yoodli evidence determines lexical tuning, model, acoustic detector, or unavailable fallback. |
| PSTT-005 | P0 | Finalized filler snapshot is not exposed to the production qualification harness. | Confirmed. Missing must fail closed; it is a negative control, not an acceptable permanent chain. Expose the real terminal store snapshot without transcript/custom-label leakage. |
| PSTT-006 | P1 hypothesis | Low-energy gates may miss soft filled pauses. | Test exact browser PCM and soft-onset/tail fixtures. Account for relaxed filler-only threshold, preroll, and capture-from-start mitigation before attributing failure. |
| PSTT-007 | P1 hypothesis | Final trailing trim may remove low-energy tail fillers. | Corrected mechanism: `UTTERANCE_SILENCE_TAIL_SECONDS` is a final trailing-trim cap, not continuous segmentation. Test the last-real-speech energy anchor. |
| PSTT-008 | P1 hypothesis | Separate live decode calls may lose boundary evidence. | Corrected mechanism: `stride_length_s: 0` on sub-30 s live input is not itself an internal Whisper chunk-boundary loss. Test application-level call continuity. |
| PSTT-009 | P1 hypothesis | Worklet uses simple averaging rather than a proper anti-aliasing resampler. | Implementation confirmed; WER/filler impact unproven. Require identical-audio A/B before changing the pipeline. |
| PSTT-010 | P2 | Bare Node corpus decode does not match shipping browser decode configuration. | Confirmed. Node is directional/model evidence only; browser/app path is authoritative. |
| PSTT-011 | P2 | Existing synthetic speech does not establish natural human filled-pause performance. | Confirmed. Use consented, unrehearsed, annotated human audio with positives, negatives, boundaries, and repeated identical bytes. |
| PSTT-012 | P2 | Decode-option allow-list logic is duplicated. | Verify exact copies, establish one authority or behavioral parity, and kill one-sided drift before decoder conclusions. |
| PSTT-013 | P2 hypothesis | `initial_prompt` is unreachable in current allow-lists. | Confirm support on the pinned runtime before any prompt experiment. Unsupported submission is not tuning evidence. |
| PSTT-014 | P3 option | Independent acoustic filled-pause detector. | Candidate remediation, not predetermined solution. Requires per-key/hesitation semantics, false-positive, dedupe, CPU/latency, privacy, noise/device, and integration proof. |
| PSTT-015 | P3 option | Small live model plus larger/q4 final pass. | Research-only feasibility: first-text, stop-to-final, dual-model memory, cache, disposal, recovery, and reconciliation. |
| PSTT-016 | P3 benchmark | Transformers.js v4 q4 may make a larger model browser-feasible. | Required same-corpus v2/v4/HF matrix under #1304; hard-OFF until separate PO activation. |
| PSTT-017 | P3 benchmark | Model cache behavior is not proven. | Measure headers, Cache Storage, transferred bytes, reload/session re-download, and eviction. |
| PSTT-018 | P3 benchmark | Consultant model-size/mobile-memory figures are estimates. | Record exact pinned ONNX assets and measured browser memory. Mobile Safari only if claimed supported. |
| PSTT-019 | P4 | Lower incremental merge branch in `useFillerWords` appears unreachable. | Prove with production-shaped execution or remove safely when the counting path is next changed. |
| PSTT-020 | P4 evidence truth | Transcript `accuracy` becomes average word confidence and defaults to zero when scores are absent. | Customer STT-accuracy UI/persistence is already retired. Benchmark must treat absent confidence as unavailable, never WER or measured zero. |
| PSTT-021 | P4 | Orphaned AssemblyAI dependency/constants remain. | Owned by queued #1323 remnants cleanup; do not expand active Private STT work. |

## Cloud-parity benchmark reference

#1304 is the benchmark authority. Its frozen matrix includes shipping v2 controls, v4 q4 controls, viable `whisper-small.en` q4, a research-only two-tier composition, exact asset/cache/memory measurements, AssemblyAI disfluency-enabled and Deepgram filler-enabled controls, conditional same-audio Yoodli evidence, and the predeclared parity gate.

## Current sequencing

#1325/#1326 → selected P0 correctness slice from this ledger → #1306 → #1258 → #1324 → #1259 → #1302/#1303 → #1304 → #1318/#1319.

## Closure

Close this catch-all only when every row is either:

- proven and closed by an accepted exact-head implementation/evidence packet;
- rejected with falsifying source/runtime evidence; or
- explicitly deferred by Product Owner decision with a named destination and user-facing limitation.

# P0-02 — Exact-release Private-STT proof harness

## Outcome
A CDP harness attached on port 9222 proves the deployed Private path and fails closed on stale bundles or structurally void evidence.

## Required implementation
- Repair `scripts/private-cdp-cutover-proof.mjs` using current selectors/testids and controller signals.
- Require exact deployed `__APP_RELEASE__` before recording; stale/unknown release exits `STALE_BUNDLE` with code 3.
- Reject deprecated raw transcript-bearing diagnostic fields; accept only lengths, states, codes, and timings.
- Capture sanitized `/rest/v1/sessions` create/PATCH and progress/RPC status, PostgreSQL code, and bounded message classification.
- Assert Private provenance and zero AssemblyAI/Deepgram/Gemini/OpenAI transcription traffic.
- Keep two artifacts:
  1. content-free lifecycle/network timeline;
  2. controlled benchmark artifact containing reference and recognized text for WER.
- Add a product stale-tab check before Start: if a newer release exists, block the new recording and prompt reload; never interrupt an active recording.

## Acceptance evidence
- Fixture proves stale release fails before recording.
- Fixture proves missing selectors/terminal state/recognized text cannot yield PASS.
- Current release proves RECORDING → STOPPING → READY, finalization timing, save-candidate clearing, persistence status, and metric testids.
- Diagnostic artifact scan proves no transcript strings.
- Benchmark computes WER/accuracy/filler recall plus sample rate, RMS/peak, segments, RTF, decode/finalization timing.
- Exact-head CI and free/no-Cloud STT workflow green.

## Boundaries
The previous human run used a stale bundle and is not current-build qualification. Preserve it as stale-tab evidence, not PASS/FAIL evidence for the deployed cutover.

# STT Ping Log — tight dev⇄test feedback loop

This is the **fast channel**. It is **append-only**: never edit or delete a prior line,
never rewrite another agent's text. One line per signal, newest at the bottom.

- **Durable state** stays in `CURRENT_WORK.md` (thin index: owner / branch@SHA / status).
- **Evidence/detail** stays in the STT reports (proof recipes, artifacts, numbers).
- **This file** is just the back-and-forth so neither side has to re-parse a giant board cell
  to learn "what do I do next, and whose ball is it."

## Rules

1. **Append, don't rewrite.** Add a line; never touch existing lines or each other's board cells.
2. **One handoff = one testable claim.** A REQ names exactly one branch@SHA, the exact command,
   and the single expected result. Test replies with one RESULT (PASS/FAIL + the one delta).
3. **Check before you build.** Before starting work on an ID, read its latest line here. If the
   ball isn't yours, don't touch it. (This is the rule that stops crossed work.)
4. **Every line ends with the ball.** `=> test` or `=> dev` or `=> product`.

## Line format

```
<ISO8601-UTC> | <from>→<to> | <ID> | <KIND> | <branch@sha | —> | <one line> => <ball>
```

`KIND` ∈ `REQ` (please test/decide) · `RESULT` (pass/fail) · `ACK` · `BLOCKED` · `NOTE` · `DONE`.

## Log

```
2026-06-04T20:05Z | dev→test | STT-P6  | REQ    | dev/private-model-eval-main@7c04064a | candidate load FIXED (remote-only + onnx-community ids + fail-fast). Run model A/B per report run-spec (tiny/base.en/distil-small.en). TOP PRIORITY. => test
2026-06-04T20:05Z | dev→test | STT-P5  | NOTE   | dev/private-vad-silero-main@52cc2034   | asset+dep staged & ready, but VAD A/B DEFERRED until after STT-P6 per product. Do not run yet. => test
2026-06-04T20:05Z | dev→prod | STT-P8  | NOTE   | dev/private-resampler-parity@58d9ba7d  | your A/B: no WER lift, but timing win (first-text 5879→3355ms) + no regression. Product call = ship as timing-only. Awaiting merge approval. => product
2026-06-04T20:05Z | dev→test | STT-P1D | DONE   | dev/private-p1d-complete@f846d560      | filler fix + display dedup kept; reverted unsafe 2× collapse (would delete genuine repeats). 2× loop routed to STT-P6. No further dev action. => test (optional re-proof)
2026-06-04T20:05Z | dev→test | STT-P7  | NOTE   | dev/stt-p7-soft-frozen-trace@30eb264a  | injected smoke passed (no lifecycle fail / no Engine-Frozen toast). Awaiting human mic re-proof. => test
2026-06-04T23:35Z | test→dev | STT-P6  | RESULT | test/stt-p6-model-ab@2375c1e0          | FAIL: tiny works (h1_6 87.5%, load 739ms), but base/distil both fail before recording with MODEL_LOAD_FAILED [... -> onnx-community/...]: Unsupported model type: whisper. Artifacts: /private/tmp/stt-p6-ab-{tiny,base,distil}-h1_6.json. => dev
2026-06-05T00:10Z | dev→test | STT-P6  | REQ    | dev/private-model-eval-main@6defae00   | ROOT CAUSE: onnx-community/* is transformers.js v3 format → fails on @xenova v2 ("Unsupported model type"). FIX: candidate ids reverted to Xenova/* (v2-native); distil-small.en is v3-only → replaced with whisper-small.en (Xenova/whisper-small.en, ~244MB). Re-run A/B: candidates now tiny/base.en/**small.en** (NOT distil). tsc clean, 5/5. => test
2026-06-05T00:40Z | test→dev | STT-P6  | RESULT | test/stt-p6-model-ab-2@31c5da3e        | h1_6 PASS/PARTIAL: tiny 87.5% (load 702ms), base.en 100% (load 1613ms, finalize 4604ms), small.en 87.5% with bad first word + very slow finalize 46728ms. Base is promising; small should not ship. Expanding base to more fixtures. => test
```

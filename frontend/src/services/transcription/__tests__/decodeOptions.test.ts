// #1304 A1 harness certification — the shipping decode options must have ONE definition.
//
// A benchmark that decodes differently from the product measures a configuration no user runs, which is
// exactly why #1304 disqualifies both existing harnesses: `benchmark-whisper-ceiling.mts` forces a
// 5-second stride even on clips far shorter than the window and omits timestamps, and
// `stt-corpus-lane.ts` calls a bare `asr(audio)` with no options at all.
//
// Duplicated arithmetic cannot be held in parity by discipline. A silent divergence between the v2
// worker, the v4 engine and the A1 harness would fail no test — it would just quietly invalidate every
// comparison built on top of it. These assertions make that divergence fail here instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShippingDecodeOptions, decodeStrideBranch } from '../decodeOptions';
import { PRIV_STT } from '../sttConstants';

const WINDOW = PRIV_STT.WHISPER_WINDOW_SECONDS;
const STRIDE = PRIV_STT.WHISPER_STRIDE_SECONDS;

describe('shipping decode options', () => {
    it('audio shorter than the context window decodes as ONE window with NO stride', () => {
        for (const seconds of [0.5, 3.2, 12, WINDOW - 0.1]) {
            const options = buildShippingDecodeOptions(seconds);
            expect(options.chunk_length_s, `${seconds}s window`).toBe(WINDOW);
            expect(options.stride_length_s, `${seconds}s must not stride`).toBe(0);
            expect(decodeStrideBranch(seconds)).toBe('single-window-zero-stride');
        }
    });

    it('audio at or beyond the context window takes the long-form stride', () => {
        for (const seconds of [WINDOW, WINDOW + 0.1, 45, 120]) {
            const options = buildShippingDecodeOptions(seconds);
            expect(options.stride_length_s, `${seconds}s must stride`).toBe(STRIDE);
            expect(decodeStrideBranch(seconds)).toBe('long-form-strided');
        }
    });

    it('the boundary is EXACTLY the window: < window is single, >= window is long-form', () => {
        // The product uses `<`, so `WINDOW` itself is long-form. An off-by-one here would silently
        // change which branch the boundary fixture exercises.
        expect(buildShippingDecodeOptions(WINDOW - 0.001).stride_length_s).toBe(0);
        expect(buildShippingDecodeOptions(WINDOW).stride_length_s).toBe(STRIDE);
    });

    it('timestamps are always requested on the transcribe path', () => {
        for (const seconds of [1, WINDOW - 1, WINDOW, 90]) {
            expect(buildShippingDecodeOptions(seconds).return_timestamps).toBe(true);
        }
    });

    it('BOTH product engines consume the shared builder rather than re-deriving it', () => {
        // REPLACED A PAIR OF PRESENCE CHECKS. This read both engine sources with a CWD-relative
        // `readFileSync` — which resolves against vitest's working directory and had already produced a
        // false "these files are failing" elsewhere in this project — and then matched a regex for the
        // builder's NAME plus one for a re-derived stride. Both are source-text checks: a re-derivation
        // written with different whitespace, or lifted into a local first, passes them while the engine
        // silently decodes differently from the harness.
        //
        // The behavioural equivalent lives in `decodeRoute.test.ts`: the engines and the harness resolve
        // a route from the same inputs and their identity hashes must be EQUAL. Drift is then caught by
        // running the code rather than by describing it. Paths are resolved from `import.meta.url` so
        // the remaining structural assertion cannot depend on the working directory.
        const here = dirname(fileURLToPath(import.meta.url));
        const engines = resolve(here, '..', 'engines');
        for (const [name, file] of [
            ['v2 worker', 'transformers-js.worker.ts'],
            ['v4 engine', 'TransformersJSV4Engine.ts'],
        ] as const) {
            const source = readFileSync(resolve(engines, file), 'utf8');
            expect(source, `${name} must import the shared builder`).toMatch(/buildShippingDecodeOptions/);
        }
    });

    it('LibriSpeech-scale utterances land on the zero-stride branch (corpus-selection consequence)', () => {
        // Ordinary LibriSpeech utterances are well under the window, so the 5-second branch is NOT
        // exercised by the corpus alone. #1304 therefore requires a deliberate >30s concatenated
        // fixture; without it, the long-form path would go unmeasured while appearing covered.
        const typicalLibriSpeechSeconds = [2.1, 5.4, 8.9, 14.3, 21.7, 28.4];
        for (const seconds of typicalLibriSpeechSeconds) {
            expect(decodeStrideBranch(seconds)).toBe('single-window-zero-stride');
        }
    });
});

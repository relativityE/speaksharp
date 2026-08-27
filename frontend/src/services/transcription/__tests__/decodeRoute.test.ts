/**
 * #1304 Task 3A — route identity, and drift caught by BEHAVIOUR rather than by reading source.
 *
 * The previous parity check matched the builder's name in each engine's source. A re-derivation
 * written with different whitespace, or lifted into a local variable first, passed it while the engine
 * decoded differently from the harness — a benchmark that measures a configuration no user runs.
 *
 * Here the product path and the harness path resolve a route from the SAME inputs and their identity
 * hashes must be equal. Nothing is read from source; the drift shows up as a different number.
 */
import { describe, it, expect } from 'vitest';
import { resolveDecodeRoute, routeHash, DECODE_WINDOW_SECONDS } from '../decodeRoute';
import { buildShippingDecodeOptions } from '../decodeOptions';
import { PRIV_STT } from '../sttConstants';

/** Stands in for a harness that re-derives the stride instead of consuming the shared builder. */
function driftedHarnessRoute(engine: 'v2', modelId: string, audioSeconds: number) {
    return {
        engine,
        modelId,
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: PRIV_STT.WHISPER_STRIDE_SECONDS,   // hardcoded — the classic harness defect
        return_timestamps: true,
        // `audioSeconds` deliberately ignored, which is exactly the bug.
        _audioSeconds: audioSeconds,
    };
}

describe('the decode route is resolved, not re-derived', () => {
    it('short audio resolves to the ZERO-stride branch', () => {
        const r = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        expect(r.stride_length_s).toBe(0);
        expect(r.chunk_length_s).toBe(DECODE_WINDOW_SECONDS);
        expect(r.return_timestamps).toBe(true);
    });

    it('long audio resolves to the long-form stride', () => {
        expect(resolveDecodeRoute('v2', 'whisper-base.en', 120).stride_length_s)
            .toBe(PRIV_STT.WHISPER_STRIDE_SECONDS);
    });

    it('the route never diverges from the shipping builder', () => {
        for (const seconds of [0.5, 12, DECODE_WINDOW_SECONDS - 0.001, DECODE_WINDOW_SECONDS, 90]) {
            const options = buildShippingDecodeOptions(seconds);
            const route = resolveDecodeRoute('v2', 'whisper-base.en', seconds);
            expect({
                chunk_length_s: route.chunk_length_s,
                stride_length_s: route.stride_length_s,
                return_timestamps: route.return_timestamps,
            }).toEqual(options);
        }
    });

    it('v4 carries the variant DTYPE, keyed by VARIANT id (not model id)', () => {
        // `PRIV_STT_V4_VARIANTS` is keyed `base_q4` / `distil_q4`. Looking it up by MODEL id returns
        // undefined and would silently drop the dtype from the identity — a real trap.
        const withVariant = resolveDecodeRoute('v4', 'onnx-community/whisper-base.en', 12, 'base_q4');
        expect(withVariant.dtype).toEqual({ encoder_model: 'fp32', decoder_model_merged: 'q4' });
        const withoutVariant = resolveDecodeRoute('v4', 'onnx-community/whisper-base.en', 12);
        expect(withoutVariant.dtype).toBeUndefined();
    });
});

describe('route identity detects drift', () => {
    it('the SAME inputs produce the SAME hash — this is the parity proof', () => {
        const product = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        const harness = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        expect(routeHash(harness)).toBe(routeHash(product));
    });

    it('property ORDER cannot change the hash', () => {
        const a = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        const reordered = {
            return_timestamps: a.return_timestamps, stride_length_s: a.stride_length_s,
            chunk_length_s: a.chunk_length_s, modelId: a.modelId, engine: a.engine,
        } as typeof a;
        expect(routeHash(reordered)).toBe(routeHash(a));
    });

    it('a harness that HARDCODES the stride diverges — arms must not be compared', () => {
        // THE DEFECT THIS CATCHES. `benchmark-whisper-ceiling.mts` forces a 5s stride even on clips far
        // shorter than the window. On short audio the product strides 0, so the two decode differently
        // and any WER comparison between them measures the configuration, not the model.
        const product = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        const drifted = driftedHarnessRoute('v2', 'whisper-base.en', 12);
        expect(drifted.stride_length_s).not.toBe(product.stride_length_s);
        expect(routeHash(drifted as never)).not.toBe(routeHash(product));
    });

    it('short and long inputs are DIFFERENT routes, with the stride visible in each', () => {
        const short = resolveDecodeRoute('v2', 'whisper-base.en', 12);
        const long = resolveDecodeRoute('v2', 'whisper-base.en', 120);
        expect(routeHash(short)).not.toBe(routeHash(long));
        expect([short.stride_length_s, long.stride_length_s]).toEqual([0, PRIV_STT.WHISPER_STRIDE_SECONDS]);
    });

    it('a different MODEL is a different route', () => {
        expect(routeHash(resolveDecodeRoute('v2', 'whisper-base.en', 12)))
            .not.toBe(routeHash(resolveDecodeRoute('v2', 'whisper-small.en', 12)));
    });
});

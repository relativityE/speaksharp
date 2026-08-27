import { PRIV_STT } from './sttConstants';

/**
 * #1304 A1 — the SINGLE source of the shipping Whisper decode window/stride/timestamp options.
 *
 * WHY THIS EXISTS. The v2 worker and the v4 engine each computed this expression independently, and the
 * benchmark harnesses computed something else again: `benchmark-whisper-ceiling.mts` forces a 5-second
 * stride even on clips far shorter than the window and omits timestamps, while `stt-corpus-lane.ts`
 * calls a bare `asr(audio)` with no options at all. #1304 disqualifies both as "direct-pipeline
 * diagnostic evidence only" precisely because a benchmark that decodes differently from the product
 * measures a configuration no user ever runs.
 *
 * Duplicated arithmetic in three places cannot be kept in parity by discipline, and a silent divergence
 * would not fail any test — it would just quietly invalidate every comparison built on it. So the
 * product and the harness now read the SAME builder.
 *
 * THE STRIDE IS CONDITIONAL, and that matters for corpus selection: audio shorter than the 30s model
 * context window decodes as one window with NO stride, so the overwhelming majority of LibriSpeech
 * utterances exercise the zero-stride branch. A harness that hardcodes a stride would measure the
 * long-form path on short clips. Exercising the 5-second branch honestly requires a deliberate
 * >30-second fixture.
 */
export interface ShippingDecodeOptions {
    /** Model context window, seconds. */
    chunk_length_s: number;
    /** 0 for single-window audio; the long-form overlap otherwise. */
    stride_length_s: number;
    /** The product always requests timestamps on the transcribe path. */
    return_timestamps: boolean;
}

/** Which branch of the conditional stride an input took — recorded as benchmark evidence. */
export type DecodeStrideBranch = 'single-window-zero-stride' | 'long-form-strided';

export function decodeStrideBranch(audioLengthSeconds: number): DecodeStrideBranch {
    return audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS
        ? 'single-window-zero-stride'
        : 'long-form-strided';
}

/**
 * Build the exact options the shipping transcribe path passes to transformers.js.
 *
 * Callers may layer additional keys (engine-specific anti-loop defaults, language/task, proof hooks)
 * ON TOP of this, but must not re-derive the window/stride/timestamp values themselves.
 */
export function buildShippingDecodeOptions(audioLengthSeconds: number): ShippingDecodeOptions {
    return {
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: decodeStrideBranch(audioLengthSeconds) === 'single-window-zero-stride'
            ? 0
            : PRIV_STT.WHISPER_STRIDE_SECONDS,
        return_timestamps: true,
    };
}

import { parseTranscriptForHighlighting } from './highlightUtils';
import type { TranscriptToken } from '@/components/session/LiveTranscript';

/**
 * #1222 S11 — adapt the app's existing highlight tokenizer into the shell's `LiveTranscript` token shape.
 * Reuses `parseTranscriptForHighlighting` (the same filler detection the current transcript panel uses),
 * so the new during/after transcript highlights exactly the words the rest of the app treats as fillers.
 * Error tags (`[inaudible]` etc.) render as plain text — they are not fillers.
 */
export function tokensFromTranscript(text: string, userWords: string[] = []): TranscriptToken[] {
    return parseTranscriptForHighlighting(text ?? '', userWords)
        // #1231: parseTranscriptForHighlighting emits whitespace as its OWN tokens (it splits with
        // `split(/(\s+)/)` to preserve spacing). LiveTranscript already inserts a single space after every
        // token, so passing those whitespace tokens through compounds into 2–3 spaces per word gap — a
        // rendering artifact that left tripled spaces in the transcript's textContent (and broke RegExp
        // transcript assertions, which don't normalize whitespace). Drop them; the separator is enough.
        .filter((t) => t.transcript.trim() !== '')
        .map((t) => ({
            text: t.transcript,
            filler: t.type === 'filler',
        }));
}

/**
 * #1222 S11 — build a fixed-width waveform amplitude array (~`bars` entries, 0..1) from a rolling buffer
 * of live mic levels. The app exposes a single scalar `micLevel`, not a spectrum, so the container samples
 * it over time into this buffer; this maps that buffer onto a stable bar count so the track always fills.
 * `recordedCount` (how many leading bars are "recorded"/orange) is derived from how much of the buffer is
 * populated.
 */
export function waveformFromLevels(levels: number[], bars = 72): { amplitudes: number[]; recordedCount: number } {
    const L = levels.length;
    const amplitudes = new Array(bars).fill(0);
    if (L === 0) return { amplitudes, recordedCount: 0 };
    if (L <= bars) {
        // Fewer samples than bars: leading-fill 1:1, so the recorded portion grows left→right and the
        // rest stays the grey tail.
        for (let i = 0; i < L; i++) amplitudes[i] = Math.max(0, Math.min(1, levels[i]));
        return { amplitudes, recordedCount: L };
    }
    // More samples than bars: downsample the FULL buffer to `bars` buckets taking the PEAK per bucket —
    // the mean flattens every transient into mush (the "flat waveform" bug). The whole recording is shown,
    // not just the last 72 samples.
    for (let i = 0; i < bars; i++) {
        const start = Math.floor((i * L) / bars);
        const end = Math.max(start + 1, Math.floor(((i + 1) * L) / bars));
        let peak = 0;
        for (let j = start; j < end && j < L; j++) if (levels[j] > peak) peak = levels[j];
        amplitudes[i] = Math.max(0, Math.min(1, peak));
    }
    return { amplitudes, recordedCount: bars };
}

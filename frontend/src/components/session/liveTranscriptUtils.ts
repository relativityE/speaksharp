import { collapseTranscriptRepetitionLoops } from '@/utils/repetitionRisk';

/**
 * #772 DISPLAY-ONLY post-stop repetition collapse for the settled (final) view.
 *
 * After Stop, the committed store can briefly hold a DOUBLED streaming hypothesis
 * (a late v4 update re-doubles it), while the SAVED/detail transcript is the clean
 * collapsed final. The post-stop visible final must match the saved transcript, so
 * here we collapse the SAME exact whole-text doubling / >=3x adjacent loop accepted in
 * #773 — purely for rendering. The stored/saved transcript is NEVER mutated. We do NOT
 * collapse ambiguous interleaved spans, and there is NO fuzzy de-duplication.
 *
 * Collapse cuts at the loop seam, which can leave a trailing separator (e.g. the join
 * comma in "…basically, …basically." -> "…basically,"). Only WHEN a loop was actually
 * collapsed do we restore terminal punctuation so the visible final matches the saved
 * transcript (which is terminal-punctuated at the save boundary). A clean, non-looped
 * transcript is returned untouched.
 */
export function collapseRepeatedFinalForDisplay(text: string): string {
    const raw = (text || '').trim();
    if (!raw) return raw;
    const collapsed = collapseTranscriptRepetitionLoops(raw).trim();
    if (collapsed === raw) return raw; // no loop collapsed — leave display untouched
    if (/[,:;]$/.test(collapsed)) return `${collapsed.slice(0, -1)}.`;
    if (!/[.!?]["'’”)\]]?$/.test(collapsed)) return `${collapsed}.`;
    return collapsed;
}

/**
 * Split live draft text into completed sentences ("settled" — render calm/recognized)
 * and the trailing in-progress sentence ("active" — render as Draft). Live-view only:
 * the saved transcript still comes from the whole-utterance final decode.
 */
export function splitSettledActiveTranscript(text: string): { settled: string; active: string } {
    const trimmed = (text || '').trim();
    if (!trimmed) return { settled: '', active: '' };

    // Last sentence-ending punctuation (. ! ?), allowing a trailing closing quote/bracket.
    const terminator = /[.!?]+["'’”)\]]?/g;
    let lastEnd = -1;
    let match: RegExpExecArray | null;
    while ((match = terminator.exec(trimmed)) !== null) {
        lastEnd = match.index + match[0].length;
    }

    if (lastEnd <= 0) return { settled: '', active: trimmed };
    return {
        settled: trimmed.slice(0, lastEnd).trim(),
        active: trimmed.slice(lastEnd).trim(),
    };
}

// Conservative thresholds, grounded on the real failure artifact
// (speaksharp-official-stt-ab-targeted-trust-1781263998): a v4 rolling-hypothesis loop has a top
// repeated 3-gram count of 28-29 and 3-gram redundancy 0.38-0.65, while clean v4-final AND v2
// transcripts top out at a 3-gram count of 2 and redundancy <= 0.009. The cuts below sit far from
// any healthy transcript, so the detector fires ONLY on a severe loop.
const SEVERE_LOOP_MIN_TOKENS = 12;
const SEVERE_LOOP_MAX_NGRAM_COUNT = 4; // healthy max is 2; looped is 28+
const SEVERE_LOOP_REDUNDANCY = 0.25;   // healthy is <= 0.009; looped is 0.38-0.65

/**
 * Conservative, deterministic detector for a SEVERE repetition loop in live STT text — the v4
 * Whisper streaming/rolling-hypothesis failure mode (drift + repetition). DISPLAY-ONLY: callers use
 * this purely to decide whether to WITHHOLD unstable live text from the surface until the clean
 * whole-utterance final arrives. It NEVER mutates, rewrites, or de-duplicates transcript content
 * (collapse/fuzzy-dedup is intentionally NOT used — it can delete legitimate repeated speech and is
 * empirically insufficient anyway). Signal = frequency of the most-repeated normalized 3-gram and
 * overall 3-gram redundancy; both far separate looped from healthy text.
 */
export function hasSevereRepetitionLoop(text: string): boolean {
    const words = (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length < SEVERE_LOOP_MIN_TOKENS) return false;

    const counts = new Map<string, number>();
    let totalGrams = 0;
    let maxCount = 0;
    let repeatedGrams = 0;
    for (let i = 0; i + 3 <= words.length; i += 1) {
        const gram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        const next = (counts.get(gram) ?? 0) + 1;
        counts.set(gram, next);
        totalGrams += 1;
        if (next > maxCount) maxCount = next;
        if (next > 1) repeatedGrams += 1; // each occurrence past the first is a repeat
    }
    if (totalGrams === 0) return false;
    const redundancy = repeatedGrams / totalGrams;
    return maxCount >= SEVERE_LOOP_MAX_NGRAM_COUNT || redundancy >= SEVERE_LOOP_REDUNDANCY;
}

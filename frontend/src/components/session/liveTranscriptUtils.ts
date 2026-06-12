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

type WordToken = {
    raw: string;
    normalized: string;
};

const toWordTokens = (text: string): WordToken[] =>
    text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => ({
            raw,
            normalized: raw.toLowerCase().replace(/[^a-z0-9']/g, ''),
        }))
        .filter((token) => token.normalized !== '');

const sameWordWindow = (left: WordToken[], right: WordToken[], leftStart: number, rightStart: number, length: number) => {
    for (let index = 0; index < length; index += 1) {
        if (left[leftStart + index]?.normalized !== right[rightStart + index]?.normalized) {
            return false;
        }
    }
    return true;
};

const wordsToText = (tokens: WordToken[]) => tokens.map((token) => token.raw).join(' ').trim();

/**
 * The live Private preview can emit a rolling full-window hypothesis. When the
 * panel blindly renders committed text + that whole draft, users see repeated
 * sentences stack up even though the saved final transcript is clean. This is
 * display-only: it trims draft text that is already represented by the visible
 * committed transcript and returns only genuinely new trailing words.
 */
export function trimOverlappingDraftTranscript(committedText: string, draftText: string): string {
    const committed = toWordTokens(committedText);
    const draft = toWordTokens(draftText);

    if (draft.length === 0) return '';
    if (committed.length === 0) return wordsToText(draft);

    const committedNormalized = committed.map((token) => token.normalized).join(' ');
    const draftNormalized = draft.map((token) => token.normalized).join(' ');
    if (committedNormalized === draftNormalized || committedNormalized.includes(draftNormalized)) {
        return '';
    }

    const minOverlap = Math.min(3, draft.length);
    const maxPrefixOffset = Math.min(8, Math.max(0, draft.length - minOverlap));
    let bestTrim = 0;
    let bestOverlap = 0;

    for (let prefixOffset = 0; prefixOffset <= maxPrefixOffset; prefixOffset += 1) {
        const maxOverlap = Math.min(committed.length, draft.length - prefixOffset);
        for (let overlap = maxOverlap; overlap >= minOverlap; overlap -= 1) {
            if (sameWordWindow(committed, draft, committed.length - overlap, prefixOffset, overlap)) {
                const trim = prefixOffset + overlap;
                if (overlap > bestOverlap || (overlap === bestOverlap && trim > bestTrim)) {
                    bestOverlap = overlap;
                    bestTrim = trim;
                }
                break;
            }
        }
    }

    if (bestTrim > 0) {
        return wordsToText(draft.slice(bestTrim));
    }

    return wordsToText(draft);
}

/**
 * Display-only cleanup for adjacent repeated phrase runs in live text. The raw
 * transcript is still preserved for save/scoring; this only keeps the visible
 * live panel from looking broken while a provisional recognizer revises itself.
 */
export function collapseAdjacentRepeatedPhrases(text: string): string {
    const tokens = toWordTokens(text);
    if (tokens.length < 6) return text.trim();

    const collapsed: WordToken[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        let skipped = false;
        const maxPhraseLength = Math.min(12, Math.floor(collapsed.length), tokens.length - index);
        for (let phraseLength = maxPhraseLength; phraseLength >= 3; phraseLength -= 1) {
            if (sameWordWindow(collapsed, tokens, collapsed.length - phraseLength, index, phraseLength)) {
                index += phraseLength - 1;
                skipped = true;
                break;
            }
        }
        if (!skipped) {
            collapsed.push(tokens[index]);
        }
    }

    return wordsToText(collapsed);
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
 * (collapse/fuzzy-dedup is intentionally NOT used as the release fix — it can delete legitimate
 * repeated speech and is empirically insufficient anyway). Signal = frequency of the most-repeated
 * normalized 3-gram and overall 3-gram redundancy; both far separate looped from healthy text.
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
        if (next > 1) repeatedGrams += 1;
    }
    if (totalGrams === 0) return false;
    const redundancy = repeatedGrams / totalGrams;
    return maxCount >= SEVERE_LOOP_MAX_NGRAM_COUNT || redundancy >= SEVERE_LOOP_REDUNDANCY;
}

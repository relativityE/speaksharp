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

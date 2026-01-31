import nlp from 'compromise';
import { FILLER_WORD_KEYS } from '../config';

// Interfaces for our data structures
interface FillerData {
    count: number;
    color: string;
}

export interface FillerCounts {
    [key: string]: FillerData;
}

interface FillerPatterns {
    [key: string]: RegExp;
}

interface WordConfidence {
    word: string;
    confidence: number;
}

interface FinalChunk {
    text: string;
}

interface TranscriptStats {
    transcript: string;
    total_words: number;
    accuracy: number;
    duration: number;
}

const defaultFillerPatterns: FillerPatterns = {
    [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|uhm)\b/gi,
    [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
    [FILLER_WORD_KEYS.AH]: /\b(ah|ahm|ahhh)\b/gi,
    [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
    [FILLER_WORD_KEYS.OH]: /\b(oh|ooh|ohh)\b/gi,
    [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
    [FILLER_WORD_KEYS.KIND_OF]: /\b(kind of|kinda)\b/gi,
    [FILLER_WORD_KEYS.SORT_OF]: /\b(sort of|sorta)\b/gi,
    // Ambiguous words processed via NLP below:
    // LIKE, SO, ACTUALLY, BASICALLY, LITERALLY
};

const FILLER_WORD_COLORS: string[] = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];

export const createInitialFillerData = (customWords: string[] = []): FillerCounts => {
    const initial: FillerCounts = {
        total: { count: 0, color: '' }
    };
    const allFillerKeys: string[] = [...Object.values(FILLER_WORD_KEYS), ...customWords];
    allFillerKeys.forEach((key, index) => {
        initial[key] = {
            count: 0,
            color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length]
        };
    });
    return initial;
};

export const createFillerPatterns = (customWords: string[] = []): FillerPatterns => {
    const patterns: FillerPatterns = { ...defaultFillerPatterns };
    customWords.forEach((word) => {
        patterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
    });
    return patterns;
};

/**
 * Counts filler words using a combination of Regex (for unambiguous tokens)
 * and NLP (for context-dependent words like "like").
 */
export const countFillerWords = (text: string, customWords: string[] = []): FillerCounts => {
    const counts: FillerCounts = createInitialFillerData(customWords);
    const patterns: FillerPatterns = createFillerPatterns(customWords);
    const doc = nlp(text);
    let totalCount = 0;

    // 1. Process unambiguous fillers and custom words via Regex
    for (const key in patterns) {
        const pattern: RegExp = patterns[key];
        const matches: RegExpMatchArray | null = text.match(pattern);
        if (matches) {
            const count = matches.length;
            counts[key].count = count;
            totalCount += count;
        }
    }

    // 2. Process context-dependent fillers via NLP (compromise)

    // LIKE: Count as filler ONLY if not used as a Verb or Preposition (in a non-discourse way)
    // Speech filler "like" is often tagged as Expression, Adverb, or even Verb (mistakenly).
    // Better heuristic: if it's flanked by commas or at start of phrase, it's a filler.
    const likeMatches = doc.match('like').filter(m => {
        const json = m.json()[0];
        const term = json?.terms[0];
        if (!term) return false;

        const tags = term.tags || [];
        // Definitely fillers:
        if (tags.includes('Expression')) return true;

        // Context-based:
        const isStart = m.has('^like');
        const hasCommaPost = (term.post || '').includes(',');
        const hasCommaPre = (term.pre || '').includes(',');

        if (isStart || hasCommaPost || hasCommaPre) {
            // Even if tagged as Verb, if it has commas it's likely a filler in spoken transcript
            return true;
        }

        // Fallback for standard NLP filtering
        return !tags.includes('Verb') && !tags.includes('Preposition');
    });
    counts[FILLER_WORD_KEYS.LIKE].count = likeMatches.length;
    totalCount += likeMatches.length;

    // SO: Count as filler if it's at the start of a sentence or followed by a comma/pause
    const soMatches = doc.match('so').filter(m => {
        const json = m.json()[0];
        const term = json?.terms[0];
        if (!term) return false;

        // Discourse marker 'so' is dominant at start of phrase or with a pause (comma)
        const isStart = m.has('^so');
        const isEnd = m.has('so$');
        const hasCommaPost = (term.post || '').includes(',');
        const hasCommaPre = (term.pre || '').includes(',');

        // If it's "So," OR "^So " OR ", so"
        return isStart || hasCommaPost || hasCommaPre || isEnd;
    });
    counts[FILLER_WORD_KEYS.SO].count = soMatches.length;
    totalCount += soMatches.length;

    // ACTUALLY, BASICALLY, LITERALLY: Always counted as "crutch words" in this app's context
    // but we could refine them if needed. For now, standard regex behavior is fine.
    [FILLER_WORD_KEYS.ACTUALLY, FILLER_WORD_KEYS.BASICALLY, FILLER_WORD_KEYS.LITERALLY].forEach(key => {
        const matches = text.match(new RegExp(`\\b(${key})\\b`, 'gi'));
        if (matches) {
            counts[key].count = matches.length;
            totalCount += matches.length;
        }
    });

    counts.total = { count: totalCount, color: '' };
    return counts;
};

export const calculateTranscriptStats = (
    finalChunks: FinalChunk[],
    wordConfidences: WordConfidence[],
    interimTranscript: string = '',
    duration: number = 0
): TranscriptStats => {
    const finalTranscriptText: string = [...finalChunks.map(c => c.text), interimTranscript].join(' ').trim();
    const total_words = finalTranscriptText.split(/\s+/).filter(Boolean).length;

    const averageConfidence: number = wordConfidences.length > 0
        ? wordConfidences.reduce((sum, word) => sum + word.confidence, 0) / wordConfidences.length
        : 0;

    return {
        transcript: finalTranscriptText,
        total_words: total_words,
        accuracy: averageConfidence,
        duration: duration,
    };
};

export const limitArray = <T>(array: T[], maxLength: number): T[] => {
    return array.length > maxLength ? array.slice(-maxLength) : array;
};

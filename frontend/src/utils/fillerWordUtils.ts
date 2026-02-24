import nlp from 'compromise';
import { FILLER_WORD_KEYS } from '../config';

// Interfaces for our data structures
export interface FillerData {
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
    transcript: string;
}

export interface TranscriptStats {
    transcript: string;
    total_words: number;
    accuracy: number;
    duration: number;
}

const STATIC_FILLER_PATTERNS: FillerPatterns = {
    [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|uhm)\b/gi,
    [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
    [FILLER_WORD_KEYS.AH]: /\b(ah|ahm|ahhh)\b/gi,
    [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
    [FILLER_WORD_KEYS.OH]: /\b(oh|ooh|ohh)\b/gi,
    [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
    [FILLER_WORD_KEYS.KIND_OF]: /\b(kind of|kinda)\b/gi,
    [FILLER_WORD_KEYS.SORT_OF]: /\b(sort of|sorta)\b/gi,
    // Crutch words integrated into static patterns for efficiency
    [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
    [FILLER_WORD_KEYS.BASICALLY]: /\b(basically)\b/gi,
    [FILLER_WORD_KEYS.LITERALLY]: /\b(literally)\b/gi,
};

// Cache for compiled user word regex patterns
const userWordRegexCache = new Map<string, RegExp>();

// Single-item cache for the NLP document to avoid redundant parsing of the same text
let lastTextForNlp: string | null = null;
let lastNlpDoc: ReturnType<typeof nlp> | null = null;

/**
 * Returns a parsed compromise document, using a cached version if the text matches.
 */
const getParsedDoc = (text: string): ReturnType<typeof nlp> => {
    if (text === lastTextForNlp && lastNlpDoc) {
        return lastNlpDoc;
    }
    lastTextForNlp = text;
    lastNlpDoc = nlp(text);
    return lastNlpDoc;
};

const FILLER_WORD_COLORS: string[] = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];
let cachedPatterns: FillerPatterns | null = null;
let cachedUserWordsKey: string = '';

export const createInitialFillerData = (userWords: string[] = []): FillerCounts => {
    const initial: FillerCounts = {
        total: { count: 0, color: '' }
    };
    const allFillerKeys: string[] = [...Object.values(FILLER_WORD_KEYS), ...userWords];
    allFillerKeys.forEach((key, index) => {
        initial[key] = {
            count: 0,
            color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length]
        };
    });
    return initial;
};

export const createFillerPatterns = (userWords: string[] = []): FillerPatterns => {
    const currentKey = userWords.join('|');

    // Memoization: Return cached patterns if user words haven't changed
    if (cachedPatterns && currentKey === cachedUserWordsKey) {
        return cachedPatterns;
    }

    const patterns: FillerPatterns = { ...STATIC_FILLER_PATTERNS };
    userWords.forEach((word) => {
        let regex = userWordRegexCache.get(word);
        if (!regex) {
            regex = new RegExp(`\\b(${word})\\b`, 'gi');
            userWordRegexCache.set(word, regex);
        }
        patterns[word] = regex;
    });

    cachedPatterns = patterns;
    cachedUserWordsKey = currentKey;

    return patterns;
};

/**
 * Counts filler words using a combination of Regex (for unambiguous tokens)
 * and NLP (for context-dependent words like "like").
 */
export const countFillerWords = (text: string, userWords: string[] = []): FillerCounts => {
    const counts: FillerCounts = createInitialFillerData(userWords);
    const patterns: FillerPatterns = createFillerPatterns(userWords);
    const doc = getParsedDoc(text);
    let totalCount = 0;

    // 1. Process unambiguous fillers and user words via Regex
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
    // INDUSTRY STANDARD: Boundary-based detection for unpunctuated streams

    // LIKE: Count as filler ONLY if not used as a main Verb/Preposition 
    // unless it appears in a clear discourse position (Start/End of segment)
    const likeMatches = doc.match('like').filter(m => {
        const json = m.json()[0];
        const term = json?.terms[0];
        if (!term) return false;

        const tags = term.tags || [];
        const isStart = m.has('#Start');
        const isEnd = m.has('#End');

        // Loose heuristic: if it's at a segment boundary in a raw stream, 
        // it's highly likely to be a filler "Like," or ", like."
        if (isStart || isEnd) return true;

        // Context-based (punctuation fallback)
        const hasCommaPost = (term.post || '').includes(',');
        const hasCommaPre = (term.pre || '').includes(',');
        if (hasCommaPost || hasCommaPre) return true;

        // Strict NLP fallback
        return !tags.includes('Verb') && !tags.includes('Preposition');
    });
    counts[FILLER_WORD_KEYS.LIKE].count = likeMatches.length;
    totalCount += likeMatches.length;

    // SO: Count as filler if it's used as a discourse marker
    const soMatches = doc.match('so').filter(m => {
        const json = m.json()[0];
        const term = json?.terms[0];
        if (!term) return false;

        const isStart = m.has('#Start');
        const isEnd = m.has('#End');
        const hasCommaPost = (term.post || '').includes(',');
        const hasCommaPre = (term.pre || '').includes(',');

        // Discourse marker 'so' is dominant at boundaries or with a pause
        return isStart || isEnd || hasCommaPost || hasCommaPre;
    });
    counts[FILLER_WORD_KEYS.SO].count = soMatches.length;
    totalCount += soMatches.length;

    counts.total = { count: totalCount, color: '' };
    return counts;
};

export const calculateTranscriptStats = (
    finalChunks: FinalChunk[],
    wordConfidences: WordConfidence[],
    interimTranscript: string = '',
    duration: number = 0
): TranscriptStats => {
    const finalTranscriptText: string = [...finalChunks.map(c => c.transcript), interimTranscript].join(' ').trim();
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

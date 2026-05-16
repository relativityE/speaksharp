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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FILLER_WORD_COLORS: string[] = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];
let cachedPatterns: FillerPatterns | null = null;
let cachedUserWordsKey: string = '';

const CONTEXTUAL_FILLER_PATTERNS: FillerPatterns = {
    // Count clear discourse-marker uses without counting semantic uses like "I like this".
    [FILLER_WORD_KEYS.LIKE]: /(?:^|[.!?,;:]\s*)like(?=\s|$|[.!?,;:])|(?:^|\s)like(?=\s*[.!?,;:]|$)/gi,
    // Count "So, ..." / "so I think ..." starts and pause-delimited uses, not "so happy".
    [FILLER_WORD_KEYS.SO]: /(?:^|[.!?,;:]\s*)so(?=\s|$|[.!?,;:])|(?:^|\s)so(?=\s*[.!?,;:]|$)/gi,
};

const countPatternMatches = (text: string, pattern: RegExp): number => {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    pattern.lastIndex = 0;
    return matches?.length ?? 0;
};

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
            regex = new RegExp(`(?:^|\\W)(${escapeRegExp(word)})(?=$|\\W)`, 'gi');
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
    let totalCount = 0;

    // 1. Process unambiguous fillers and user words via Regex
    for (const key in patterns) {
        const pattern: RegExp = patterns[key];
        const count = countPatternMatches(text, pattern);
        if (count > 0) {
            counts[key].count = count;
            totalCount += count;
        }
    }

    // 2. Process context-dependent fillers with deterministic boundary rules.
    // Private/Cloud transcripts often arrive without punctuation, and the old
    // NLP path missed sentence-start fillers that the transcript UI highlighted.
    for (const key in CONTEXTUAL_FILLER_PATTERNS) {
        const count = countPatternMatches(text, CONTEXTUAL_FILLER_PATTERNS[key]);
        counts[key].count = count;
        totalCount += count;
    }

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

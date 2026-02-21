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
    text: string;
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

// Cache for compiled custom word regex patterns
const customWordRegexCache = new Map<string, RegExp>();

// LRU cache for the NLP document to avoid redundant parsing of the same text
const MAX_NLP_CACHE_SIZE = 10;
const nlpCache = new Map<string, ReturnType<typeof nlp>>();

/**
 * Returns a parsed compromise document, using a cached version if available.
 * Implements a simple LRU cache to handle alternating calls efficiently.
 */
const getParsedDoc = (text: string): ReturnType<typeof nlp> => {
    const cachedDoc = nlpCache.get(text);
    if (cachedDoc) {
        // Move to end (most recent)
        nlpCache.delete(text);
        nlpCache.set(text, cachedDoc);
        return cachedDoc;
    }

    const doc = nlp(text);

    // Maintain cache size
    if (nlpCache.size >= MAX_NLP_CACHE_SIZE) {
        const firstKey = nlpCache.keys().next().value;
        if (firstKey !== undefined) {
            nlpCache.delete(firstKey);
        }
    }

    nlpCache.set(text, doc);
    return doc;
};

const FILLER_WORD_COLORS: string[] = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];
let cachedPatterns: FillerPatterns | null = null;
let cachedCustomWordsKey: string = '';

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
    const currentKey = customWords.join('|');

    // Memoization: Return cached patterns if custom words haven't changed
    if (cachedPatterns && currentKey === cachedCustomWordsKey) {
        return cachedPatterns;
    }

    const patterns: FillerPatterns = { ...STATIC_FILLER_PATTERNS };
    customWords.forEach((word) => {
        let regex = customWordRegexCache.get(word);
        if (!regex) {
            regex = new RegExp(`\\b(${word})\\b`, 'gi');
            customWordRegexCache.set(word, regex);
        }
        patterns[word] = regex;
    });

    cachedPatterns = patterns;
    cachedCustomWordsKey = currentKey;

    return patterns;
};

/**
 * Counts filler words using a combination of Regex (for unambiguous tokens)
 * and NLP (for context-dependent words like "like").
 */
export const countFillerWords = (text: string, customWords: string[] = []): FillerCounts => {
    const counts: FillerCounts = createInitialFillerData(customWords);
    const patterns: FillerPatterns = createFillerPatterns(customWords);
    const doc = getParsedDoc(text);
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

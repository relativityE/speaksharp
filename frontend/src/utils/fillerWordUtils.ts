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
    [FILLER_WORD_KEYS.LIKE]: /\b(like)\b/gi,
    [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
    [FILLER_WORD_KEYS.SO]: /\b(so)\b/gi,
    [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
    [FILLER_WORD_KEYS.OH]: /\b(oh|ooh|ohh)\b/gi,
    [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
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

export const countFillerWords = (text: string, customWords: string[] = []): FillerCounts => {
    const counts: FillerCounts = createInitialFillerData(customWords);
    const patterns: FillerPatterns = createFillerPatterns(customWords);
    let totalCount = 0;

    for (const key in patterns) {
        const pattern: RegExp = patterns[key];
        const matches: RegExpMatchArray | null = text.match(pattern);
        if (matches) {
            const count = matches.length;
            counts[key].count = count;
            totalCount += count;
        }
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

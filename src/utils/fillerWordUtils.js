import { FILLER_WORD_KEYS } from '../config';

const defaultFillerPatterns = {
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

const FILLER_WORD_COLORS = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];

export const createInitialFillerData = (customWords = []) => {
    const initial = {};
    const allFillerKeys = [...Object.values(FILLER_WORD_KEYS), ...customWords];
    allFillerKeys.forEach((key, index) => {
        initial[key] = {
            count: 0,
            color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length]
        };
    });
    return initial;
};

export const createFillerPatterns = (customWords = []) => {
    const patterns = { ...defaultFillerPatterns };
    customWords.forEach((word) => {
        patterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
    });
    return patterns;
};

export const countFillerWords = (text, customWords = []) => {
    const counts = createInitialFillerData(customWords);
    const patterns = createFillerPatterns(customWords);

    for (const key in patterns) {
        const pattern = patterns[key];
        const matches = text.match(pattern);
        if (matches) {
            counts[key].count = matches.length;
        }
    }
    return counts;
};

export const calculateTranscriptStats = (finalChunks, wordConfidences, interimTranscript = '') => {
    const finalTranscriptText = [...finalChunks.map(c => c.text), interimTranscript].join(' ').trim();
    const averageConfidence = wordConfidences.length > 0
        ? wordConfidences.reduce((sum, word) => sum + word.confidence, 0) / wordConfidences.length
        : 0;

    return {
        transcript: finalTranscriptText,
        total_words: finalTranscriptText.split(/\s+/).filter(Boolean).length,
        accuracy: averageConfidence,
    };
};

export const limitArray = (array, maxLength) => {
    return array.length > maxLength ? array.slice(-maxLength) : array;
};

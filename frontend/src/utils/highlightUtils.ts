import { FILLER_WORD_KEYS } from '../config';

export interface HighlightToken {
    text: string;
    type: 'text' | 'filler' | 'error';
    id: string;
    color?: string;
}

/**
 * HSL token palette for deterministic assignment.
 * Optimized for dark mode readability.
 */
const COLOR_PALETTE = [
    '#F87171', // Red 400
    '#FB923C', // Orange 400
    '#FACC15', // Yellow 400
    '#A3E635', // Lime 400
    '#4ADE80', // Green 400
    '#34D399', // Emerald 400
    '#22D3EE', // Cyan 400
    '#60A5FA', // Blue 400
    '#818CF8', // Indigo 400
    '#A78BFA', // Violet 400
    '#E879F9', // Fuchsia 400
    '#FB7185', // Rose 400
];

/**
 * Returns a deterministic color style for a given word.
 * Uses a simple hash to pick from the palette.
 */
export const getWordColor = (word: string): string => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
        hash = word.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[index];
};

export const ERROR_TAG_REGEX = /\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/i;

/**
 * Parses a transcript into tokens for highlighting.
 */
export const parseTranscriptForHighlighting = (text: string, customWords: string[] = []): HighlightToken[] => {
    if (!text) return [];

    // Combine standard filler keys and custom words
    const standardFillers = Object.values(FILLER_WORD_KEYS);
    // Sort by length descending to match longest phrases first (e.g. "you know" before "you")
    const allFillers = [...standardFillers, ...customWords]
        .filter(w => w && w.trim().length > 0)
        .sort((a, b) => b.length - a.length);

    // Escape special regex chars in fillers
    const escapedFillers = allFillers.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Create master regex for splitting: matches any filler or error tag
    const errorPattern = ERROR_TAG_REGEX.source;
    const fillerPattern = escapedFillers.join('|');

    // Regex: (ErrorTags)|(Fillers) - case insensitive
    const tokenRegex = new RegExp(`(${errorPattern})|\\b(${fillerPattern})\\b`, 'gi');

    // Split the text. Capturing groups will be included in the array.
    const parts = text.split(tokenRegex).filter(p => p !== undefined && p !== '');

    // Map parts to tokens
    const initialTokens: HighlightToken[] = parts.map((part, index) => {
        const cleanPart = part.toLowerCase().trim();

        // Check exact match with fillers
        const matchedFiller = allFillers.find(f => f.toLowerCase() === cleanPart);
        if (matchedFiller) {
            return {
                text: part,
                type: 'filler' as const,
                color: getWordColor(matchedFiller.toLowerCase()),
                id: String(index)
            };
        }

        if (ERROR_TAG_REGEX.test(cleanPart)) {
            return {
                text: part,
                type: 'error' as const,
                id: String(index)
            };
        }

        return {
            text: part,
            type: 'text' as const,
            id: String(index)
        };
    });

    return initialTokens.flatMap((token): HighlightToken | HighlightToken[] => {
        if (token.type === 'text') {
            // Split text block into words (preserving spaces)
            const subWords = token.text.split(/(\s+)/).filter(s => s.length > 0);
            return subWords.map((w, i): HighlightToken => ({
                text: w,
                type: 'text',
                id: `${token.id}-${i}`
            }));
        }
        return token;
    });
};

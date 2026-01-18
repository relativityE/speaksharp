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
export const parseTranscriptForHighlighting = (text: string, customWords: string[] = []) => {
    // 1. Split by spaces but keep delimiters if possible? 
    // Simpler: split by spaces and check regex match.
    // Note: This is a basic tokenizer; complex punctuation might need better handling.
    return text.split(/\s+/).map((token, index) => {
        const cleanToken = token.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");

        // Check for Error Tags
        if (ERROR_TAG_REGEX.test(token)) {
            return {
                text: token,
                type: 'error',
                id: index
            };
        }

        // Check for Custom Words / Fillers
        // Standard fillers + Custom
        const FILLERS = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of', 'literally', 'basically', 'actually', ...customWords.map(w => w.toLowerCase())];

        if (FILLERS.includes(cleanToken)) {
            return {
                text: token,
                type: 'filler',
                color: getWordColor(cleanToken),
                id: index
            };
        }

        return {
            text: token,
            type: 'text',
            id: index
        };
    });
};

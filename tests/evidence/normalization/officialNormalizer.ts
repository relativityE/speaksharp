/**
 * #1304 TRACK A — TypeScript port of the official Whisper `EnglishTextNormalizer`.
 *
 * PINNED ORACLE: openai/whisper @ 5f86d1d86363843179951550570367b37c5d6f78. The pipeline below follows
 * that commit's `english.py::EnglishTextNormalizer.__call__` step for step, and the spelling table is
 * the oracle's OWN `english.json`, vendored beside this file — its SHA-256 matches the hash recorded in
 * `goldens.json` provenance, so the data is verifiably upstream's rather than hand-copied.
 *
 * VERIFIED AGAINST GENERATED GOLDENS, NOT AGAINST ITS AUTHOR'S EXPECTATIONS. See
 * `__tests__/officialNormalizer.goldens.test.ts`, which runs every committed case. Cases this port does
 * not yet reproduce are listed there EXPLICITLY rather than skipped, because a port that quietly agrees
 * with itself is the failure mode this whole exercise exists to avoid.
 *
 * Fillers (`hmm|mm|mhm|mmm|uh|um`) and bracketed markers ARE REMOVED here — that is upstream behaviour
 * and it belongs to Track A only. Track B preserves both; see `tracks.ts`.
 */
import spellings from './english.json';

const SPELLINGS = spellings as Record<string, string>;

/** Upstream `basic.py::ADDITIONAL_DIACRITICS` — letters NFKD does not decompose. */
const ADDITIONAL_DIACRITICS: Record<string, string> = {
    'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE',
    'ß': 'ss', 'ẞ': 'SS', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D',
    'þ': 'th', 'Þ': 'th', 'ł': 'l', 'Ł': 'L',
};

/** Upstream `basic.py::remove_symbols_and_diacritics`. Symbols in `keep` survive. */
function removeSymbolsAndDiacritics(s: string, keep: string): string {
    let out = '';
    for (const ch of s) {
        if (keep.includes(ch)) { out += ch; continue; }
        if (ch in ADDITIONAL_DIACRITICS) { out += ADDITIONAL_DIACRITICS[ch]; continue; }
        const decomposed = ch.normalize('NFKD');
        for (const c of decomposed) {
            const cat = categoryOf(c);
            if (cat === 'Mn') continue;                       // combining mark -> drop
            if (cat === 'S' || cat === 'P') { out += ' '; continue; } // symbol/punct -> space
            out += c;
        }
    }
    return out;
}

/** Minimal Unicode general-category probe for the classes upstream branches on. */
function categoryOf(c: string): 'Mn' | 'S' | 'P' | 'other' {
    if (/\p{Mn}/u.test(c)) return 'Mn';
    if (/\p{S}/u.test(c)) return 'S';
    if (/\p{P}/u.test(c)) return 'P';
    return 'other';
}

/** Upstream `EnglishTextNormalizer.replacers`, in declaration order. */
const REPLACERS: [RegExp, string][] = [
    [/\bwon't\b/g, 'will not'], [/\bcan't\b/g, 'can not'], [/\blet's\b/g, 'let us'],
    [/\bain't\b/g, 'aint'], [/\by'all\b/g, 'you all'], [/\bwanna\b/g, 'want to'],
    [/\bgotta\b/g, 'got to'], [/\bgonna\b/g, 'going to'], [/\bi'ma\b/g, 'i am going to'],
    [/\bimma\b/g, 'i am going to'], [/\bwoulda\b/g, 'would have'], [/\bcoulda\b/g, 'could have'],
    [/\bshoulda\b/g, 'should have'], [/\bma'am\b/g, 'madam'],
    [/\bmr\b/g, 'mister '], [/\bmrs\b/g, 'missus '], [/\bst\b/g, 'saint '], [/\bdr\b/g, 'doctor '],
    [/\bprof\b/g, 'professor '], [/\bcapt\b/g, 'captain '], [/\bgov\b/g, 'governor '],
    [/\bald\b/g, 'alderman '], [/\bgen\b/g, 'general '], [/\bsen\b/g, 'senator '],
    [/\brep\b/g, 'representative '], [/\bpres\b/g, 'president '], [/\brev\b/g, 'reverend '],
    [/\bhon\b/g, 'honorable '], [/\basst\b/g, 'assistant '], [/\bassoc\b/g, 'associate '],
    [/\blt\b/g, 'lieutenant '], [/\bcol\b/g, 'colonel '], [/\bjr\b/g, 'junior '],
    [/\bsr\b/g, 'senior '], [/\besq\b/g, 'esquire '],
    [/'d been\b/g, ' had been'], [/'s been\b/g, ' has been'], [/'d gone\b/g, ' had gone'],
    [/'s gone\b/g, ' has gone'], [/'d done\b/g, ' had done'], [/'s got\b/g, ' has got'],
    [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'s\b/g, ' is'], [/'d\b/g, ' would'],
    [/'ll\b/g, ' will'], [/'t\b/g, ' not'], [/'ve\b/g, ' have'], [/'m\b/g, ' am'],
];

const IGNORE_PATTERNS = /\b(hmm|mm|mhm|mmm|uh|um)\b/g;

/**
 * PARTIAL port of upstream `EnglishNumberNormalizer`.
 *
 * DELIBERATELY NOT CLAIMED COMPLETE. Upstream handles ordinals, suffixed decades (`1960s`), nominal
 * digit runs (`one oh one`), currency placement (`$20 million`, `¢75`) and fraction words through a
 * stateful word-by-word machine. What is here covers cardinals, `point` decimals and simple currency;
 * everything else is reported as a FAILING golden rather than silently approximated, so the gap is
 * visible in the test output instead of hidden in a passing suite.
 */
const UNITS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
const isNumWord = (t: string) => t in UNITS || t in TENS || t in SCALES;

function foldRun(words: string[]): number | null {
    let total = 0, current = 0, seen = false;
    for (const w of words) {
        if (w in UNITS) { current += UNITS[w]; seen = true; }
        else if (w in TENS) { current += TENS[w]; seen = true; }
        else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
        else if (w in SCALES) { total += (current || 1) * SCALES[w]; current = 0; seen = true; }
        else return null;
    }
    return seen ? total + current : null;
}

function standardizeNumbers(s: string): string {
    const tokens = s.split(/\s+/).filter((t) => t.length > 0);
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
        if (!isNumWord(tokens[i])) { out.push(tokens[i]); i++; continue; }
        let j = i;
        while (j < tokens.length && isNumWord(tokens[j])) j++;
        const whole = foldRun(tokens.slice(i, j));
        if (whole === null) { out.push(tokens[i]); i++; continue; }
        if (tokens[j] === 'point' && j + 1 < tokens.length && tokens[j + 1] in UNITS) {
            let k = j + 1;
            const digits: string[] = [];
            while (k < tokens.length && tokens[k] in UNITS && UNITS[tokens[k]] < 10) {
                digits.push(String(UNITS[tokens[k]])); k++;
            }
            if (digits.length) {
                const value = `${whole}.${digits.join('')}`;
                if (tokens[k] === 'percent') { out.push(`${value}%`); i = k + 1; continue; }
                out.push(value); i = k; continue;
            }
        }
        // Upstream attaches a following `percent` to the number as `%`.
        if (tokens[j] === 'percent') { out.push(`${whole}%`); i = j + 1; continue; }
        out.push(String(whole));
        i = j;
    }
    return out.join(' ');
}

function standardizeSpellings(s: string): string {
    return s.split(/\s+/).map((w) => SPELLINGS[w] ?? w).join(' ');
}

/** Track A normalization — the pipeline of upstream `__call__`, returning tokens. */
export function normalizeOfficialTrackA(text: string): string[] {
    if (typeof text !== 'string') return [];
    let s = text.toLowerCase();
    s = s.replace(/[<[][^>\]]*[>\]]/g, '');          // words between brackets
    s = s.replace(/\(([^)]+?)\)/g, '');              // words between parentheses
    s = s.replace(IGNORE_PATTERNS, '');              // fillers — TRACK A ONLY
    s = s.replace(/\s+'/g, "'");                     // space before an apostrophe
    for (const [pattern, replacement] of REPLACERS) s = s.replace(pattern, replacement);
    s = s.replace(/(\d),(\d)/g, '$1$2');             // commas between digits
    s = s.replace(/\.([^0-9]|$)/g, ' $1');           // periods not followed by numbers
    s = removeSymbolsAndDiacritics(s, '.%$¢€£');
    s = standardizeNumbers(s);
    s = standardizeSpellings(s);
    s = s.replace(/[.$¢€£]([^0-9])/g, ' $1');
    s = s.replace(/([^0-9])%/g, '$1 ');
    return s.split(/\s+/).filter((t) => t.length > 0);
}

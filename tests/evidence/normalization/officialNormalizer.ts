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
import { normalizeEnglishNumbers } from './englishNumberNormalizer';

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

function standardizeSpellings(s: string): string {
    return s.split(/\s+/).map((w) => SPELLINGS[w] ?? w).join(' ');
}

/**
 * THE SINGLE NORMALIZATION CORE, shared by both tracks.
 *
 * The tracks must differ for EXACTLY ONE reason — whether disfluency is preserved. Running Track B on a
 * separately hand-written normalizer would make every other difference (spelling, numbers, symbols,
 * diacritics) a confound, so a Track A/Track B delta could no longer be attributed to fillers at all.
 * One core, one switch.
 */
export interface NormalizationCoreOptions {
    /**
     * Remove `hmm|mm|mhm|mmm|uh|um` and bracketed markers — upstream Whisper behaviour, and TRACK A ONLY.
     * Track B preserves both, because this product MEASURES disfluency and a model that silently drops
     * an "um" must be penalised rather than rewarded.
     */
    removeDisfluency: boolean;
}

export function normalizeOfficialCore(text: string, options: NormalizationCoreOptions): string[] {
    if (typeof text !== 'string') return [];
    const { removeDisfluency } = options;
    let s = text.toLowerCase();
    if (removeDisfluency) {
        s = s.replace(/[<[][^>\]]*[>\]]/g, '');      // words between brackets
        s = s.replace(/\(([^)]+?)\)/g, '');          // words between parentheses
        s = s.replace(IGNORE_PATTERNS, '');          // fillers
    }
    s = s.replace(/\s+'/g, "'");                     // space before an apostrophe
    for (const [pattern, replacement] of REPLACERS) s = s.replace(pattern, replacement);
    s = s.replace(/(\d),(\d)/g, '$1$2');             // commas between digits
    s = s.replace(/\.([^0-9]|$)/g, ' $1');           // periods not followed by numbers
    // The disfluency switch governs marker preservation END TO END. Stripping the bracket CONTENT above
    // but then letting the symbol pass here would leave Track B with a bare `inaudible` token — the
    // marker no longer distinguishable from the ordinary word. One switch, applied consistently.
    s = removeSymbolsAndDiacritics(s, removeDisfluency ? '.%$¢€£' : '.%$¢€£[]');
    s = normalizeEnglishNumbers(s);
    s = standardizeSpellings(s);
    s = s.replace(/[.$¢€£]([^0-9])/g, ' $1');
    s = s.replace(/([^0-9])%/g, '$1 ');
    return s.split(/\s+/).filter((t) => t.length > 0);
}

/** TRACK A — transcript accuracy. Official behaviour: disfluency and markers removed. */
export function normalizeOfficialTrackA(text: string): string[] {
    return normalizeOfficialCore(text, { removeDisfluency: true });
}

/** TRACK B — disfluency accuracy. The SAME core, with disfluency preserved. Nothing else differs. */
export function normalizeOfficialTrackB(text: string): string[] {
    return normalizeOfficialCore(text, { removeDisfluency: false });
}

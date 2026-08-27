/**
 * #1304 — pinned English text normalizer for WER scoring (`norm_v2`).
 *
 * WHY THIS EXISTS. Under `norm_v1` a SEMANTICALLY PERFECT transcript scored non-zero, because the
 * recognizer and the curated ground truth spell the same utterance differently. Measured before this
 * existed: `nine`/`9` = 8.3%, `do not`/`don't` = 25%, `colour`/`color` = 33.3%,
 * `twenty one point four percent`/`21.4%` = 50%, `five dollars and fifty cents`/`$5.50` = 71.4%.
 * A byte-identical pair scored 0, so the edit distance was never the problem — the normalization was.
 *
 * Any model comparison built on those numbers measures orthography, not recognition. This folds the
 * surface forms to one canonical shape so the remaining distance is real recognition error.
 *
 * TWO DELIBERATE DEVIATIONS from the upstream Whisper `EnglishTextNormalizer`:
 *
 *   1. FILLERS ARE KEPT. Upstream deletes `um`/`uh`/`hmm` as noise. This product MEASURES disfluency —
 *      `fixture-003` exists to score filler recognition — so deleting them would erase the signal the
 *      corpus is for and flatter any model that drops them.
 *   2. ERROR MARKERS ARE KEPT. `[inaudible]` stays a token, as in `norm_v1`, so a recognizer that emits
 *      one is scored honestly rather than silently cleaned.
 *
 * COVERAGE IS BOUNDED AND STATED. This handles the classes measured above: contractions, British vs
 * American spelling, number words up to the millions (incl. `point` decimals and hyphenated forms),
 * percent, and decimal currency. It does NOT handle ordinals, dates, times, roman numerals, fractions,
 * or non-decimal currency. Those are unmeasured, not solved — extend with a NEW version, never silently.
 */

/** Contractions -> expanded. Pinned; extending this is a version bump. */
const CONTRACTIONS: Record<string, string> = {
    "ain't": 'is not', "aren't": 'are not', "can't": 'can not', "couldn't": 'could not',
    "didn't": 'did not', "doesn't": 'does not', "don't": 'do not', "hadn't": 'had not',
    "hasn't": 'has not', "haven't": 'have not', "he'd": 'he would', "he'll": 'he will',
    "he's": 'he is', "i'd": 'i would', "i'll": 'i will', "i'm": 'i am', "i've": 'i have',
    "isn't": 'is not', "it'd": 'it would', "it'll": 'it will', "it's": 'it is',
    "let's": 'let us', "mustn't": 'must not', "shan't": 'shall not', "she'd": 'she would',
    "she'll": 'she will', "she's": 'she is', "shouldn't": 'should not', "that's": 'that is',
    "there's": 'there is', "they'd": 'they would', "they'll": 'they will', "they're": 'they are',
    "they've": 'they have', "we'd": 'we would', "we'll": 'we will', "we're": 'we are',
    "we've": 'we have', "weren't": 'were not', "what's": 'what is', "won't": 'will not',
    "wouldn't": 'would not', "you'd": 'you would', "you'll": 'you will', "you're": 'you are',
    "you've": 'you have',
};

/** British -> American. Pinned; extending this is a version bump. */
const SPELLINGS: Record<string, string> = {
    colour: 'color', colours: 'colors', coloured: 'colored', centre: 'center', centres: 'centers',
    theatre: 'theater', metre: 'meter', metres: 'meters', litre: 'liter', litres: 'liters',
    fibre: 'fiber', organise: 'organize', organised: 'organized', organisation: 'organization',
    realise: 'realize', realised: 'realized', recognise: 'recognize', recognised: 'recognized',
    analyse: 'analyze', analysed: 'analyzed', behaviour: 'behavior', favourite: 'favorite',
    honour: 'honor', labour: 'labor', neighbour: 'neighbor', travelled: 'traveled',
    travelling: 'traveling', cancelled: 'canceled', cancelling: 'canceling', defence: 'defense',
    licence: 'license', practise: 'practice', programme: 'program', grey: 'gray',
    catalogue: 'catalog', dialogue: 'dialog',
};

const UNITS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000 };

const isNumberWord = (t: string) => t in UNITS || t in TENS || t in SCALES;
const CURRENCY_UNITS = new Set(['dollars', 'dollar', 'pounds', 'pound', 'euros', 'euro']);

/** Fold a run of number words into a single value. Returns null when the run is not a number. */
function foldNumberRun(words: string[]): number | null {
    let total = 0;
    let current = 0;
    let seen = false;
    for (const w of words) {
        if (w in UNITS) { current += UNITS[w]; seen = true; }
        else if (w in TENS) { current += TENS[w]; seen = true; }
        else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
        else if (w === 'thousand' || w === 'million') {
            total += (current || 1) * SCALES[w]; current = 0; seen = true;
        } else return null;
    }
    return seen ? total + current : null;
}

/**
 * Collapse spelled-out numbers into digits, including `point`-separated decimals.
 * `twenty one point four` -> `21.4`. A `point` not flanked by numbers is left alone.
 */
function collapseNumbers(tokens: string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
        if (!isNumberWord(tokens[i])) { out.push(tokens[i]); i++; continue; }
        let j = i;
        while (j < tokens.length && isNumberWord(tokens[j])) j++;
        const whole = foldNumberRun(tokens.slice(i, j));
        if (whole === null) { out.push(tokens[i]); i++; continue; }

        // `point` decimals: each following number word contributes ONE digit.
        if (tokens[j] === 'point' && j + 1 < tokens.length && isNumberWord(tokens[j + 1])) {
            let k = j + 1;
            const digits: string[] = [];
            while (k < tokens.length && tokens[k] in UNITS && UNITS[tokens[k]] < 10) {
                digits.push(String(UNITS[tokens[k]])); k++;
            }
            if (digits.length > 0) { out.push(`${whole}.${digits.join('')}`); i = k; continue; }
        }
        out.push(String(whole));
        i = j;
    }
    return out;
}

/** Split a decimal currency amount into its spoken parts: `5.50 dollars` -> `5 dollars 50 cents`. */
function splitCurrency(tokens: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const amount = tokens[i];
        const unit = tokens[i + 1];
        const m = /^(\d+)\.(\d{2})$/.exec(amount ?? '');
        if (m && unit && CURRENCY_UNITS.has(unit)) {
            out.push(m[1], 'dollars', String(Number(m[2])), 'cents');
            i++;
            continue;
        }
        out.push(amount);
    }
    return out;
}

/** Drop the connector in `five dollars AND fifty cents`, which the symbolic form never contains. */
function dropCurrencyConnector(tokens: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === 'and' && CURRENCY_UNITS.has(tokens[i - 1] ?? '') && /^\d/.test(tokens[i + 1] ?? '')) continue;
        out.push(tokens[i]);
    }
    return out;
}

/** `norm_v2` — see the module header for coverage and the two deliberate deviations. */
export function normalizeEnglish(text: string): string[] {
    if (typeof text !== 'string') return [];
    let s = text
        .toLowerCase()
        .replace(/[‘’ʼ`´]/g, "'")
        // Symbols become the words they are spoken as, so both sides can meet in one place.
        .replace(/%/g, ' percent ')
        // Capture the WHOLE amount including decimals — matching only the leading digit split `$5.50`
        // into `$5` + `.50` and scored the perfect transcript at 33%.
        .replace(/\$\s*(\d+(?:\.\d+)?)/g, ' $1 dollars_marker ')
        .replace(/(\d),(\d{3})/g, '$1$2');   // 1,000 -> 1000

    // Normalise the placeholder, and drop any stray currency symbol left without a number.
    s = s.replace(/\$/g, ' ').replace(/dollars_marker/g, 'dollars');

    let tokens = s
        .replace(/[^\p{L}\p{N}\s'\-[\]_.]/gu, ' ')
        .replace(/(\d)\.(?!\d)/g, '$1 ')      // sentence-final period after a digit, not a decimal
        .replace(/(?<![\d])\.(?![\d])/g, ' ') // any other bare period
        .split(/\s+/)
        .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
        .filter((t) => t.length > 0);

    // Contractions expand BEFORE punctuation-driven splitting has removed the apostrophe.
    tokens = tokens.flatMap((t) => (CONTRACTIONS[t] ? CONTRACTIONS[t].split(' ') : [t]));
    // Hyphenated numbers (`twenty-one`) split so the number folder can see both halves.
    tokens = tokens.flatMap((t) => (/^[a-z]+-[a-z]+$/.test(t) && t.split('-').every(isNumberWord) ? t.split('-') : [t]));
    tokens = tokens.map((t) => SPELLINGS[t] ?? t);
    tokens = collapseNumbers(tokens);
    tokens = splitCurrency(tokens);
    tokens = dropCurrencyConnector(tokens);
    return tokens;
}
